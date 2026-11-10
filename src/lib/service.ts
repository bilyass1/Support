import type { PoolClient } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { transaction, pool } from './db';
import { DomainError, creditChange, canMove, checkOpenLimit, invoiceTotals, formatMoney, slaBreached, statusLabels, priorityLabels,
  type Role, type Rule, type Module, type Priority, type TicketStatus } from './domain';
import type { Action } from './validation';

export type Actor={id:string; name:string; role:Role; organization_id:string|null};
type Query=Pick<PoolClient,'query'>;
export async function getActor(id:string,name:string):Promise<Actor> {
  const [role,member]=await Promise.all([
    pool.query('SELECT role FROM app_roles WHERE user_id=$1',[id]),
    pool.query('SELECT organization_id FROM memberships WHERE user_id=$1',[id])
  ]);
  // A staff role always wins: a team member is never scoped to a single client.
  const staffRole=role.rows[0]?.role as Role|undefined;
  return {id,name,role:staffRole??'client',organization_id:staffRole?null:member.rows[0]?.organization_id??null};
}
function staff(actor:Actor) { if(actor.role==='client') throw new DomainError('Accès réservé à l’équipe.',403); }
function admin(actor:Actor) { if(actor.role!=='admin') throw new DomainError('Accès réservé à l’admin.',403); }
function own(actor:Actor,organizationId:string) {
  if(actor.role==='client' && actor.organization_id!==organizationId) throw new DomainError('Accès refusé.',403);
}
/** Clients only reach the modules their organization has been granted. Checked on the server for every action. */
export async function moduleOn(c:Query,actor:Actor,organizationId:string,module:Module) {
  if(actor.role!=='client') return;
  own(actor,organizationId);
  const result=await c.query('SELECT 1 FROM organizations WHERE id=$1 AND $2=ANY(modules)',[organizationId,module]);
  if(!result.rowCount) throw new DomainError('Ce module n’est pas activé pour votre espace.',403);
}
async function audit(c:Query,actor:Actor,action:string,id:string,detail:unknown) {
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES ($1,$2,$3,$4)',[actor.id,action,id,JSON.stringify(detail)]);
}
export type Notice={org:string;audience:'client'|'staff';title:string;message:string;tab?:string;ticket?:string|null;except?:string;dedupe?:string};
/** Records a notification and queues one e-mail and one push delivery per recipient, inside the caller's transaction. */
export async function notify(c:Query,n:Notice) {
  const inserted=await c.query(`INSERT INTO notifications(organization_id,audience,title,message,tab,ticket_id,dedupe_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [n.org,n.audience,n.title,n.message,n.tab??'notifications',n.ticket??null,n.dedupe??null]);
  if(!inserted.rowCount) return;
  const recipients=n.audience==='client'
    ? 'SELECT user_id FROM memberships WHERE organization_id=$2 AND user_id NOT IN (SELECT user_id FROM app_roles)'
    : 'SELECT user_id FROM app_roles WHERE $2::uuid IS NOT NULL';
  await c.query(`INSERT INTO deliveries(notification_id,user_id,channel)
    SELECT $1,r.user_id,ch.channel FROM (${recipients}) r CROSS JOIN (VALUES ('email'),('push')) ch(channel) WHERE r.user_id<>$3`,
    [inserted.rows[0].id,n.org,n.except??'']);
}
async function activeSubscription(c:Query,org:string) {
  const result=await c.query('SELECT * FROM subscriptions WHERE organization_id=$1 AND ends_at>now()',[org]);
  if(!result.rowCount) throw new DomainError('Une formule active est nécessaire.',409);
  return result.rows[0];
}
async function credits(c:Query,actor:Actor,org:string,ticket:string|null,kind:string,balanceDelta:number,reservedDelta:number,note:string) {
  const wallet=await c.query('SELECT balance,reserved FROM wallets WHERE organization_id=$1 FOR UPDATE',[org]);
  if(!wallet.rowCount) throw new DomainError('Portefeuille introuvable.',404);
  const next=creditChange(wallet.rows[0].balance,wallet.rows[0].reserved,balanceDelta,reservedDelta);
  await c.query('UPDATE wallets SET balance=$2,reserved=$3 WHERE organization_id=$1',[org,next.balance,next.reserved]);
  await c.query('INSERT INTO credit_ledger(organization_id,ticket_id,kind,balance_delta,reserved_delta,note,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',[org,ticket,kind,balanceDelta,reservedDelta,note,actor.id]);
}
async function organizationRow(c:Query,id:string,lock=false) {
  const result=await c.query('SELECT * FROM organizations WHERE id=$1'+(lock?' FOR UPDATE':''),[id]);
  if(!result.rowCount) throw new DomainError('Client introuvable.',404);
  return result.rows[0] as {id:string;name:string};
}
async function userByEmail(c:Query,email:string) {
  const user=await c.query('SELECT id,name FROM "user" WHERE lower(email)=lower($1)',[email]);
  if(!user.rowCount) throw new DomainError('Aucun compte n’existe avec cet e-mail. La personne doit d’abord créer son compte.',409);
  return user.rows[0] as {id:string;name:string};
}
async function addMember(c:Query,userId:string,organizationId:string) {
  const member=await c.query('SELECT user_id FROM memberships WHERE user_id=$1',[userId]);
  if(member.rowCount) throw new DomainError('Ce compte est déjà associé à un client.',409);
  await c.query('INSERT INTO memberships(user_id,organization_id) VALUES ($1,$2)',[userId,organizationId]);
}
const invoiceNumber=(number:string|number)=>'F-'+String(number).padStart(5,'0');

export async function act(actor:Actor,input:Action):Promise<Record<string,unknown>> {
  return transaction(async c=>{
    if(input.type==='mark_seen') {
      await c.query('INSERT INTO notification_seen(user_id,seen_at) VALUES ($1,now()) ON CONFLICT (user_id) DO UPDATE SET seen_at=now()',[actor.id]);
      return {ok:true};
    }
    if(input.type==='create_organization') {
      admin(actor);
      const user=input.email?await userByEmail(c,input.email):null;
      if(user) {
        const member=await c.query('SELECT user_id FROM memberships WHERE user_id=$1',[user.id]);
        if(member.rowCount) throw new DomainError('Ce compte est déjà associé à un client.',409);
      }
      const org=await c.query('INSERT INTO organizations(name,contact_email) VALUES ($1,$2) RETURNING id',[input.name,input.email??null]);
      const id=org.rows[0].id as string;
      if(user) await addMember(c,user.id,id);
      await c.query('INSERT INTO wallets(organization_id) VALUES ($1)',[id]);
      await audit(c,actor,input.type,id,{name:input.name});
      return {id};
    }
    if(input.type==='update_organization') {
      admin(actor);
      await organizationRow(c,input.organization_id,true);
      await c.query('UPDATE organizations SET name=$2,contact_email=$3,phone=$4,tax_id=$5,address=$6 WHERE id=$1',
        [input.organization_id,input.name,input.contact_email,input.phone,input.tax_id,input.address]);
      await audit(c,actor,input.type,input.organization_id,{name:input.name});
      return {ok:true};
    }
    if(input.type==='set_modules') {
      admin(actor);
      await organizationRow(c,input.organization_id,true);
      const modules=[...new Set(input.modules)];
      await c.query('UPDATE organizations SET modules=$2 WHERE id=$1',[input.organization_id,modules]);
      await audit(c,actor,input.type,input.organization_id,{modules});
      return {ok:true};
    }
    if(input.type==='add_member') {
      admin(actor);
      await organizationRow(c,input.organization_id,true);
      const user=await userByEmail(c,input.email);
      await addMember(c,user.id,input.organization_id);
      await audit(c,actor,input.type,input.organization_id,{user_id:user.id});
      return {ok:true};
    }
    if(input.type==='remove_member') {
      admin(actor);
      const removed=await c.query('DELETE FROM memberships WHERE user_id=$1 RETURNING organization_id',[input.user_id]);
      if(!removed.rowCount) throw new DomainError('Membre introuvable.',404);
      await audit(c,actor,input.type,removed.rows[0].organization_id,{user_id:input.user_id});
      return {ok:true};
    }
    if(input.type==='set_role') {
      admin(actor);
      const user=await userByEmail(c,input.email);
      if(user.id===actor.id) throw new DomainError('Vous ne pouvez pas modifier votre propre rôle.',409);
      if(input.role==='none') await c.query('DELETE FROM app_roles WHERE user_id=$1',[user.id]);
      else await c.query('INSERT INTO app_roles(user_id,role) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET role=$2',[user.id,input.role]);
      await audit(c,actor,input.type,user.id,{role:input.role});
      return {ok:true};
    }
    if(input.type==='create_application') {
      staff(actor);
      await organizationRow(c,input.organization_id);
      const result=await c.query('INSERT INTO applications(organization_id,name,kind) VALUES ($1,$2,$3) RETURNING id',[input.organization_id,input.name,input.kind]);
      await audit(c,actor,input.type,result.rows[0].id,input);
      return result.rows[0];
    }
    if(input.type==='rotate_app_key') {
      staff(actor);
      // The key is shown once; only its hash is stored.
      const key='sf_'+randomBytes(24).toString('base64url');
      const result=await c.query('UPDATE applications SET ingest_key_hash=$2 WHERE id=$1 RETURNING id',[input.application_id,hashKey(key)]);
      if(!result.rowCount) throw new DomainError('Application introuvable.',404);
      await audit(c,actor,input.type,input.application_id,{});
      return {key};
    }
    if(input.type==='save_plan') {
      admin(actor);
      const values=[input.name,input.annual_tokens,input.price_minor,input.currency,input.support_level,JSON.stringify(input.rules)];
      const result=input.id
        ? await c.query('UPDATE plans SET name=$1,annual_tokens=$2,price_minor=$3,currency=$4,support_level=$5,rules=$6,revision=revision+1 WHERE id=$7 RETURNING *',[...values,input.id])
        : await c.query('INSERT INTO plans(name,annual_tokens,price_minor,currency,support_level,rules) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',values);
      if(!result.rowCount) throw new DomainError('Formule introuvable.',404);
      const plan=result.rows[0];
      if(input.apply_to_existing) {
        await c.query('UPDATE subscriptions SET snapshot=$2 WHERE plan_id=$1',[plan.id,JSON.stringify(plan)]);
      }
      await audit(c,actor,input.type,plan.id,{...input,revision:plan.revision});
      return {id:plan.id};
    }
    if(input.type==='assign_plan') {
      admin(actor);
      // Serialize grants and reassignment for the same organization.
      await organizationRow(c,input.organization_id,true);
      const result=await c.query('SELECT * FROM plans WHERE id=$1',[input.plan_id]);
      if(!result.rowCount) throw new DomainError('Formule introuvable.',404);
      const plan=result.rows[0];
      const subscription=await c.query('SELECT * FROM subscriptions WHERE organization_id=$1',[input.organization_id]);
      if(subscription.rowCount) {
        await c.query('UPDATE subscriptions SET plan_id=$2,snapshot=$3 WHERE organization_id=$1',[input.organization_id,plan.id,JSON.stringify(plan)]);
      } else {
        await c.query('INSERT INTO subscriptions(organization_id,plan_id,snapshot) VALUES ($1,$2,$3)',[input.organization_id,plan.id,JSON.stringify(plan)]);
        await credits(c,actor,input.organization_id,null,'annual_allocation',plan.annual_tokens,0,'Attribution initiale du quota annuel');
      }
      await audit(c,actor,input.type,input.organization_id,{plan_id:plan.id,revision:plan.revision});
      await notify(c,{org:input.organization_id,audience:'client',title:'Formule mise à jour',message:'Votre formule a été mise à jour : '+plan.name,tab:'overview'});
      return {ok:true};
    }
    if(input.type==='renew_subscription') {
      admin(actor);
      await organizationRow(c,input.organization_id,true);
      const renewed=await c.query(`UPDATE subscriptions SET ends_at=greatest(ends_at,now())+interval '1 year' WHERE organization_id=$1 RETURNING snapshot,ends_at`,[input.organization_id]);
      if(!renewed.rowCount) throw new DomainError('Attribuez d’abord une formule à ce client.',409);
      const snapshot=renewed.rows[0].snapshot as {annual_tokens:number;name:string};
      await credits(c,actor,input.organization_id,null,'annual_allocation',snapshot.annual_tokens,0,'Renouvellement annuel de la formule '+snapshot.name);
      await audit(c,actor,input.type,input.organization_id,{ends_at:renewed.rows[0].ends_at});
      await notify(c,{org:input.organization_id,audience:'client',title:'Abonnement renouvelé',message:`Votre formule ${snapshot.name} est renouvelée pour un an : ${snapshot.annual_tokens} crédits ajoutés.`,tab:'overview'});
      return {ok:true};
    }
    if(input.type==='recharge') {
      admin(actor);
      await credits(c,actor,input.organization_id,null,'manual_recharge',input.tokens,0,input.note);
      await audit(c,actor,input.type,input.organization_id,input);
      await notify(c,{org:input.organization_id,audience:'client',title:'Crédits ajoutés',message:`${input.tokens} crédits ont été ajoutés à votre solde.`,tab:'ledger'});
      return {ok:true};
    }
    if(input.type==='save_invoice') {
      admin(actor);
      await organizationRow(c,input.organization_id);
      const totals=invoiceTotals(input.items,input.tax_rate_bp,input.stamp_minor);
      const values=[input.organization_id,input.currency,JSON.stringify(input.items),totals.subtotal,input.tax_rate_bp,totals.tax,input.stamp_minor,totals.total,input.note,input.due_at];
      const result=input.id
        ? await c.query(`UPDATE invoices SET organization_id=$1,currency=$2,items=$3,subtotal_minor=$4,tax_rate_bp=$5,tax_minor=$6,stamp_minor=$7,total_minor=$8,note=$9,due_at=$10
            WHERE id=$11 AND status='draft' RETURNING id,number`,[...values,input.id])
        : await c.query(`INSERT INTO invoices(organization_id,currency,items,subtotal_minor,tax_rate_bp,tax_minor,stamp_minor,total_minor,note,due_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,number`,values);
      if(!result.rowCount) throw new DomainError('Seule une facture en brouillon peut être modifiée.',409);
      await audit(c,actor,input.type,result.rows[0].id,{total_minor:totals.total,currency:input.currency});
      return {id:result.rows[0].id};
    }
    if(input.type==='invoice_status') {
      admin(actor);
      const found=await c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[input.invoice_id]);
      if(!found.rowCount) throw new DomainError('Facture introuvable.',404);
      const invoice=found.rows[0];
      const allowed:Record<string,string[]>={draft:['sent','cancelled'],sent:['paid','cancelled']};
      if(!allowed[invoice.status]?.includes(input.status)) throw new DomainError('Changement de statut impossible pour cette facture.',409);
      await c.query(`UPDATE invoices SET status=$2,issued_at=CASE WHEN $2='sent' THEN now() ELSE issued_at END,paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END WHERE id=$1`,[invoice.id,input.status]);
      const label=invoiceNumber(invoice.number),total=formatMoney(invoice.total_minor,invoice.currency);
      if(input.status==='sent') await notify(c,{org:invoice.organization_id,audience:'client',title:'Nouvelle facture '+label,message:`La facture ${label} d’un montant de ${total} TTC est disponible. Échéance : ${new Date(invoice.due_at).toLocaleDateString('fr-FR')}.`,tab:'billing'});
      if(input.status==='paid') await notify(c,{org:invoice.organization_id,audience:'client',title:'Paiement reçu',message:`Nous avons bien reçu votre paiement de ${total} pour la facture ${label}. Merci.`,tab:'billing'});
      if(input.status==='cancelled'&&invoice.status==='sent') await notify(c,{org:invoice.organization_id,audience:'client',title:'Facture annulée',message:`La facture ${label} a été annulée.`,tab:'billing'});
      await audit(c,actor,input.type,invoice.id,{status:input.status});
      return {ok:true};
    }
    if(input.type==='announce') {
      admin(actor);
      if(input.organization_id) await organizationRow(c,input.organization_id);
      const created=await c.query('INSERT INTO announcements(organization_id,title,body,author_id) VALUES ($1,$2,$3,$4) RETURNING id',[input.organization_id,input.title,input.body,actor.id]);
      const targets=await c.query('SELECT id FROM organizations WHERE $1::uuid IS NULL OR id=$1',[input.organization_id]);
      for(const target of targets.rows) await notify(c,{org:target.id,audience:'client',title:input.title,message:input.body,tab:'overview'});
      await audit(c,actor,input.type,created.rows[0].id,{title:input.title,organization_id:input.organization_id});
      return {ok:true};
    }
    if(input.type==='create_ticket') {
      const application=await c.query('SELECT a.*,o.name AS organization_name FROM applications a JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1',[input.application_id]);
      if(!application.rowCount) throw new DomainError('Application introuvable.',404);
      const org=application.rows[0].organization_id as string;
      own(actor,org);
      await moduleOn(c,actor,org,'tickets');
      await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
      const subscription=await activeSubscription(c,org);
      const count=await c.query("SELECT count(*)::int AS count FROM tickets WHERE organization_id=$1 AND status NOT IN ('closed','cancelled')",[org]);
      checkOpenLimit(subscription.snapshot.rules as Rule[],count.rows[0].count);
      const result=await c.query('INSERT INTO tickets(organization_id,application_id,created_by,title,description,category,priority) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,number',[org,input.application_id,actor.id,input.title,input.description,input.category,input.priority]);
      await audit(c,actor,input.type,result.rows[0].id,{category:input.category,priority:input.priority});
      await notify(c,{org,audience:'staff',title:`Nouvelle demande #${result.rows[0].number}`,message:`${application.rows[0].organization_name} · ${application.rows[0].name} : ${input.title} (priorité ${priorityLabels[input.priority as Priority].toLowerCase()})`,tab:'tickets',ticket:result.rows[0].id,except:actor.id});
      return result.rows[0];
    }
    const result=await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[input.ticket_id]);
    if(!result.rowCount) throw new DomainError('Ticket introuvable.',404);
    const ticket=result.rows[0];
    await moduleOn(c,actor,ticket.organization_id,'tickets');
    const isClient=actor.role==='client';
    const tell=(audience:'client'|'staff',title:string,message:string)=>notify(c,{org:ticket.organization_id,audience,title,message,tab:'tickets',ticket:ticket.id,except:actor.id});
    if(input.type==='quote') {
      staff(actor);
      if(!['new','quoted'].includes(ticket.status)) throw new DomainError('Ce ticket a déjà été validé.',409);
      await c.query("UPDATE tickets SET estimated_tokens=$2,estimate_note=$3,estimate_revision=estimate_revision+1,status='quoted',first_response_at=coalesce(first_response_at,now()),updated_at=now() WHERE id=$1",[ticket.id,input.tokens,input.note]);
      await tell('client',`Estimation à valider · ticket #${ticket.number}`,`« ${ticket.title} » : estimation de ${input.tokens} crédits. ${input.note}`);
    } else if(input.type==='accept') {
      if(!isClient) throw new DomainError('La validation appartient au client.',403);
      if(ticket.status!=='quoted' || ticket.estimate_revision!==input.estimate_revision) throw new DomainError('L’estimation a changé ou a déjà été validée. Actualisez le ticket.',409);
      await activeSubscription(c,ticket.organization_id);
      await credits(c,actor,ticket.organization_id,ticket.id,'reserve',0,ticket.estimated_tokens,`Acceptation de l’estimation v${ticket.estimate_revision}`);
      await c.query("UPDATE tickets SET status='accepted',updated_at=now() WHERE id=$1",[ticket.id]);
      await tell('staff',`Estimation acceptée · ticket #${ticket.number}`,`Le client a validé « ${ticket.title} » : ${ticket.estimated_tokens} crédits réservés.`);
    } else if(input.type==='move') {
      if(isClient && !(input.status==='closed' && ticket.status==='ready') && !(input.status==='cancelled' && ['new','quoted'].includes(ticket.status))) {
        throw new DomainError('Cette action appartient à l’équipe.',403);
      }
      canMove(ticket.status,input.status);
      if(input.status==='closed') {
        await credits(c,actor,ticket.organization_id,ticket.id,'consume',-ticket.estimated_tokens,-ticket.estimated_tokens,'Livraison validée et ticket clôturé');
      } else if(input.status==='cancelled' && ['accepted','in_progress','ready'].includes(ticket.status)) {
        await credits(c,actor,ticket.organization_id,ticket.id,'release',0,-ticket.estimated_tokens,'Réservation libérée après annulation');
      }
      await c.query("UPDATE tickets SET status=$2,closed_at=CASE WHEN $2='closed' THEN now() ELSE closed_at END,updated_at=now() WHERE id=$1",[ticket.id,input.status]);
      await tell(isClient?'staff':'client',`Ticket #${ticket.number} : ${statusLabels[input.status as TicketStatus].toLowerCase()}`,`« ${ticket.title} » est passé au statut « ${statusLabels[input.status as TicketStatus]} ».`);
    } else if(input.type==='comment') {
      if(input.internal) staff(actor);
      await c.query('INSERT INTO ticket_comments(ticket_id,author_id,body,internal) VALUES ($1,$2,$3,$4)',[ticket.id,actor.id,input.body,input.internal]);
      if(!isClient && !input.internal) await c.query('UPDATE tickets SET first_response_at=coalesce(first_response_at,now()) WHERE id=$1',[ticket.id]);
      const excerpt=input.body.length>240?input.body.slice(0,240)+'…':input.body;
      if(input.internal) await tell('staff',`Note interne · ticket #${ticket.number}`,`${actor.name} : ${excerpt}`);
      else await tell(isClient?'staff':'client',`Nouveau message · ticket #${ticket.number}`,`${actor.name} : ${excerpt}`);
    } else if(input.type==='triage') {
      staff(actor);
      if(input.assignee_id) {
        const member=await c.query('SELECT 1 FROM app_roles WHERE user_id=$1',[input.assignee_id]);
        if(!member.rowCount) throw new DomainError('Ce ticket ne peut être assigné qu’à un membre de l’équipe.',409);
      }
      await c.query('UPDATE tickets SET priority=$2,assignee_id=$3,updated_at=now() WHERE id=$1',[ticket.id,input.priority,input.assignee_id]);
    } else if(input.type==='rate') {
      if(!isClient) throw new DomainError('La note de satisfaction appartient au client.',403);
      if(ticket.status!=='closed') throw new DomainError('Seule une demande clôturée peut être notée.',409);
      await c.query('UPDATE tickets SET rating=$2,rating_comment=$3 WHERE id=$1',[ticket.id,input.rating,input.comment]);
      await tell('staff',`Satisfaction ${input.rating}/5 · ticket #${ticket.number}`,input.comment??`Le client a noté « ${ticket.title} ».`);
    }
    await audit(c,actor,input.type,ticket.id,input);
    return {ok:true};
  });
}

