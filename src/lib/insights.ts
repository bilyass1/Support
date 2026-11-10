import { pool } from './db';
import { DomainError } from './domain';
import type { Actor } from './service';

export type ClientInsight={
 organization_id:string;name:string;plan:string|null;ends_at:string|null;available:number;reserved:number;annual_tokens:number|null;modules:string[];
 users:{id:string;name:string;email:string;two_factor:boolean;needs_password:boolean;devices:number;push_devices:number;last_active:string|null}[];
 tickets_open:number;tickets_total:number;cases_open:number;purchases_pending:number;
 invoices_due:{currency:string;amount_minor:number}[];invoices_overdue:number;
 mailboxes:number;mail_quota_mb:number;mail_used_mb:number;mail_messages:number;mail_measured:number;mail_nearly_full:number;mail_last_activity:string|null;mail_synced_at:string|null;
 applications:number;applications_tracked:number;sessions_30d:number;app_last_seen:string|null;
 last_active:string|null;
};
export type Alert={level:'warning'|'danger';organization_id:string;client:string;message:string;tab:string};
type Row=Record<string,unknown>;
const rows=async(sql:string)=>(await pool.query(sql)).rows as Row[];
const int=(value:unknown)=>Number(value??0);

/** Everything the company needs to know about each client on one screen. Admin only; never sent to clients. */
export async function clientInsights(actor:Actor):Promise<{clients:ClientInsight[];alerts:Alert[]}> {
 if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);
 const [organizations,users,tickets,cases,purchases,invoices,mail,apps]=await Promise.all([
  rows(`SELECT o.id,o.name,o.modules,w.balance,w.reserved,s.snapshot->>'name' AS plan,(s.snapshot->>'annual_tokens')::int AS annual_tokens,s.ends_at
   FROM organizations o JOIN wallets w ON w.organization_id=o.id LEFT JOIN subscriptions s ON s.organization_id=o.id ORDER BY o.name`),
  rows(`SELECT m.organization_id,u.id,u.name,u.email,coalesce(u."twoFactorEnabled",false) AS two_factor,coalesce(co.needs_password,false) AS needs_password,
   (SELECT count(*)::int FROM "passkey" p WHERE p."userId"=u.id) AS devices,
   (SELECT count(*)::int FROM push_subscriptions ps WHERE ps.user_id=u.id) AS push_devices,
   (SELECT max(se."updatedAt") FROM "session" se WHERE se."userId"=u.id) AS last_active
   FROM memberships m JOIN "user" u ON u.id=m.user_id LEFT JOIN client_onboarding co ON co.user_id=u.id
   WHERE NOT EXISTS(SELECT 1 FROM app_roles a WHERE a.user_id=u.id) ORDER BY u.name`),
  rows(`SELECT organization_id,count(*)::int AS total,count(*) FILTER(WHERE status NOT IN('closed','cancelled'))::int AS open FROM tickets GROUP BY 1`),
  rows(`SELECT organization_id,count(*)::int AS open FROM support_cases WHERE status<>'closed' GROUP BY 1`),
  rows(`SELECT organization_id,count(*)::int AS pending FROM purchase_requests WHERE status='pending' GROUP BY 1`),
  rows(`SELECT organization_id,currency,sum(amount_minor)::bigint AS amount_minor,count(*) FILTER(WHERE due_at<current_date)::int AS overdue FROM invoices WHERE status='issued' GROUP BY 1,2`),
  rows(`SELECT d.organization_id,count(b.id)::int AS mailboxes,coalesce(sum(b.quota_mb),0)::bigint AS quota_mb,coalesce(sum(b.used_mb),0)::bigint AS used_mb,coalesce(sum(b.messages),0)::bigint AS messages,
   count(b.usage_synced_at)::int AS measured,count(b.id) FILTER(WHERE b.used_mb*10>=b.quota_mb*9)::int AS nearly_full,max(b.last_activity_at) AS last_activity,max(b.usage_synced_at) AS synced_at
   FROM email_domains d JOIN email_mailboxes b ON b.domain_id=d.id AND b.status<>'cancelled' GROUP BY 1`),
  rows(`SELECT a.organization_id,count(*)::int AS applications,count(a.ingest_key_hash)::int AS tracked,max(a.last_seen_at) AS last_seen,
   coalesce((SELECT sum(d.sessions) FROM app_usage_daily d JOIN applications x ON x.id=d.application_id WHERE x.organization_id=a.organization_id AND d.day>current_date-30),0)::bigint AS sessions
   FROM applications a GROUP BY 1`)
 ]);
 const by=(list:Row[],id:unknown)=>list.find(row=>row.organization_id===id);
 const iso=(value:unknown)=>value?new Date(value as string).toISOString():null;
 const clients=organizations.map(o=>{
  const members=users.filter(u=>u.organization_id===o.id).map(u=>({id:String(u.id),name:String(u.name),email:String(u.email),two_factor:Boolean(u.two_factor),needs_password:Boolean(u.needs_password),devices:int(u.devices),push_devices:int(u.push_devices),last_active:iso(u.last_active)}));
  const t=by(tickets,o.id),m=by(mail,o.id),a=by(apps,o.id),due=invoices.filter(i=>i.organization_id===o.id);
  return {organization_id:String(o.id),name:String(o.name),plan:o.plan as string|null,ends_at:iso(o.ends_at),available:int(o.balance)-int(o.reserved),reserved:int(o.reserved),annual_tokens:o.annual_tokens===null?null:int(o.annual_tokens),modules:(o.modules as string[])??[],
   users:members,tickets_open:int(t?.open),tickets_total:int(t?.total),cases_open:int(by(cases,o.id)?.open),purchases_pending:int(by(purchases,o.id)?.pending),
   invoices_due:due.map(i=>({currency:String(i.currency),amount_minor:int(i.amount_minor)})),invoices_overdue:due.reduce((sum,i)=>sum+int(i.overdue),0),
   mailboxes:int(m?.mailboxes),mail_quota_mb:int(m?.quota_mb),mail_used_mb:int(m?.used_mb),mail_messages:int(m?.messages),mail_measured:int(m?.measured),mail_nearly_full:int(m?.nearly_full),mail_last_activity:iso(m?.last_activity),mail_synced_at:iso(m?.synced_at),
   applications:int(a?.applications),applications_tracked:int(a?.tracked),sessions_30d:int(a?.sessions),app_last_seen:iso(a?.last_seen),
   last_active:members.map(u=>u.last_active).filter(Boolean).sort().pop()??null} satisfies ClientInsight;
 });
 return {clients,alerts:alerts(clients)};
}
export function alerts(clients:ClientInsight[],now=Date.now()):Alert[] {
 const list:Alert[]=[],day=86_400_000;
 for(const c of clients){
  const add=(level:Alert['level'],message:string,tab:string)=>list.push({level,organization_id:c.organization_id,client:c.name,message,tab});
  if(!c.plan)add('warning','Aucune formule attribuée.','clients');
  else{
   const left=c.ends_at?(new Date(c.ends_at).getTime()-now)/day:Infinity;
   if(left<=0)add('danger','Formule expirée.','clients');else if(left<=30)add('warning',`Formule à renouveler dans ${Math.ceil(left)} jour(s).`,'clients');
   if(c.available<=Math.max(1,Math.ceil((c.annual_tokens??0)*0.2)))add(c.available<=0?'danger':'warning',`Il reste ${c.available} token(s) disponible(s).`,'tokens');
  }
  if(c.invoices_overdue)add('danger',`${c.invoices_overdue} facture(s) en retard de paiement.`,'billing');
  if(c.purchases_pending)add('warning',`${c.purchases_pending} demande(s) de recharge à valider.`,'tokens');
  if(c.cases_open)add('warning',`${c.cases_open} ticket(s) de support ouvert(s).`,'support');
  if(c.mail_nearly_full)add('warning',`${c.mail_nearly_full} boîte(s) mail à plus de 90 % de leur quota.`,'mail');
  if(c.applications_tracked&&(!c.app_last_seen||now-new Date(c.app_last_seen).getTime()>7*day))add('warning','Aucune activité reçue de ses applications depuis 7 jours.','usage');
  const pending=c.users.some(u=>u.needs_password||!u.two_factor);
  if(pending)add('warning','Un utilisateur n’a pas terminé l’activation de son compte.','clients');
  // An account that was never activated is already reported above; this one is for clients who stopped coming.
  else if(c.users.length&&(!c.last_active||now-new Date(c.last_active).getTime()>30*day))add('warning','Aucune connexion au portail depuis 30 jours.','clients');
 }
 return list.sort((a,b)=>Number(b.level==='danger')-Number(a.level==='danger'));
}
