import type { PoolClient } from 'pg';
import { pool, transaction } from './db';
import { DomainError } from './domain';
import { credits, type Actor } from './service';
import type { MailAction, MailDomain, Mailbox } from './mail-validation';
import { mailProviderAvailable, provisionMailbox, verifyMailDomain } from './mail-provider';

function admin(actor: Actor) {
  if (actor.role !== 'admin') throw new DomainError('Accès réservé à l’admin.', 403);
}
function access(actor: Actor, organization: string) {
  if (actor.role !== 'admin' && (actor.role !== 'client' || actor.organization_id !== organization)) {
    throw new DomainError('Accès refusé.', 403);
  }
}
async function audit(c: PoolClient, actor: Actor, action: string, id: string, detail: unknown) {
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES ($1,$2,$3,$4)',
    [actor.id, 'mail.' + action, id, JSON.stringify(detail)]);
}
async function usage(c: PoolClient, domain: string) {
  const result = await c.query(`SELECT count(*)::int AS count,coalesce(sum(quota_mb),0)::int AS quota
    FROM email_mailboxes WHERE domain_id=$1 AND status<>'cancelled'`, [domain]);
  return result.rows[0] as {count: number; quota: number};
}
function targetStatus(mailbox: Mailbox) {
  return mailbox.operation === 'suspend' ? 'suspended' : mailbox.operation === 'reset_password' ? mailbox.status : 'active';
}
async function complete(c: PoolClient, actor: Actor, domain: MailDomain, mailbox: Mailbox) {
  if(mailbox.operation==='create' && (mailbox.reserved_tokens??0)>0) await credits(c,actor,domain.organization_id,null,'mail_create',-mailbox.reserved_tokens!,-mailbox.reserved_tokens!,'Création boîte '+mailbox.local_part+'@'+domain.domain);
  await c.query(`UPDATE email_mailboxes SET status=$2,operation=NULL,operation_state=NULL,operation_started_at=NULL,reserved_tokens=0 WHERE id=$1`,
    [mailbox.id, targetStatus(mailbox)]);
  await audit(c, actor, 'completed', mailbox.id, {operation: mailbox.operation});
  await c.query('INSERT INTO notifications(organization_id,message) VALUES ($1,$2)',
    [domain.organization_id, `Messagerie : opération terminée pour ${mailbox.local_part}@${domain.domain}.`]);
}

export async function mailWorkspace(actor: Actor, page = 0) {
  const scoped = actor.role === 'client';
  const where = scoped ? ' WHERE d.organization_id=$1' : '';
  const args = scoped ? [actor.organization_id] : [];
  const offsetParameter = scoped ? '$2' : '$1';
  const [domains, mailboxes, count] = await Promise.all([
    pool.query(`SELECT d.*,count(b.id) FILTER (WHERE b.status<>'cancelled')::int AS mailbox_count,
      coalesce(sum(b.quota_mb) FILTER (WHERE b.status<>'cancelled'),0)::int AS allocated_quota_mb
      FROM email_domains d LEFT JOIN email_mailboxes b ON b.domain_id=d.id${where}
      GROUP BY d.id ORDER BY d.domain`, args),
    pool.query(`SELECT b.* FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id${where}
      ORDER BY b.created_at DESC,b.id LIMIT 50 OFFSET ${offsetParameter}`, [...args, page * 50]),
    pool.query(`SELECT count(*)::int AS count FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id${where}`, args)
  ]);
  return {domains: domains.rows, mailboxes: mailboxes.rows, automatic_available: mailProviderAvailable(),
    page, total_mailboxes: count.rows[0].count as number};
}

