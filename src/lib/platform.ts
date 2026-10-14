import { z } from 'zod';
import { pool, transaction } from './db';
import { credits, type Actor } from './service';
import { DomainError } from './domain';

const id=z.uuid(), text=z.string().trim().min(3).max(2000);
const amount=z.number().int().min(0).max(100_000_000);
export const platformSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('save_offer'),id:id.optional(),name:text,tokens:amount.refine(v=>v>0),price_minor:amount,currency:z.enum(['TND','EUR','USD']),active:z.boolean()}),
 z.object({type:z.literal('request_tokens'),organization_id:id,offer_id:id,note:z.string().trim().max(500)}),
 z.object({type:z.literal('review_purchase'),id,approved:z.boolean(),payment_verified:z.boolean(),note:text}),
 z.object({type:z.literal('create_support'),organization_id:id,title:z.string().trim().min(3).max(160),body:z.string().trim().min(10).max(10000)}),
 z.object({type:z.literal('reply_support'),id,body:z.string().trim().min(1).max(5000),close:z.boolean().default(false)}),
 z.object({type:z.literal('save_issuer'),name:text,address:text,tax_id:text}),
 z.object({type:z.literal('issue_invoice'),organization_id:id,description:text,amount_minor:amount,currency:z.enum(['TND','EUR','USD']),due_at:z.iso.date()}),
 z.object({type:z.literal('invoice_status'),id,status:z.enum(['paid','void']),note:text}),
 z.object({type:z.literal('read_notification'),id}),
 z.object({type:z.literal('reset_mfa'),user_id:z.string().min(1).max(200),reason:z.string().trim().min(15).max(1000),identity_verified:z.literal(true),admin_password:z.string().min(12).max(128)})
]);
export type PlatformAction=z.infer<typeof platformSchema>;
function admin(actor:Actor){if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);}
function own(actor:Actor,org:string){if(actor.role==='client'&&actor.organization_id!==org)throw new DomainError('Accès refusé.',403);}
export async function platformAct(actor:Actor,input:PlatformAction){
 return transaction(async c=>{
  const audit=async(action:string,entity:string,detail:unknown)=>c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)',[actor.id,action,entity,JSON.stringify(detail)]);
  const notify=async(org:string,message:string)=>c.query('INSERT INTO notifications(organization_id,message) VALUES($1,$2)',[org,message]);
  const invoice=async(org:string,description:string,price:number,currency:string,due:string,purchase:string|null,paid:boolean)=>{
   const issuer=(await c.query("SELECT value FROM platform_settings WHERE key='issuer'")).rows[0]?.value;
   if(!issuer?.name||!issuer?.address||!issuer?.tax_id)throw new DomainError('Configurez les coordonnées de facturation avant émission ou approbation.',409);
   const client=(await c.query('SELECT name FROM organizations WHERE id=$1',[org])).rows[0];
   if(!client)throw new DomainError('Client introuvable.',404);
   const n=(await c.query("SELECT nextval('invoice_number') AS n")).rows[0].n;
   const number='SF-'+new Date().getUTCFullYear()+'-'+String(n).padStart(6,'0');
   const r=await c.query(`INSERT INTO invoices(number,organization_id,purchase_id,description,amount_minor,currency,status,issuer,client_name,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[number,org,purchase,description,price,currency,paid?'paid':'issued',JSON.stringify(issuer),client.name,due,actor.id]);
   await notify(org,'Nouvelle facture '+number+' disponible dans votre espace.'); return r.rows[0].id;
  };
  if(input.type==='save_offer'){
   admin(actor);const values=[input.name,input.tokens,input.price_minor,input.currency,input.active];
   const r=input.id?await c.query('UPDATE token_offers SET name=$1,tokens=$2,price_minor=$3,currency=$4,active=$5 WHERE id=$6 RETURNING id',[...values,input.id]):await c.query('INSERT INTO token_offers(name,tokens,price_minor,currency,active) VALUES($1,$2,$3,$4,$5) RETURNING id',values);
   if(!r.rowCount)throw new DomainError('Offre introuvable.',404);await audit(input.type,r.rows[0].id,input);return {message:'Offre enregistrée.'};
  }
  if(input.type==='request_tokens'){
   own(actor,input.organization_id);const offer=(await c.query('SELECT * FROM token_offers WHERE id=$1 AND active=true',[input.offer_id])).rows[0];
   if(!offer)throw new DomainError('Offre indisponible.',409);
   const org=await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id]);if(!org.rowCount)throw new DomainError('Client introuvable.',404);
   const pending=await c.query("SELECT id FROM purchase_requests WHERE organization_id=$1 AND status='pending'",[input.organization_id]);if((pending.rowCount??0)>=5)throw new DomainError('Cinq demandes sont déjà en attente.',409);
   const r=await c.query('INSERT INTO purchase_requests(organization_id,requested_by,offer_id,snapshot,note) VALUES($1,$2,$3,$4,$5) RETURNING id',[input.organization_id,actor.id,offer.id,JSON.stringify(offer),input.note]);
   await audit(input.type,r.rows[0].id,{offer_id:offer.id});await notify(input.organization_id,'Recharge demandée : '+offer.tokens+' tokens. Aucun crédit avant validation de l’admin.');return {message:'Demande transmise à l’admin, sans ajout de tokens.'};
  }
  if(input.type==='review_purchase'){
   admin(actor);const r=await c.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE',[input.id]);const purchase=r.rows[0];if(!purchase)throw new DomainError('Demande introuvable.',404);if(purchase.status!=='pending')throw new DomainError('Demande déjà traitée.',409);
   if(input.approved){if(!input.payment_verified)throw new DomainError('Attestez le paiement vérifié avant de créditer.',400);
    await credits(c,actor,purchase.organization_id,null,'approved_purchase',purchase.snapshot.tokens,0,'Recharge approuvée '+purchase.id);
    await invoice(purchase.organization_id,purchase.snapshot.name,purchase.snapshot.price_minor,purchase.snapshot.currency,new Date().toISOString().slice(0,10),purchase.id,true);
   }
   await c.query('UPDATE purchase_requests SET status=$2,reviewed_by=$3,reviewed_at=now(),note=$4 WHERE id=$1',[purchase.id,input.approved?'approved':'rejected',actor.id,input.note]);
   await audit(input.type,purchase.id,{approved:input.approved,note:input.note});await notify(purchase.organization_id,input.approved?'Recharge approuvée, tokens crédités.':'Demande de recharge refusée.');return {message:'Décision enregistrée.'};
  }
  if(input.type==='create_support'){
   own(actor,input.organization_id);await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id]);const count=(await c.query("SELECT count(*)::int AS n FROM support_cases WHERE organization_id=$1 AND status<>'closed'",[input.organization_id])).rows[0].n;if(count>=20)throw new DomainError('Vingt tickets sont déjà ouverts.',409);const r=await c.query('INSERT INTO support_cases(organization_id,created_by,title,body) VALUES($1,$2,$3,$4) RETURNING id',[input.organization_id,actor.id,input.title,input.body]);await audit(input.type,r.rows[0].id,{title:input.title});await notify(input.organization_id,'Ticket de support ouvert : '+input.title);return {message:'Ticket de support créé, sans consommation de tokens.'};
  }
  if(input.type==='reply_support'){
   const support=(await c.query('SELECT * FROM support_cases WHERE id=$1 FOR UPDATE',[input.id])).rows[0];if(!support)throw new DomainError('Ticket introuvable.',404);own(actor,support.organization_id);
   await c.query('INSERT INTO support_replies(case_id,author_id,body) VALUES($1,$2,$3)',[input.id,actor.id,input.body]);
   await c.query('UPDATE support_cases SET status=$2 WHERE id=$1',[input.id,input.close?'closed':actor.role==='client'?'open':'answered']);await notify(support.organization_id,'Réponse au ticket : '+support.title);return {message:'Réponse enregistrée.'};
  }
  if(input.type==='save_issuer'){admin(actor);await c.query("INSERT INTO platform_settings(key,value) VALUES('issuer',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify({name:input.name,address:input.address,tax_id:input.tax_id})]);await audit(input.type,'issuer',{});return {message:'Coordonnées enregistrées.'};}
  if(input.type==='issue_invoice'){admin(actor);const entity=await invoice(input.organization_id,input.description,input.amount_minor,input.currency,input.due_at,null,false);await audit(input.type,entity,input);return {message:'Facture émise et notification créée.'};}
  if(input.type==='invoice_status'){admin(actor);const r=await c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[input.id]);if(!r.rowCount)throw new DomainError('Facture introuvable.',404);if(r.rows[0].status!=='issued')throw new DomainError('Facture déjà traitée.',409);await c.query('UPDATE invoices SET status=$2 WHERE id=$1',[input.id,input.status]);await audit(input.type,input.id,{status:input.status,note:input.note});await notify(r.rows[0].organization_id,'Facture '+r.rows[0].number+' : '+input.status);return {message:'Statut enregistré, sans recharge automatique.'};}
  if(input.type==='read_notification'){const r=await c.query('SELECT organization_id FROM notifications WHERE id=$1',[input.id]);if(!r.rowCount)throw new DomainError('Notification introuvable.',404);own(actor,r.rows[0].organization_id);await c.query('UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1',[input.id]);return {message:'Notification lue.'};}
  if(input.type==='reset_mfa'){
   admin(actor);if(input.user_id===actor.id)throw new DomainError('Un admin ne peut pas retirer sa propre protection ici.',409);
   const role=(await c.query('SELECT role FROM app_roles WHERE user_id=$1',[input.user_id])).rows[0];if(role)throw new DomainError('Ce parcours de récupération est réservé aux clients.',403);
   const user=(await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[input.user_id])).rows[0];if(!user)throw new DomainError('Compte introuvable.',404);
   await c.query('DELETE FROM "twoFactor" WHERE "userId"=$1',[input.user_id]);await c.query('UPDATE "user" SET "twoFactorEnabled"=false WHERE id=$1',[input.user_id]);await c.query('DELETE FROM "session" WHERE "userId"=$1',[input.user_id]);
   await audit(input.type,input.user_id,{reason:input.reason,identity_verified:true});const membership=(await c.query('SELECT organization_id FROM memberships WHERE user_id=$1',[input.user_id])).rows[0];if(membership)await notify(membership.organization_id,'Votre authenticator a été réinitialisé par l’admin. Réinscription obligatoire à la prochaine connexion.');return {message:'Authenticator réinitialisé et sessions révoquées.'};
  }
  throw new DomainError('Action inconnue.',400);
 });
}
export async function platformWorkspace(actor:Actor){
 const scoped=actor.role==='client', args=scoped?[actor.organization_id]:[];
 const filter=scoped?' WHERE organization_id=$1':'';
 const [offers,purchases,invoices,cases,replies,usage,users,issuer,delivery]=await Promise.all([
  pool.query('SELECT * FROM token_offers'+(scoped?' WHERE active=true':'')+' ORDER BY tokens'),
  pool.query('SELECT * FROM purchase_requests'+filter+' ORDER BY created_at DESC LIMIT 100',args),
  pool.query('SELECT * FROM invoices'+filter+' ORDER BY issued_at DESC LIMIT 100',args),
  pool.query('SELECT * FROM support_cases'+filter+' ORDER BY created_at DESC LIMIT 100',args),
  pool.query(`SELECT r.*,u.name AS author_name FROM support_replies r JOIN support_cases c ON c.id=r.case_id LEFT JOIN "user" u ON u.id=r.author_id${scoped?' WHERE c.organization_id=$1':''} ORDER BY r.created_at DESC LIMIT 500`,args),
  pool.query(`SELECT organization_id,created_at::date::text AS day,sum(greatest(-balance_delta,0))::int AS consumed FROM credit_ledger WHERE created_at>=now()-interval '90 days'${scoped?' AND organization_id=$1':''} GROUP BY organization_id,created_at::date ORDER BY day`,args),
  actor.role==='admin'?pool.query('SELECT u.id,u.name,u.email,u."twoFactorEnabled",m.organization_id FROM "user" u JOIN memberships m ON m.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM app_roles a WHERE a.user_id=u.id) ORDER BY u.name'):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query("SELECT value FROM platform_settings WHERE key='issuer'"):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query("SELECT count(*) FILTER(WHERE attempts<5)::int AS pending,count(*) FILTER(WHERE attempts>=5)::int AS failed FROM (SELECT attempts FROM notification_outbox WHERE delivered_at IS NULL UNION ALL SELECT attempts FROM auth_email_jobs WHERE delivered_at IS NULL AND expires_at>now()) jobs"):Promise.resolve({rows:[]})
 ]);
 return {offers:offers.rows,purchases:purchases.rows,invoices:invoices.rows,cases:cases.rows,replies:replies.rows,usage:usage.rows,users:users.rows,issuer:issuer.rows[0]?.value??null,delivery:delivery.rows[0]??null};
}