export const hashKey=(key:string)=>createHash('sha256').update(key).digest('hex');
/** Usage event sent by a client application, authenticated by its ingestion key. */
export async function recordUsage(key:string,input:{event:string;user?:string;version?:string}) {
  const application=await pool.query('UPDATE applications SET last_seen_at=now(),last_version=coalesce($2,last_version) WHERE ingest_key_hash=$1 RETURNING id',[hashKey(key),input.version??null]);
  if(!application.rowCount) throw new DomainError('Clé d’application inconnue.',401);
  const id=application.rows[0].id as string,event=input.event.toLowerCase();
  const session=['open','session','session_start','launch','login'].includes(event)?1:0,error=event.startsWith('error')?1:0;
  await pool.query(`INSERT INTO app_usage_daily(application_id,day,events,sessions,errors) VALUES ($1,current_date,1,$2,$3)
    ON CONFLICT (application_id,day) DO UPDATE SET events=app_usage_daily.events+1,sessions=app_usage_daily.sessions+$2,errors=app_usage_daily.errors+$3`,[id,session,error]);
  // Only a salted hash of the end-user identifier is kept, to count distinct users per day.
  if(input.user) await pool.query('INSERT INTO app_usage_users(application_id,day,user_hash) VALUES ($1,current_date,$2) ON CONFLICT DO NOTHING',[id,hashKey(id+':'+input.user)]);
}

