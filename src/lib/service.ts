import type { PoolClient } from 'pg';
import { transaction, pool } from './db';
import { DomainError, creditChange, canMove, checkOpenLimit, statusLabels, priorityLabels, type Role, type Rule, type Module, type TicketStatus } from './domain';
import type { Action } from './validation';

export type Actor={id:string; name:string; role:Role; organization_id:string|null};
export async function getActor(id:string,name:string):Promise<Actor> {
  const [role,member]=await Promise.all([
    pool.query('SELECT role FROM app_roles WHERE user_id=$1',[id]),
    pool.query('SELECT organization_id FROM memberships WHERE user_id=$1',[id])
  ]);
  return {id,name,role:role.rows[0]?.role==='admin'?'admin':'client',organization_id:member.rows[0]?.organization_id??null};
}
function staff(actor:Actor) { if(actor.role==='client') throw new DomainError('Accès réservé à l’équipe.',403); }
function admin(actor:Actor) { if(actor.role!=='admin') throw new DomainError('Accès réservé à l’admin.',403); }
function own(actor:Actor,organizationId:string) {
  if(actor.role==='client' && actor.organization_id!==organizationId) throw new DomainError('Accès refusé.',403);
}
/** A client only reaches the modules the admin enabled for its organization. Enforced on the server for every read and action. */
export async function moduleOn(c:Pick<PoolClient,'query'>,actor:Actor,organizationId:string|null,module:Module) {
  if(actor.role!=='client') return;
  if(!organizationId || actor.organization_id!==organizationId) throw new DomainError('Accès refusé.',403);
  const enabled=await c.query('SELECT 1 FROM organizations WHERE id=$1 AND $2=ANY(modules)',[organizationId,module]);
  if(!enabled.rowCount) throw new DomainError('Ce module n’est pas activé pour votre espace.',403);
}
async function audit(c:PoolClient,actor:Actor,action:string,id:string,detail:unknown) {
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES ($1,$2,$3,$4)',[actor.id,action,id,JSON.stringify(detail)]);
}
async function notify(c:PoolClient,org:string,message:string) {
  await c.query('INSERT INTO notifications(organization_id,message) VALUES ($1,$2)',[org,message]);
}
async function activeSubscription(c:PoolClient,org:string) {
  const result=await c.query('SELECT * FROM subscriptions WHERE organization_id=$1 AND ends_at>now()',[org]);
  if(!result.rowCount) throw new DomainError('Une formule active est nécessaire.',409);
  return result.rows[0];
}
export async function credits(c:PoolClient,actor:Actor,org:string,ticket:string|null,kind:string,balanceDelta:number,reservedDelta:number,note:string) {
  const wallet=await c.query('SELECT balance,reserved FROM wallets WHERE organization_id=$1 FOR UPDATE',[org]);
  if(!wallet.rowCount) throw new DomainError('Portefeuille introuvable.',404);
  const next=creditChange(wallet.rows[0].balance,wallet.rows[0].reserved,balanceDelta,reservedDelta);
  await c.query('UPDATE wallets SET balance=$2,reserved=$3 WHERE organization_id=$1',[org,next.balance,next.reserved]);
  await c.query('INSERT INTO credit_ledger(organization_id,ticket_id,kind,balance_delta,reserved_delta,note,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',[org,ticket,kind,balanceDelta,reservedDelta,note,actor.id]);
}
export async function act(actor:Actor,input:Action) {
  return transaction(async c=>{
    if(input.type==='create_organization') {
      admin(actor);
      const user=await c.query('SELECT id FROM "user" WHERE lower(email)=lower($1)',[input.email]);
      if(!user.rowCount) throw new DomainError('Le client doit d’abord créer son compte.',409);
      if((await c.query('SELECT user_id FROM app_roles WHERE user_id=$1',[user.rows[0].id])).rowCount)throw new DomainError('Un compte d’équipe ne peut pas devenir le compte d’un client.',409);
      const member=await c.query('SELECT user_id FROM memberships WHERE user_id=$1',[user.rows[0].id]);
      if(member.rowCount) throw new DomainError('Ce compte est déjà associé à un client.',409);
      const org=await c.query('INSERT INTO organizations(name) VALUES ($1) RETURNING id',[input.name]);
      const id=org.rows[0].id;
      await c.query('INSERT INTO memberships(user_id,organization_id) VALUES ($1,$2)',[user.rows[0].id,id]);
      await c.query('INSERT INTO wallets(organization_id) VALUES ($1)',[id]);
      await audit(c,actor,input.type,id,{name:input.name});
      return {id};
    }
    if(input.type==='create_application') {
      admin(actor);
      if(!(await c.query('SELECT 1 FROM organizations WHERE id=$1',[input.organization_id])).rowCount) throw new DomainError('Client introuvable.',404);
      const result=await c.query('INSERT INTO applications(organization_id,name,kind) VALUES ($1,$2,$3) RETURNING id',[input.organization_id,input.name,input.kind]);
      await audit(c,actor,input.type,result.rows[0].id,input);
      return result.rows[0];
    }
    if(input.type==='save_plan') {
      admin(actor);
      if(input.mail_per_box_mb>input.mail_total_mb) throw new DomainError('Quota par boîte supérieur au stockage du pack.',400);
      const values=[input.name,input.annual_tokens,input.price_minor,input.currency,input.support_level,JSON.stringify(input.rules),input.mail_max_mailboxes,input.mail_total_mb,input.mail_per_box_mb,input.mail_create_tokens];
      const result=input.id
        ? await c.query('UPDATE plans SET name=$1,annual_tokens=$2,price_minor=$3,currency=$4,support_level=$5,rules=$6,mail_max_mailboxes=$7,mail_total_mb=$8,mail_per_box_mb=$9,mail_create_tokens=$10,revision=revision+1 WHERE id=$11 RETURNING *',[...values,input.id])
        : await c.query('INSERT INTO plans(name,annual_tokens,price_minor,currency,support_level,rules,mail_max_mailboxes,mail_total_mb,mail_per_box_mb,mail_create_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',values);
      if(!result.rowCount) throw new DomainError('Formule introuvable.',404);
      const plan=result.rows[0];
      if(input.apply_to_existing) {
        // Mail creation uses the same organization lock: do not lower a live
        // allocation underneath existing mailboxes or concurrent creations.
        await c.query('SELECT o.id FROM organizations o JOIN subscriptions s ON s.organization_id=o.id WHERE s.plan_id=$1 ORDER BY o.id FOR UPDATE OF o',[plan.id]);
        const exceeds=await c.query(`SELECT s.organization_id FROM subscriptions s JOIN email_domains d ON d.organization_id=s.organization_id JOIN email_mailboxes b ON b.domain_id=d.id AND b.status<>'cancelled' WHERE s.plan_id=$1 GROUP BY s.organization_id HAVING count(*)>$2 OR sum(b.quota_mb)>$3 OR max(b.quota_mb)>$4`,[plan.id,plan.mail_max_mailboxes,plan.mail_total_mb,plan.mail_per_box_mb]);
        if(exceeds.rowCount) throw new DomainError('Ce pack est inférieur aux boîtes ou au stockage déjà alloués.',409);
        await c.query('UPDATE subscriptions SET snapshot=$2 WHERE plan_id=$1',[plan.id,JSON.stringify(plan)]);
      }
      await audit(c,actor,input.type,plan.id,{...input,revision:plan.revision});
      return {id:plan.id};
    }
    if(input.type==='assign_plan') {
      admin(actor);
      // Serialize grants and reassignment for the same organization.
      const org=await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id]);
      if(!org.rowCount) throw new DomainError('Client introuvable.',404);
      const result=await c.query('SELECT * FROM plans WHERE id=$1',[input.plan_id]);
      if(!result.rowCount) throw new DomainError('Formule introuvable.',404);
      const plan=result.rows[0];
      const allocated=await c.query(`SELECT count(*)::int AS count,coalesce(sum(b.quota_mb),0)::int AS quota,coalesce(max(b.quota_mb),0)::int AS per_box FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id=$1 AND b.status<>'cancelled'`,[input.organization_id]);
      if(allocated.rows[0].count>plan.mail_max_mailboxes || allocated.rows[0].quota>plan.mail_total_mb || allocated.rows[0].per_box>plan.mail_per_box_mb) throw new DomainError('Ce pack est inférieur aux boîtes ou au stockage déjà alloués.',409);
      const subscription=await c.query('SELECT * FROM subscriptions WHERE organization_id=$1',[input.organization_id]);
      if(subscription.rowCount) {
        await c.query('UPDATE subscriptions SET plan_id=$2,snapshot=$3 WHERE organization_id=$1',[input.organization_id,plan.id,JSON.stringify(plan)]);
      } else {
        await c.query('INSERT INTO subscriptions(organization_id,plan_id,snapshot) VALUES ($1,$2,$3)',[input.organization_id,plan.id,JSON.stringify(plan)]);
        await credits(c,actor,input.organization_id,null,'annual_allocation',plan.annual_tokens,0,'Attribution initiale du quota annuel');
      }
      await audit(c,actor,input.type,input.organization_id,{plan_id:plan.id,revision:plan.revision});
      await notify(c,input.organization_id,'Votre formule a été mise à jour : '+plan.name);
      return {ok:true};
    }
    if(input.type==='recharge') {
      admin(actor);
      await credits(c,actor,input.organization_id,null,'manual_recharge',input.tokens,0,input.note);
      await audit(c,actor,input.type,input.organization_id,input);
      await notify(c,input.organization_id,`${input.tokens} crédits ont été ajoutés à votre solde.`);
      return {ok:true};
    }
    if(input.type==='renew_subscription') {
      admin(actor);
      if(!(await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id])).rowCount) throw new DomainError('Client introuvable.',404);
      // A year from the current end date, or from today when the plan had already expired.
      const renewed=await c.query("UPDATE subscriptions SET ends_at=greatest(ends_at,now())+interval '1 year' WHERE organization_id=$1 RETURNING snapshot,ends_at",[input.organization_id]);
      if(!renewed.rowCount) throw new DomainError('Attribuez d’abord une formule à ce client.',409);
      const snapshot=renewed.rows[0].snapshot as {name:string;annual_tokens:number};
      await credits(c,actor,input.organization_id,null,'annual_allocation',snapshot.annual_tokens,0,'Renouvellement annuel de la formule '+snapshot.name);
      await audit(c,actor,input.type,input.organization_id,{ends_at:renewed.rows[0].ends_at});
      await notify(c,input.organization_id,`Votre formule ${snapshot.name} est renouvelée pour un an : ${snapshot.annual_tokens} tokens ajoutés.`);
      return {ok:true};
    }
    if(input.type==='announce') {
      admin(actor);
      const targets=await c.query('SELECT id FROM organizations WHERE $1::uuid IS NULL OR id=$1',[input.organization_id]);
      if(input.organization_id&&!targets.rowCount) throw new DomainError('Client introuvable.',404);
      const created=await c.query('INSERT INTO announcements(organization_id,title,body,author_id) VALUES ($1,$2,$3,$4) RETURNING id',[input.organization_id,input.title,input.body,actor.id]);
      for(const target of targets.rows) await notify(c,target.id,input.title+' — '+input.body);
      await audit(c,actor,input.type,created.rows[0].id,{title:input.title,organization_id:input.organization_id});
      return {ok:true};
    }
    if(input.type==='create_ticket') {
      const application=await c.query('SELECT * FROM applications WHERE id=$1',[input.application_id]);
      if(!application.rowCount) throw new DomainError('Application introuvable.',404);
      const org=application.rows[0].organization_id;
      own(actor,org);
      await moduleOn(c,actor,org,'tickets');
      await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
      const subscription=await activeSubscription(c,org);
      const count=await c.query("SELECT count(*)::int AS count FROM tickets WHERE organization_id=$1 AND status NOT IN ('closed','cancelled')",[org]);
      checkOpenLimit(subscription.snapshot.rules as Rule[],count.rows[0].count);
      const result=await c.query('INSERT INTO tickets(organization_id,application_id,created_by,title,description,category,priority) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,number',[org,input.application_id,actor.id,input.title,input.description,input.category,input.priority??'normal']);
      await audit(c,actor,input.type,result.rows[0].id,{category:input.category,priority:input.priority??'normal'});
      return result.rows[0];
    }
    const result=await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[input.ticket_id]);
    if(!result.rowCount) throw new DomainError('Ticket introuvable.',404);
    const ticket=result.rows[0];
    own(actor,ticket.organization_id);
    await moduleOn(c,actor,ticket.organization_id,'tickets');
    if(input.type==='quote') {
      staff(actor);
      if(!['new','quoted'].includes(ticket.status)) throw new DomainError('Ce ticket a déjà été validé.',409);
      await c.query("UPDATE tickets SET estimated_tokens=$2,estimate_note=$3,estimate_revision=estimate_revision+1,status='quoted',first_response_at=coalesce(first_response_at,now()),updated_at=now() WHERE id=$1",[ticket.id,input.tokens,input.note]);
      await notify(c,ticket.organization_id,`Ticket #${ticket.number} : estimation de ${input.tokens} crédits à valider.`);
    } else if(input.type==='accept') {
      if(actor.role!=='client') throw new DomainError('La validation appartient au client.',403);
      if(ticket.status!=='quoted' || ticket.estimate_revision!==input.estimate_revision) throw new DomainError('L’estimation a changé ou a déjà été validée. Actualisez le ticket.',409);
      await activeSubscription(c,ticket.organization_id);
      await credits(c,actor,ticket.organization_id,ticket.id,'reserve',0,ticket.estimated_tokens,`Acceptation de l’estimation v${ticket.estimate_revision}`);
      await c.query("UPDATE tickets SET status='accepted',updated_at=now() WHERE id=$1",[ticket.id]);
      await notify(c,ticket.organization_id,`Ticket #${ticket.number} validé : crédits réservés.`);
    } else if(input.type==='move') {
      if(actor.role==='client' && !(input.status==='closed' && ticket.status==='ready') && !(input.status==='cancelled' && ['new','quoted'].includes(ticket.status))) {
        throw new DomainError('Cette action appartient à l’équipe.',403);
      }
      canMove(ticket.status,input.status);
      if(input.status==='closed') {
        await credits(c,actor,ticket.organization_id,ticket.id,'consume',-ticket.estimated_tokens,-ticket.estimated_tokens,'Livraison validée et ticket clôturé');
      } else if(input.status==='cancelled' && ['accepted','in_progress','ready'].includes(ticket.status)) {
        await credits(c,actor,ticket.organization_id,ticket.id,'release',0,-ticket.estimated_tokens,'Réservation libérée après annulation');
      }
      await c.query("UPDATE tickets SET status=$2,closed_at=CASE WHEN $2='closed' THEN now() ELSE closed_at END,updated_at=now() WHERE id=$1",[ticket.id,input.status]);
      await notify(c,ticket.organization_id,`Ticket #${ticket.number} « ${ticket.title} » : ${statusLabels[input.status as TicketStatus].toLowerCase()}.`);
    } else if(input.type==='comment') {
      const internal=input.internal===true;
      if(internal) staff(actor);
      await c.query('INSERT INTO ticket_comments(ticket_id,author_id,body,internal) VALUES ($1,$2,$3,$4)',[ticket.id,actor.id,input.body,internal]);
      if(actor.role!=='client'&&!internal) await c.query('UPDATE tickets SET first_response_at=coalesce(first_response_at,now()) WHERE id=$1',[ticket.id]);
      // An internal note stays inside the team: the client is neither shown nor notified.
      if(!internal) await notify(c,ticket.organization_id,`Nouveau commentaire sur le ticket #${ticket.number}.`);
    } else if(input.type==='set_priority') {
      staff(actor);
      await c.query('UPDATE tickets SET priority=$2,updated_at=now() WHERE id=$1',[ticket.id,input.priority]);
      await notify(c,ticket.organization_id,`Ticket #${ticket.number} : priorité ${priorityLabels[input.priority].toLowerCase()}.`);
    } else if(input.type==='rate') {
      if(actor.role!=='client') throw new DomainError('La note de satisfaction appartient au client.',403);
      if(ticket.status!=='closed') throw new DomainError('Seule une demande clôturée peut être notée.',409);
      await c.query('UPDATE tickets SET rating=$2,rating_comment=$3 WHERE id=$1',[ticket.id,input.rating,input.comment||null]);
    }
    await audit(c,actor,input.type,ticket.id,input);
    return {ok:true};
  });
}