export async function mailAct(actor: Actor, input: MailAction) {
  try { return await perform(actor, input); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new DomainError('Ce domaine ou cette adresse existe déjà.', 409);
    }
    throw error;
  }
}
async function perform(actor: Actor, input: MailAction) {
  if (input.type === 'save_domain') {
    admin(actor);
    return transaction(async c => {
      const organization = await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [input.organization_id]);
      if (!organization.rowCount) throw new DomainError('Client introuvable.', 404);
      const current = input.id ? (await c.query('SELECT * FROM email_domains WHERE id=$1 FOR UPDATE', [input.id])).rows[0] as MailDomain | undefined : undefined;
      if (input.id && !current) throw new DomainError('Domaine introuvable.', 404);
      if (current && (current.domain !== input.domain || current.organization_id !== input.organization_id)) {
        throw new DomainError('Le domaine et son client ne peuvent pas être réaffectés.', 409);
      }
      const allocated = current ? await usage(c, current.id) : {count: 0, quota: 0};
      if (allocated.quota > input.total_quota_mb || (input.max_mailboxes !== null && allocated.count > input.max_mailboxes)) {
        throw new DomainError('Les limites sont inférieures aux comptes ou quotas déjà réservés.', 409);
      }
      if (current && allocated.count && current.provider !== input.provider) {
        throw new DomainError('Le fournisseur ne peut pas changer tant que des boîtes sont associées.', 409);
      }
      if (input.enabled && input.provider !== 'manual') {
        if (!mailProviderAvailable(input.provider)) throw new DomainError('Configurez le connecteur de messagerie avant d’activer le domaine.', 503);
        try { await verifyMailDomain(input.domain, input.provider); }
        catch (error) {
          if (error instanceof DomainError) throw error;
          throw new DomainError('Impossible de vérifier ce domaine chez le fournisseur.', 502);
        }
      }
      const values = [input.organization_id, input.domain, input.provider, input.enabled, input.max_mailboxes,
        input.total_quota_mb, input.mailbox_quota_mb, input.imap_host, input.smtp_host, input.smtp_port];
      const result = current
        ? await c.query(`UPDATE email_domains SET organization_id=$1,domain=$2,provider=$3,enabled=$4,max_mailboxes=$5,
            total_quota_mb=$6,mailbox_quota_mb=$7,imap_host=$8,smtp_host=$9,smtp_port=$10 WHERE id=$11 RETURNING id`, [...values, current.id])
        : await c.query(`INSERT INTO email_domains(organization_id,domain,provider,enabled,max_mailboxes,total_quota_mb,
            mailbox_quota_mb,imap_host,smtp_host,smtp_port) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, values);
      await audit(c, actor, input.type, result.rows[0].id, {domain: input.domain, provider: input.provider, enabled: input.enabled});
      return {message: 'Domaine enregistré. Son ajout dans SupportFlow ne modifie pas le DNS ni le serveur mail.'};
    });
  }

  if (input.type === 'resolve_operation') {
    admin(actor);
    return transaction(async c => {
      const result = await c.query(`SELECT b.*,d.organization_id FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id
        WHERE b.id=$1 FOR UPDATE OF b`, [input.mailbox_id]);
      const mailbox = result.rows[0] as Mailbox | undefined;
      if (!mailbox) throw new DomainError('Boîte introuvable.', 404);
      if (!mailbox.operation || (mailbox.operation_state === 'processing' &&
          Date.now() - new Date(mailbox.operation_started_at!).getTime() < 120_000)) {
        throw new DomainError('Aucune opération à confirmer, ou opération encore en cours.', 409);
      }
      const domain = (await c.query('SELECT * FROM email_domains WHERE id=$1', [mailbox.domain_id])).rows[0] as MailDomain;
      if (input.completed) await complete(c, actor, domain, mailbox);
      else {
        if(mailbox.operation==='create' && (mailbox.reserved_tokens??0)>0) await credits(c,actor,domain.organization_id,null,'mail_release',0,-mailbox.reserved_tokens!,'Création annulée après vérification');
        await c.query(`UPDATE email_mailboxes SET status=$2,operation=NULL,operation_state=NULL,operation_started_at=NULL,reserved_tokens=0 WHERE id=$1`,
        [mailbox.id, mailbox.operation === 'create' ? 'cancelled' : mailbox.status]);
      }
      await audit(c, actor, input.type, mailbox.id, {completed: input.completed, note: input.note, operation: mailbox.operation});
      return {message: 'Vérification du fournisseur enregistrée.'};
    });
  }

  const reserved = await transaction(async c => {
    let mailbox: Mailbox | undefined;
    let domain: MailDomain;
    if (input.type === 'create_mailbox') {
      const result = await c.query('SELECT * FROM email_domains WHERE id=$1 FOR UPDATE', [input.domain_id]);
      if (!result.rowCount) throw new DomainError('Domaine introuvable.', 404);
      domain = result.rows[0];
    } else {
      const result = await c.query(`SELECT b.* FROM email_mailboxes b WHERE b.id=$1 FOR UPDATE`, [input.mailbox_id]);
      if (!result.rowCount) throw new DomainError('Boîte introuvable.', 404);
      mailbox = result.rows[0];
      domain = (await c.query('SELECT * FROM email_domains WHERE id=$1', [mailbox!.domain_id])).rows[0];
    }
    access(actor, domain.organization_id);
    if (!domain.enabled) throw new DomainError('Ce domaine est en attente de configuration par l’administrateur.', 409);
    if (domain.provider !== 'manual' && !mailProviderAvailable(domain.provider)) throw new DomainError('Connecteur de messagerie indisponible.', 503);
    const operation = input.type === 'create_mailbox' ? 'create' : input.operation;
    if (domain.provider !== 'manual' && ['create', 'reset_password'].includes(operation) && !input.password) {
      throw new DomainError('Choisissez un mot de passe de 12 caractères minimum.', 400);
    }
    if (domain.provider === 'postfix' && ['suspend', 'resume'].includes(operation)) {
      throw new DomainError('Suspension et réactivation non disponibles pour ce connecteur.', 409);
    }
    if (domain.provider === 'postfix' && input.type === 'create_mailbox' &&
        Buffer.byteLength(input.local_part + '-' + domain.domain) > 32) {
      throw new DomainError('Adresse trop longue pour un compte mail Linux (32 caractères avec le domaine).', 400);
    }
    const state = domain.provider === 'manual' ? 'pending' : 'processing';
    if (input.type === 'create_mailbox') {
      await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[domain.organization_id]);
      const subscription=(await c.query('SELECT snapshot FROM subscriptions WHERE organization_id=$1 AND ends_at>now()',[domain.organization_id])).rows[0];
      if(!subscription) throw new DomainError('Attribuez une formule active avant de créer une boîte.',409);
      const pack=subscription.snapshot;
      const total=(await c.query(`SELECT count(*)::int AS count,coalesce(sum(b.quota_mb),0)::int AS quota FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id=$1 AND b.status<>'cancelled'`,[domain.organization_id])).rows[0];
      if(pack.mail_max_mailboxes!==undefined && (total.count>=pack.mail_max_mailboxes || total.quota+input.quota_mb>pack.mail_total_mb || input.quota_mb>pack.mail_per_box_mb)) throw new DomainError('Limite du pack mail atteinte (nombre ou stockage).',409);
      const tokenCost=Number(pack.mail_create_tokens??0);
      if(tokenCost>0) await credits(c,actor,domain.organization_id,null,'mail_reserve',0,tokenCost,'Réservation pour création mail');
      const allocated = await usage(c, domain.id);
      if (domain.max_mailboxes !== null && allocated.count >= domain.max_mailboxes) throw new DomainError('Nombre maximal de boîtes atteint.', 409);
      if (input.quota_mb > domain.mailbox_quota_mb || allocated.quota + input.quota_mb > domain.total_quota_mb) {
        throw new DomainError('Quota de stockage disponible insuffisant ou quota par boîte dépassé.', 409);
      }
      const result = await c.query(`INSERT INTO email_mailboxes(domain_id,local_part,display_name,quota_mb,operation,operation_state,operation_started_at,reserved_tokens)
        VALUES ($1,$2,$3,$4,'create',$5,now(),$6) RETURNING *`, [domain.id, input.local_part, input.display_name, input.quota_mb, state,tokenCost]);
      mailbox = result.rows[0];
    } else {
      if (mailbox!.operation) throw new DomainError('Une opération attend déjà un traitement pour cette boîte.', 409);
      if ((operation === 'suspend' && mailbox!.status !== 'active') || (operation === 'resume' && mailbox!.status !== 'suspended') ||
          (operation === 'reset_password' && !['active', 'suspended'].includes(mailbox!.status))) {
        throw new DomainError('Opération impossible dans cet état.', 409);
      }
      await c.query('UPDATE email_mailboxes SET operation=$2,operation_state=$3,operation_started_at=now() WHERE id=$1',
        [mailbox!.id, operation, state]);
      mailbox = {...mailbox!, operation, operation_state: state, operation_started_at: new Date().toISOString()};
    }
    // Passwords remain request-local and are never included in SQL, audit events or notifications.
    await audit(c, actor, 'requested', mailbox!.id, {operation, domain: domain.domain, local_part: mailbox!.local_part, quota_mb: mailbox!.quota_mb});
    return {domain, mailbox: mailbox!};
  });
  if (reserved.domain.provider === 'manual') return {message: 'Demande enregistrée. L’équipe confirmera après intervention sur le serveur mail.'};
  try {
    await provisionMailbox(reserved.domain, reserved.mailbox, input.password);
  } catch {
    await pool.query("UPDATE email_mailboxes SET operation_state='failed' WHERE id=$1 AND operation_state='processing'", [reserved.mailbox.id]);
    return {message: 'Le fournisseur n’a pas confirmé l’opération. Elle est enregistrée et doit être vérifiée par l’équipe avant toute nouvelle tentative.'};
  }
  // A crash between the provider call and this commit leaves a durable processing operation.
  // An admin can resolve it after checking the provider; never retry blindly or adopt an existing mailbox.
  await transaction(c => complete(c, actor, reserved.domain, reserved.mailbox));
  return {message: 'Opération confirmée par le serveur de messagerie.'};
}