export type Alert={level:'warning'|'danger';organization_id:string;message:string;tab:string};
export async function workspace(actor:Actor) {
  const scoped=actor.role==='client';
  const org=actor.organization_id;
  const values=scoped?[org]:[];
  const rows=async(sql:string,args:unknown[]=values)=>(await pool.query(sql,args)).rows;
  const organizations=await rows(`SELECT o.*,w.balance,w.reserved,s.snapshot,s.ends_at FROM organizations o JOIN wallets w ON w.organization_id=o.id
    LEFT JOIN subscriptions s ON s.organization_id=o.id${scoped?' WHERE o.id=$1':''} ORDER BY o.name`);
  const modules:string[]=scoped?organizations[0]?.modules??[]:['tickets','credits','mail','billing','usage'];
  const has=(module:Module)=>modules.includes(module);
  const filter=scoped?' WHERE organization_id=$1':'';
  const and=scoped?' AND t.organization_id=$1':'';
  const none=Promise.resolve([] as Record<string,unknown>[]);
  const [applications,plans,tickets,ledger,notifications,seen,invoices,announcements]=await Promise.all([
    rows(`SELECT id,organization_id,name,kind,last_seen_at,last_version,(ingest_key_hash IS NOT NULL) AS tracked FROM applications${filter} ORDER BY name`),
    scoped?none:rows('SELECT * FROM plans ORDER BY name'),
    has('tickets')?rows(`SELECT * FROM tickets${filter} ORDER BY created_at DESC LIMIT 200`):none,
    has('credits')?rows(`SELECT * FROM credit_ledger${filter} ORDER BY created_at DESC LIMIT 200`):none,
    rows(`SELECT id,organization_id,title,message,tab,ticket_id,created_at FROM notifications WHERE audience=$${scoped?2:1}${scoped?' AND organization_id=$1':''} ORDER BY created_at DESC LIMIT 60`,[...values,scoped?'client':'staff']),
    rows('SELECT seen_at FROM notification_seen WHERE user_id=$1',[actor.id]),
    has('billing')?rows(`SELECT id,number,organization_id,status,currency,items,subtotal_minor,tax_rate_bp,tax_minor,stamp_minor,total_minor,note,due_at::text AS due_at,issued_at,paid_at,created_at,
      (status='sent' AND due_at<current_date) AS overdue FROM invoices${scoped?" WHERE organization_id=$1 AND status<>'draft'":''} ORDER BY created_at DESC LIMIT 200`):none,
    rows(`SELECT id,organization_id,title,body,created_at FROM announcements${scoped?' WHERE organization_id IS NULL OR organization_id=$1':''} ORDER BY created_at DESC LIMIT 10`)
  ]);
  const ticketIds=tickets.map(t=>t.id);
  const [comments,attachments,usage]=await Promise.all([
    ticketIds.length?rows(`SELECT c.id,c.ticket_id,c.body,c.internal,c.created_at,c.author_id,u.name AS author_name,(r.user_id IS NOT NULL) AS from_staff FROM ticket_comments c
      LEFT JOIN "user" u ON u.id=c.author_id LEFT JOIN app_roles r ON r.user_id=c.author_id
      WHERE c.ticket_id=ANY($1::uuid[])${scoped?' AND NOT c.internal':''} ORDER BY c.created_at`,[ticketIds]):none,
    ticketIds.length?rows('SELECT id,ticket_id,name,mime,size,created_at FROM ticket_attachments WHERE ticket_id=ANY($1::uuid[]) ORDER BY created_at',[ticketIds]):none,
    has('usage')?rows(`SELECT d.application_id,d.day::text AS day,d.events,d.sessions,d.errors,
      (SELECT count(*)::int FROM app_usage_users u WHERE u.application_id=d.application_id AND u.day=d.day) AS users
      FROM app_usage_daily d JOIN applications t ON t.id=d.application_id WHERE d.day>current_date-30${and} ORDER BY d.day`):none
  ]);
  const seenAt=seen[0]?.seen_at?new Date(seen[0].seen_at as string).getTime():0;
  const unread=notifications.filter(n=>new Date(n.created_at as string).getTime()>seenAt).length;
  const base={actor,modules,organizations,applications,plans,tickets,ledger,notifications,unread,invoices,announcements,comments,attachments,usage};
  if(scoped) return {...base,members:[],team:[],mail:[],alerts:[]};
  // Team-only: who uses the portal, mailbox consumption per client, and what needs attention.
  const [members,team,mail]=await Promise.all([
    rows(`SELECT m.user_id,m.organization_id,u.name,u.email,(SELECT max(s."updatedAt") FROM session s WHERE s."userId"=m.user_id) AS last_active
      FROM memberships m JOIN "user" u ON u.id=m.user_id ORDER BY u.name`),
    rows('SELECT r.user_id,r.role,u.name,u.email FROM app_roles r JOIN "user" u ON u.id=r.user_id ORDER BY u.name'),
    rows(`SELECT d.organization_id,count(b.id)::int AS mailboxes,coalesce(sum(b.quota_mb),0)::int AS quota_mb,coalesce(sum(b.used_mb),0)::int AS used_mb,
      coalesce(sum(b.messages),0)::int AS messages,count(b.id) FILTER (WHERE b.used_mb*10>=b.quota_mb*9)::int AS nearly_full,max(b.usage_synced_at) AS synced_at,max(b.last_login_at) AS last_login_at
      FROM email_domains d LEFT JOIN email_mailboxes b ON b.domain_id=d.id AND b.status<>'cancelled' GROUP BY d.organization_id`)
  ]);
  return {...base,members,team,mail,alerts:alerts(base,mail)};
}
type Row=Record<string,unknown>;
function alerts(data:{organizations:Row[];applications:Row[];tickets:Row[];invoices:Row[]},mail:Row[]):Alert[] {
  const list:Alert[]=[],now=Date.now(),day=86_400_000;
  const name=(id:unknown)=>String(data.organizations.find(o=>o.id===id)?.name??'Client');
  for(const o of data.organizations) {
    const snapshot=o.snapshot as {annual_tokens:number}|null,id=o.id as string;
    if(!snapshot) { list.push({level:'warning',organization_id:id,message:`${o.name} n’a pas encore de formule.`,tab:'clients'}); continue; }
    const left=(new Date(o.ends_at as string).getTime()-now)/day;
    if(left<=0) list.push({level:'danger',organization_id:id,message:`La formule de ${o.name} est expirée.`,tab:'clients'});
    else if(left<=30) list.push({level:'warning',organization_id:id,message:`La formule de ${o.name} expire dans ${Math.ceil(left)} jours.`,tab:'clients'});
    const available=(o.balance as number)-(o.reserved as number);
    if(available<=snapshot.annual_tokens*0.1) list.push({level:available<=0?'danger':'warning',organization_id:id,message:`${o.name} : il reste ${available} crédits disponibles.`,tab:'clients'});
  }
  for(const i of data.invoices) if(i.overdue) list.push({level:'danger',organization_id:i.organization_id as string,message:`${name(i.organization_id)} : facture ${invoiceNumber(i.number as string)} en retard (${formatMoney(i.total_minor as number,i.currency as string)}).`,tab:'billing'});
  for(const t of data.tickets) if(!t.first_response_at&&!['closed','cancelled'].includes(t.status as string)&&slaBreached(t as never,now)) list.push({level:'danger',organization_id:t.organization_id as string,message:`${name(t.organization_id)} : le ticket #${t.number} attend une première réponse (délai dépassé).`,tab:'tickets'});
  for(const m of mail) if((m.nearly_full as number)>0) list.push({level:'warning',organization_id:m.organization_id as string,message:`${name(m.organization_id)} : ${m.nearly_full} boîte(s) mail à plus de 90 % de leur quota.`,tab:'mail'});
  for(const a of data.applications) if(a.tracked&&(!a.last_seen_at||now-new Date(a.last_seen_at as string).getTime()>7*day)) list.push({level:'warning',organization_id:a.organization_id as string,message:`${name(a.organization_id)} : aucune activité reçue de « ${a.name} » depuis 7 jours.`,tab:'usage'});
  return list;
}