export async function workspace(actor:Actor) {
  const scoped=actor.role==='client';
  const org=actor.organization_id;
  const predicate=scoped?' WHERE o.id=$1':'';
  const values=scoped?[org]:[];
  const organizationQuery=`SELECT o.*,(SELECT coalesce(json_agg(d.domain),'[]'::json) FROM email_domains d WHERE d.organization_id=o.id) AS domains,w.balance,w.reserved,s.snapshot,s.ends_at FROM organizations o JOIN wallets w ON w.organization_id=o.id LEFT JOIN subscriptions s ON s.organization_id=o.id${predicate} ORDER BY o.name`;
  const filter=scoped?' WHERE organization_id=$1':'';
  const organizations=await pool.query(organizationQuery,values);
  // Staff see everything; a client sees only what its organization has been granted.
  const modules:string[]=scoped?organizations.rows[0]?.modules??[]:['tokens','billing','support','tickets','mail','usage'];
  const has=(module:Module)=>modules.includes(module);
  const none=Promise.resolve({rows:[] as Record<string,unknown>[]});
  const [applications,plans,tickets,ledger,notifications,appUsage]=await Promise.all([
    pool.query(`SELECT id,organization_id,name,kind,last_seen_at,last_version,(ingest_key_hash IS NOT NULL) AS tracked FROM applications${filter} ORDER BY name`,values),
    scoped?none:pool.query('SELECT * FROM plans ORDER BY name'),
    has('tickets')?pool.query(`SELECT * FROM tickets${filter} ORDER BY created_at DESC LIMIT 100`,values):none,
    has('tokens')?pool.query(`SELECT * FROM credit_ledger${filter} ORDER BY created_at DESC LIMIT 100`,values):none,
    pool.query(`SELECT * FROM notifications${filter} ORDER BY created_at DESC LIMIT 30`,values),
    has('usage')?pool.query(`SELECT d.application_id,d.day::text AS day,d.events,d.sessions,d.errors,(SELECT count(*)::int FROM app_usage_users u WHERE u.application_id=d.application_id AND u.day=d.day) AS users
      FROM app_usage_daily d JOIN applications a ON a.id=d.application_id WHERE d.day>current_date-30${scoped?' AND a.organization_id=$1':''} ORDER BY d.day`,values):none
  ]);
  // Every comment of the listed tickets: a global cap used to empty the discussion of older tickets.
  const ticketIds=tickets.rows.map(t=>t.id);
  const empty={rows:[] as Record<string,unknown>[]};
  // Internal notes never leave the team: they are filtered out here, not in the interface.
  const [comments,attachments,announcements]=await Promise.all([
    ticketIds.length?pool.query(`SELECT c.*,u.name AS author_name,EXISTS(SELECT 1 FROM app_roles r WHERE r.user_id=c.author_id) AS from_staff FROM ticket_comments c LEFT JOIN "user" u ON u.id=c.author_id WHERE c.ticket_id=ANY($1::uuid[])${scoped?' AND NOT c.internal':''} ORDER BY c.created_at DESC`,[ticketIds]):empty,
    ticketIds.length?pool.query('SELECT id,ticket_id,name,size,created_at FROM ticket_attachments WHERE ticket_id=ANY($1::uuid[]) ORDER BY created_at',[ticketIds]):empty,
    pool.query(`SELECT id,organization_id,title,body,created_at FROM announcements${scoped?' WHERE organization_id IS NULL OR organization_id=$1':''} ORDER BY created_at DESC LIMIT 10`,values)
  ]);
  return {actor,modules,organizations:organizations.rows,applications:applications.rows,plans:plans.rows,tickets:tickets.rows,ledger:ledger.rows,notifications:notifications.rows,comments:comments.rows,attachments:attachments.rows,announcements:announcements.rows,app_usage:appUsage.rows};
}
