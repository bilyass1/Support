import { pool } from './db';
import { DomainError } from './domain';
import type { Actor } from './service';

export type ClientInsight={
 organization_id:string;name:string;plan:string|null;ends_at:string|null;available:number;reserved:number;annual_tokens:number|null;modules:string[];
 users:{id:string;name:string;email:string;two_factor:boolean;needs_password:boolean;devices:number;push_devices:number;last_active:string|null}[];
 tickets_open:number;tickets_total:number;tickets_late?:number;cases_open:number;purchases_pending:number;
 invoices_due:{currency:string;amount_minor:number}[];invoices_overdue:number;
 mailboxes:number;mail_quota_mb:number;mail_used_mb:number;mail_messages:number;mail_measured:number;mail_nearly_full:number;mail_last_activity:string|null;mail_last_login?:string|null;mail_login_checked?:number;mail_synced_at:string|null;
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
  rows(`SELECT organization_id,count(*)::int AS total,count(*) FILTER(WHERE status NOT IN('closed','cancelled'))::int AS open,
   count(*) FILTER(WHERE first_response_at IS NULL AND status NOT IN('closed','cancelled') AND created_at<now()-(CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 8 WHEN 'normal' THEN 24 ELSE 72 END)*interval '1 hour')::int AS late FROM tickets GROUP BY 1`),
  rows(`SELECT organization_id,count(*)::int AS open FROM support_cases WHERE status<>'closed' GROUP BY 1`),
  rows(`SELECT organization_id,count(*)::int AS pending FROM purchase_requests WHERE status='pending' GROUP BY 1`),
  rows(`SELECT organization_id,currency,sum(amount_minor)::bigint AS amount_minor,count(*) FILTER(WHERE due_at<current_date)::int AS overdue FROM invoices WHERE status='issued' GROUP BY 1,2`),
  rows(`SELECT d.organization_id,count(b.id)::int AS mailboxes,coalesce(sum(b.quota_mb),0)::bigint AS quota_mb,coalesce(sum(b.used_mb),0)::bigint AS used_mb,coalesce(sum(b.messages),0)::bigint AS messages,
   count(b.usage_synced_at)::int AS measured,count(b.id) FILTER(WHERE b.used_mb*10>=b.quota_mb*9)::int AS nearly_full,max(b.last_activity_at) AS last_activity,max(b.last_login_at) AS last_login,count(b.login_checked_at)::int AS login_checked,max(b.usage_synced_at) AS synced_at
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
   users:members,tickets_open:int(t?.open),tickets_total:int(t?.total),tickets_late:int(t?.late),cases_open:int(by(cases,o.id)?.open),purchases_pending:int(by(purchases,o.id)?.pending),
   invoices_due:due.map(i=>({currency:String(i.currency),amount_minor:int(i.amount_minor)})),invoices_overdue:due.reduce((sum,i)=>sum+int(i.overdue),0),
   mailboxes:int(m?.mailboxes),mail_quota_mb:int(m?.quota_mb),mail_used_mb:int(m?.used_mb),mail_messages:int(m?.messages),mail_measured:int(m?.measured),mail_nearly_full:int(m?.nearly_full),mail_last_activity:iso(m?.last_activity),mail_last_login:iso(m?.last_login),mail_login_checked:int(m?.login_checked),mail_synced_at:iso(m?.synced_at),
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
  if(c.tickets_late)add('danger',`${c.tickets_late} demande(s) sans première réponse, délai dépassé.`,'tickets');
  if(c.invoices_overdue)add('danger',`${c.invoices_overdue} facture(s) en retard de paiement.`,'billing');
  if(c.purchases_pending)add('warning',`${c.purchases_pending} demande(s) de recharge à valider.`,'tokens');
  if(c.cases_open)add('warning',`${c.cases_open} ticket(s) de support ouvert(s).`,'support');
  if(c.mail_login_checked&&(!c.mail_last_login||now-new Date(c.mail_last_login).getTime()>30*day))add('warning','Aucune connexion à ses boîtes mail depuis 30 jours.','mail');
  if(c.mail_nearly_full)add('warning',`${c.mail_nearly_full} boîte(s) mail à plus de 90 % de leur quota.`,'mail');
  if(c.applications_tracked&&(!c.app_last_seen||now-new Date(c.app_last_seen).getTime()>7*day))add('warning','Aucune activité reçue de ses applications depuis 7 jours.','usage');
  const pending=c.users.some(u=>u.needs_password||!u.two_factor);
  if(pending)add('warning','Un utilisateur n’a pas terminé l’activation de son compte.','clients');
  // An account that was never activated is already reported above; this one is for clients who stopped coming.
  else if(c.users.length&&(!c.last_active||now-new Date(c.last_active).getTime()>30*day))add('warning','Aucune connexion au portail depuis 30 jours.','clients');
 }
 return list.sort((a,b)=>Number(b.level==='danger')-Number(a.level==='danger'));
}

export type CompanyStats={months:string[];revenue:{currency:string;paid:number[];open:number[]}[];tickets_created:number[];tickets_closed:number[];tokens_consumed:number[];
 unpaid:{currency:string;total:number;count:number;overdue:number}[];first_response_hours:number|null;satisfaction:number|null;ratings:number;sites:{total:number;down:number}};
/** Company figures over the last six months. Admin only. Paid revenue is grouped by the month the invoice was issued. */
export async function companyStats(actor:Actor):Promise<CompanyStats> {
 if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);
 const since="date_trunc('month',now())-interval '5 months'",month=(column:string)=>`to_char(date_trunc('month',${column}),'YYYY-MM')`;
 const [calendar,invoices,created,closed,tokens,unpaid,quality,sites]=await Promise.all([
  rows(`SELECT to_char(m,'YYYY-MM') AS month FROM generate_series(${since},date_trunc('month',now()),interval '1 month') m ORDER BY 1`),
  rows(`SELECT ${month('issued_at')} AS month,currency,coalesce(sum(amount_minor) FILTER(WHERE status='paid'),0)::bigint AS paid,coalesce(sum(amount_minor) FILTER(WHERE status='issued'),0)::bigint AS open FROM invoices WHERE issued_at>=${since} GROUP BY 1,2`),
  rows(`SELECT ${month('created_at')} AS month,count(*)::int AS n FROM tickets WHERE created_at>=${since} GROUP BY 1`),
  rows(`SELECT ${month('closed_at')} AS month,count(*)::int AS n FROM tickets WHERE closed_at>=${since} GROUP BY 1`),
  rows(`SELECT ${month('created_at')} AS month,coalesce(-sum(balance_delta),0)::int AS n FROM credit_ledger WHERE kind='consume' AND created_at>=${since} GROUP BY 1`),
  rows(`SELECT currency,sum(amount_minor)::bigint AS total,count(*)::int AS count,count(*) FILTER(WHERE due_at<current_date)::int AS overdue FROM invoices WHERE status='issued' GROUP BY 1 ORDER BY 1`),
  rows(`SELECT (SELECT avg(extract(epoch FROM first_response_at-created_at))/3600 FROM tickets WHERE first_response_at IS NOT NULL AND created_at>now()-interval '90 days') AS hours,
   (SELECT avg(rating) FROM tickets WHERE rating IS NOT NULL) AS rating,(SELECT count(*)::int FROM tickets WHERE rating IS NOT NULL) AS ratings`),
  rows(`SELECT count(*) FILTER(WHERE enabled)::int AS total,count(*) FILTER(WHERE enabled AND status='down')::int AS down FROM monitored_sites`)
 ]);
 const months=calendar.map(r=>String(r.month));
 const series=(list:Record<string,unknown>[],key='n')=>months.map(m=>Number(list.find(r=>r.month===m)?.[key]??0));
 const currencies=[...new Set(invoices.map(r=>String(r.currency)))].sort();
 const number=(value:unknown)=>value===null||value===undefined?null:Math.round(Number(value)*10)/10;
 return {months,revenue:currencies.map(currency=>{const mine=invoices.filter(r=>r.currency===currency);return {currency,paid:series(mine,'paid'),open:series(mine,'open')};}),
  tickets_created:series(created),tickets_closed:series(closed),tokens_consumed:series(tokens),
  unpaid:unpaid.map(r=>({currency:String(r.currency),total:Number(r.total),count:Number(r.count),overdue:Number(r.overdue)})),
  first_response_hours:number(quality[0]?.hours),satisfaction:number(quality[0]?.rating),ratings:Number(quality[0]?.ratings??0),sites:{total:Number(sites[0]?.total??0),down:Number(sites[0]?.down??0)}};
}
