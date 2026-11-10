import { z } from 'zod';
import { pool, transaction } from './db';
import { createHash, randomBytes } from 'node:crypto';
import { credits, moduleOn, type Actor } from './service';
import { DomainError, MODULES } from './domain';
import { monitorUrl } from './monitor.mjs';

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
 z.object({type:z.literal('read_all_notifications')}),
 z.object({type:z.literal('save_site'),id:id.optional(),organization_id:id,label:z.string().trim().min(2).max(80),url:z.string().trim().min(8).max(300),domain_expires_at:z.iso.date().nullish(),enabled:z.boolean().default(true)}),
 z.object({type:z.literal('delete_site'),id}),
 z.object({type:z.literal('set_modules'),organization_id:id,modules:z.array(z.enum(MODULES)).max(MODULES.length)}),
 z.object({type:z.literal('rotate_app_key'),application_id:id}),
 z.object({type:z.literal('reset_mfa'),user_id:z.string().min(1).max(200),reason:z.string().trim().min(15).max(1000),identity_verified:z.literal(true),admin_password:z.string().min(1).max(128)})
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
   const client=(await c.query('SELECT name,tax_id,billing_address FROM organizations WHERE id=$1',[org])).rows[0];
   if(!client)throw new DomainError('Client introuvable.',404);
   if(!client.tax_id||!client.billing_address)throw new DomainError('Complétez le matricule fiscal et l’adresse du client avant émission.',409);
   const n=(await c.query("SELECT nextval('invoice_number') AS n")).rows[0].n;
   const number='SF-'+new Date().getUTCFullYear()+'-'+String(n).padStart(6,'0');
   const r=await c.query(`INSERT INTO invoices(number,organization_id,purchase_id,description,amount_minor,currency,status,issuer,client_name,due_at,created_by,client_tax_id,client_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[number,org,purchase,description,price,currency,paid?'paid':'issued',JSON.stringify(issuer),client.name,due,actor.id,client.tax_id,client.billing_address]);
   await notify(org,'Nouvelle facture '+number+' disponible dans votre espace.'); return r.rows[0].id;
  };
  if(input.type==='save_offer'){
   admin(actor);const values=[input.name,input.tokens,input.price_minor,input.currency,input.active];
   const r=input.id?await c.query('UPDATE token_offers SET name=$1,tokens=$2,price_minor=$3,currency=$4,active=$5 WHERE id=$6 RETURNING id',[...values,input.id]):await c.query('INSERT INTO token_offers(name,tokens,price_minor,currency,active) VALUES($1,$2,$3,$4,$5) RETURNING id',values);
   if(!r.rowCount)throw new DomainError('Offre introuvable.',404);await audit(input.type,r.rows[0].id,input);return {message:'Offre enregistrée.'};
  }
  if(input.type==='request_tokens'){
   own(actor,input.organization_id);await moduleOn(c,actor,input.organization_id,'tokens');const offer=(await c.query('SELECT * FROM token_offers WHERE id=$1 AND active=true',[input.offer_id])).rows[0];
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
   own(actor,input.organization_id);await moduleOn(c,actor,input.organization_id,'support');await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[input.organization_id]);const count=(await c.query("SELECT count(*)::int AS n FROM support_cases WHERE organization_id=$1 AND status<>'closed'",[input.organization_id])).rows[0].n;if(count>=20)throw new DomainError('Vingt tickets sont déjà ouverts.',409);const r=await c.query('INSERT INTO support_cases(organization_id,created_by,title,body) VALUES($1,$2,$3,$4) RETURNING id',[input.organization_id,actor.id,input.title,input.body]);await audit(input.type,r.rows[0].id,{title:input.title});await notify(input.organization_id,'Ticket de support ouvert : '+input.title);return {message:'Ticket de support créé, sans consommation de tokens.'};
  }
  if(input.type==='reply_support'){
   const support=(await c.query('SELECT * FROM support_cases WHERE id=$1 FOR UPDATE',[input.id])).rows[0];if(!support)throw new DomainError('Ticket introuvable.',404);own(actor,support.organization_id);await moduleOn(c,actor,support.organization_id,'support');
   await c.query('INSERT INTO support_replies(case_id,author_id,body) VALUES($1,$2,$3)',[input.id,actor.id,input.body]);
   await c.query('UPDATE support_cases SET status=$2 WHERE id=$1',[input.id,input.close?'closed':actor.role==='client'?'open':'answered']);await notify(support.organization_id,'Réponse au ticket : '+support.title);return {message:'Réponse enregistrée.'};
  }
  if(input.type==='save_issuer'){admin(actor);await c.query("INSERT INTO platform_settings(key,value) VALUES('issuer',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[JSON.stringify({name:input.name,address:input.address,tax_id:input.tax_id})]);await audit(input.type,'issuer',{});return {message:'Coordonnées enregistrées.'};}
  if(input.type==='issue_invoice'){admin(actor);const entity=await invoice(input.organization_id,input.description,input.amount_minor,input.currency,input.due_at,null,false);await audit(input.type,entity,input);return {message:'Facture émise et notification créée.'};}
  if(input.type==='invoice_status'){admin(actor);const r=await c.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[input.id]);if(!r.rowCount)throw new DomainError('Facture introuvable.',404);if(r.rows[0].status!=='issued')throw new DomainError('Facture déjà traitée.',409);await c.query('UPDATE invoices SET status=$2 WHERE id=$1',[input.id,input.status]);await audit(input.type,input.id,{status:input.status,note:input.note});await notify(r.rows[0].organization_id,'Facture '+r.rows[0].number+(input.status==='paid'?' : paiement reçu, merci.':' : annulée.'));return {message:'Statut enregistré, sans recharge automatique.'};}
  if(input.type==='read_notification'){const r=await c.query('SELECT organization_id FROM notifications WHERE id=$1',[input.id]);if(!r.rowCount)throw new DomainError('Notification introuvable.',404);own(actor,r.rows[0].organization_id);await c.query('UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1',[input.id]);return {message:'Notification lue.'};}
  if(input.type==='save_site'){
   admin(actor);
   // Checks run from the server: only public http(s) names are accepted, never an address or an internal host.
   const url=monitorUrl(input.url);
   if(!url)throw new DomainError('Adresse invalide. Utilisez une adresse publique du type https://www.exemple.tn.');
   const values=[input.organization_id,input.label,url,input.domain_expires_at??null,input.enabled];
   const saved=input.id
    ?await c.query("UPDATE monitored_sites SET organization_id=$1,label=$2,url=$3,domain_expires_at=$4,enabled=$5,status=CASE WHEN url=$3 AND $5 THEN status ELSE 'unknown' END,fail_streak=0 WHERE id=$6 RETURNING id",[...values,input.id])
    :await c.query('INSERT INTO monitored_sites(organization_id,label,url,domain_expires_at,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT (organization_id,url) DO NOTHING RETURNING id',values);
   if(!saved.rowCount)throw new DomainError(input.id?'Site introuvable.':'Ce site est déjà surveillé pour ce client.',input.id?404:409);
   await audit(input.type,saved.rows[0].id,{organization_id:input.organization_id,label:input.label});return {message:'Site enregistré. Le premier contrôle a lieu dans les cinq minutes.'};
  }
  if(input.type==='delete_site'){
   admin(actor);const removed=await c.query('DELETE FROM monitored_sites WHERE id=$1 RETURNING id',[input.id]);
   if(!removed.rowCount)throw new DomainError('Site introuvable.',404);
   await audit(input.type,input.id,{});return {message:'Site retiré de la surveillance.'};
  }
  if(input.type==='read_all_notifications'){
   // Read state belongs to the client organization: the team reading a list must not clear it for the client.
   if(actor.role!=='client'||!actor.organization_id)return {message:''};
   await c.query('UPDATE notifications SET read_at=now() WHERE organization_id=$1 AND read_at IS NULL',[actor.organization_id]);return {message:''};
  }
  if(input.type==='set_modules'){
   admin(actor);const modules=[...new Set(input.modules)];
   const r=await c.query('UPDATE organizations SET modules=$2 WHERE id=$1 RETURNING id',[input.organization_id,modules]);if(!r.rowCount)throw new DomainError('Client introuvable.',404);
   await audit(input.type,input.organization_id,{modules});return {message:'Modules du client mis à jour.'};
  }
  if(input.type==='rotate_app_key'){
   admin(actor);
   // Shown once to the admin; only its hash is stored.
   const key='sf_'+randomBytes(24).toString('base64url');
   const r=await c.query('UPDATE applications SET ingest_key_hash=$2 WHERE id=$1 RETURNING id',[input.application_id,hashKey(key)]);if(!r.rowCount)throw new DomainError('Application introuvable.',404);
   await audit(input.type,input.application_id,{});return {message:'Clé générée. Copiez-la maintenant : elle ne sera plus affichée.',key};
  }
  if(input.type==='reset_mfa'){
   admin(actor);if(input.user_id===actor.id)throw new DomainError('Un admin ne peut pas retirer sa propre protection ici.',409);
   const role=(await c.query('SELECT role FROM app_roles WHERE user_id=$1',[input.user_id])).rows[0];if(role)throw new DomainError('Ce parcours de récupération est réservé aux clients.',403);
   const user=(await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[input.user_id])).rows[0];if(!user)throw new DomainError('Compte introuvable.',404);
   await c.query('DELETE FROM "twoFactor" WHERE "userId"=$1',[input.user_id]);await c.query('DELETE FROM "passkey" WHERE "userId"=$1',[input.user_id]);await c.query('UPDATE "user" SET "twoFactorEnabled"=false WHERE id=$1',[input.user_id]);await c.query('DELETE FROM "session" WHERE "userId"=$1',[input.user_id]);
   await audit(input.type,input.user_id,{reason:input.reason,identity_verified:true});const membership=(await c.query('SELECT organization_id FROM memberships WHERE user_id=$1',[input.user_id])).rows[0];if(membership)await notify(membership.organization_id,'Votre authenticator a été réinitialisé par l’admin. Réinscription obligatoire à la prochaine connexion.');return {message:'Authenticator réinitialisé et sessions révoquées.'};
  }
  throw new DomainError('Action inconnue.',400);
 });
}
export const hashKey=(key:string)=>createHash('sha256').update(key).digest('hex');
/** One usage event from a client application, authenticated only by that application's key. */
export async function recordUsage(key:string,input:{event:string;user?:string;version?:string}){
 const app=await pool.query('UPDATE applications SET last_seen_at=now(),last_version=coalesce($2,last_version) WHERE ingest_key_hash=$1 RETURNING id',[hashKey(key),input.version??null]);
 if(!app.rowCount)throw new DomainError('Clé d’application inconnue.',401);
 const id=app.rows[0].id as string,event=input.event.toLowerCase();
 const session=['open','session','session_start','launch','login'].includes(event)?1:0,error=event.startsWith('error')?1:0;
 await pool.query(`INSERT INTO app_usage_daily(application_id,day,events,sessions,errors) VALUES($1,current_date,1,$2,$3)
  ON CONFLICT(application_id,day) DO UPDATE SET events=app_usage_daily.events+1,sessions=app_usage_daily.sessions+$2,errors=app_usage_daily.errors+$3`,[id,session,error]);
 // Only a salted hash of the end-user identifier is kept, to count distinct users per day.
 if(input.user)await pool.query('INSERT INTO app_usage_users(application_id,day,user_hash) VALUES($1,current_date,$2) ON CONFLICT DO NOTHING',[id,hashKey(id+':'+input.user)]);
}
export async function platformWorkspace(actor:Actor){
 const scoped=actor.role==='client', args=scoped?[actor.organization_id]:[];
 const granted:string[]=scoped?(await pool.query('SELECT modules FROM organizations WHERE id=$1',[actor.organization_id])).rows[0]?.modules??[]:[...MODULES];
 const has=(module:string)=>granted.includes(module),none=Promise.resolve({rows:[] as Record<string,unknown>[]});
 const filter=scoped?' WHERE organization_id=$1':'';
 const [offers,purchases,invoices,cases,replies,usage,users,issuer,delivery,clients,audit]=await Promise.all([
  has('tokens')?pool.query('SELECT * FROM token_offers'+(scoped?' WHERE active=true':'')+' ORDER BY tokens'):none,
  has('tokens')?pool.query('SELECT * FROM purchase_requests'+filter+' ORDER BY created_at DESC LIMIT 100',args):none,
  !has('billing')?none:pool.query('SELECT invoices.*,EXISTS(SELECT 1 FROM invoice_files f WHERE f.invoice_id=invoices.id) AS has_pdf FROM invoices'+filter+' ORDER BY issued_at DESC LIMIT 100',args),
  !has('support')?none:pool.query('SELECT * FROM support_cases'+filter+' ORDER BY created_at DESC LIMIT 100',args),
  !has('support')?none:pool.query(`SELECT r.*,u.name AS author_name FROM support_replies r JOIN support_cases c ON c.id=r.case_id LEFT JOIN "user" u ON u.id=r.author_id${scoped?' WHERE c.organization_id=$1':''} ORDER BY r.created_at DESC LIMIT 500`,args),
  !has('tokens')?none:pool.query(`SELECT organization_id,created_at::date::text AS day,sum(greatest(-balance_delta,0))::int AS consumed FROM credit_ledger WHERE created_at>=now()-interval '90 days'${scoped?' AND organization_id=$1':''} GROUP BY organization_id,created_at::date ORDER BY day`,args),
  actor.role==='admin'?pool.query('SELECT u.id,u.name,u.email,u."twoFactorEnabled",m.organization_id,coalesce(co.needs_password,false) AS needs_password FROM "user" u JOIN memberships m ON m.user_id=u.id LEFT JOIN client_onboarding co ON co.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM app_roles a WHERE a.user_id=u.id) ORDER BY u.name'):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query("SELECT value FROM platform_settings WHERE key='issuer'"):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query("SELECT count(*) FILTER(WHERE attempts<5)::int AS pending,count(*) FILTER(WHERE attempts>=5)::int AS failed FROM (SELECT attempts FROM notification_outbox WHERE delivered_at IS NULL UNION ALL SELECT attempts FROM auth_email_jobs WHERE delivered_at IS NULL AND expires_at>now()) jobs"):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query(`SELECT o.id,(SELECT count(*)::int FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id=o.id AND b.status<>'cancelled') AS mailboxes,(SELECT coalesce(sum(b.quota_mb),0)::int FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id=o.id AND b.status<>'cancelled') AS mail_mb FROM organizations o`):Promise.resolve({rows:[]}),
  actor.role==='admin'?pool.query('SELECT a.id,a.action,a.entity_id,a.created_at,u.name AS actor_name FROM audit_events a LEFT JOIN "user" u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 50'):Promise.resolve({rows:[]})
 ]);
 return {offers:offers.rows,purchases:purchases.rows,invoices:invoices.rows,cases:cases.rows,replies:replies.rows,usage:usage.rows,users:users.rows,issuer:issuer.rows[0]?.value??null,delivery:delivery.rows[0]??null,clients:clients.rows,audit:audit.rows};
}