/** Admin-only views: audit trail and delivery log of e-mails and push notifications. */
export async function adminView(actor:Actor,view:string) {
  admin(actor);
  if(view==='audit') return {audit:(await pool.query(`SELECT a.id,a.action,a.entity_id,a.detail,a.created_at,u.name AS actor_name FROM audit_events a LEFT JOIN "user" u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300`)).rows};
  if(view==='deliveries') return {deliveries:(await pool.query(`SELECT d.id,d.channel,d.status,d.attempts,d.error,d.created_at,d.sent_at,u.email,n.title FROM deliveries d
    JOIN notifications n ON n.id=d.notification_id LEFT JOIN "user" u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 300`)).rows};
  throw new DomainError('Vue inconnue.',404);
}

/** Scheduled reminders. Each is keyed so that running the job twice never notifies twice. */
export async function reminders() {
  return transaction(async c=>{
    const expiring=await c.query(`SELECT s.organization_id,s.ends_at::date::text AS day,(s.ends_at::date-current_date) AS days_left,o.name FROM subscriptions s JOIN organizations o ON o.id=s.organization_id
      WHERE s.ends_at>now() AND s.ends_at<now()+interval '30 days'`);
    for(const s of expiring.rows) {
      const step=s.days_left<=7?7:30;
      const message=`La formule de ${s.name} arrive à échéance le ${new Date(s.day).toLocaleDateString('fr-FR')}.`;
      await notify(c,{org:s.organization_id,audience:'client',title:'Votre formule arrive à échéance',message:message+' Contactez-nous pour la renouveler.',tab:'overview',dedupe:`sub:${step}:client:${s.organization_id}:${s.day}`});
      await notify(c,{org:s.organization_id,audience:'staff',title:'Formule à renouveler',message,tab:'clients',dedupe:`sub:${step}:staff:${s.organization_id}:${s.day}`});
    }
    const overdue=await c.query(`SELECT id,number,organization_id,total_minor,currency FROM invoices WHERE status='sent' AND due_at<current_date`);
    for(const i of overdue.rows) {
      const label=invoiceNumber(i.number);
      await notify(c,{org:i.organization_id,audience:'client',title:'Rappel : facture '+label+' en attente',message:`La facture ${label} (${formatMoney(i.total_minor,i.currency)}) a dépassé son échéance. Merci de procéder au règlement.`,tab:'billing',dedupe:`inv:overdue:client:${i.id}`});
      await notify(c,{org:i.organization_id,audience:'staff',title:'Facture en retard',message:`La facture ${label} est en retard de paiement.`,tab:'billing',dedupe:`inv:overdue:staff:${i.id}`});
    }
    return {expiring:expiring.rowCount,overdue:overdue.rowCount};
  });
}
