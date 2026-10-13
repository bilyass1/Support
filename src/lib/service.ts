import type { PoolClient } from 'pg';
import { transaction, pool } from './db';
import { DomainError, creditChange, canMove, checkOpenLimit, type Role, type Rule } from './domain';
import type { Action } from './validation';

export type Actor={id:string; name:string; role:Role; organization_id:string|null};
export async function getActor(id:string,name:string):Promise<Actor> {
  const [role,member]=await Promise.all([
    pool.query('SELECT role FROM app_roles WHERE user_id=$1',[id]),
    pool.query('SELECT organization_id FROM memberships WHERE user_id=$1',[id])
  ]);
  return {id,name,role:role.rows[0]?.role??'client',organization_id:member.rows[0]?.organization_id??null};
}
function staff(actor:Actor) { if(actor.role==='client') throw new DomainError('Accès réservé à l’équipe.',403); }
function admin(actor:Actor) { if(actor.role!=='admin') throw new DomainError('Accès réservé à l’admin.',403); }
function own(actor:Actor,organizationId:string) {
  if(actor.role==='client' && actor.organization_id!==organizationId) throw new DomainError('Accès refusé.',403);
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
async function credits(c:PoolClient,actor:Actor,org:string,ticket:string|null,kind:string,balanceDelta:number,reservedDelta:number,note:string) {
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
      staff(actor);
      const result=await c.query('INSERT INTO applications(organization_id,name,kind) VALUES ($1,$2,$3) RETURNING id',[input.organization_id,input.name,input.kind]);
      await audit(c,actor,input.type,result.rows[0].id,input);
      return result.rows[0];
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
      const org=await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id]);
      if(!org.rowCount) throw new DomainError('Client introuvable.',404);
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
    if(input.type==='create_ticket') {
      const application=await c.query('SELECT * FROM applications WHERE id=$1',[input.application_id]);
      if(!application.rowCount) throw new DomainError('Application introuvable.',404);
      const org=application.rows[0].organization_id;
      own(actor,org);
      await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
      const subscription=await activeSubscription(c,org);
      const count=await c.query("SELECT count(*)::int AS count FROM tickets WHERE organization_id=$1 AND status NOT IN ('closed','cancelled')",[org]);
      checkOpenLimit(subscription.snapshot.rules as Rule[],count.rows[0].count);
      const result=await c.query('INSERT INTO tickets(organization_id,application_id,created_by,title,description,category) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,number',[org,input.application_id,actor.id,input.title,input.description,input.category]);
      await audit(c,actor,input.type,result.rows[0].id,{category:input.category});
      return result.rows[0];
    }
    const result=await c.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE',[input.ticket_id]);
    if(!result.rowCount) throw new DomainError('Ticket introuvable.',404);
    const ticket=result.rows[0];
    own(actor,ticket.organization_id);
    if(input.type==='quote') {
      staff(actor);
      if(!['new','quoted'].includes(ticket.status)) throw new DomainError('Ce ticket a déjà été validé.',409);
      await c.query("UPDATE tickets SET estimated_tokens=$2,estimate_note=$3,estimate_revision=estimate_revision+1,status='quoted',updated_at=now() WHERE id=$1",[ticket.id,input.tokens,input.note]);
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
      await c.query('UPDATE tickets SET status=$2,updated_at=now() WHERE id=$1',[ticket.id,input.status]);
      await notify(c,ticket.organization_id,`Ticket #${ticket.number} : statut ${input.status}.`);
    } else if(input.type==='comment') {
      await c.query('INSERT INTO ticket_comments(ticket_id,author_id,body) VALUES ($1,$2,$3)',[ticket.id,actor.id,input.body]);
      await notify(c,ticket.organization_id,`Nouveau commentaire sur le ticket #${ticket.number}.`);
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
  const organizationQuery=`SELECT o.*,w.balance,w.reserved,s.snapshot,s.ends_at FROM organizations o JOIN wallets w ON w.organization_id=o.id LEFT JOIN subscriptions s ON s.organization_id=o.id${predicate} ORDER BY o.name`;
  const filter=scoped?' WHERE organization_id=$1':'';
  const [organizations,applications,plans,tickets,ledger,notifications,comments]=await Promise.all([
    pool.query(organizationQuery,values),
    pool.query(`SELECT * FROM applications${filter} ORDER BY name`,values),
    scoped?Promise.resolve({rows:[]}):pool.query('SELECT * FROM plans ORDER BY name'),
    pool.query(`SELECT * FROM tickets${filter} ORDER BY created_at DESC LIMIT 100`,values),
    pool.query(`SELECT * FROM credit_ledger${filter} ORDER BY created_at DESC LIMIT 100`,values),
    pool.query(`SELECT * FROM notifications${filter} ORDER BY created_at DESC LIMIT 30`,values),
    pool.query(`SELECT c.*,u.name AS author_name FROM ticket_comments c JOIN tickets t ON t.id=c.ticket_id LEFT JOIN "user" u ON u.id=c.author_id${scoped?' WHERE t.organization_id=$1':''} ORDER BY c.created_at DESC LIMIT 200`,values)
  ]);
  return {actor,organizations:organizations.rows,applications:applications.rows,plans:plans.rows,tickets:tickets.rows,ledger:ledger.rows,notifications:notifications.rows,comments:comments.rows};
}
