'use client';
import { useState } from 'react';
import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import type { Alert, ClientInsight } from '@/lib/insights';
import { MODULES, moduleLabels } from '@/lib/domain';
export type Insights={clients:ClientInsight[];alerts:Alert[];stats?:import('@/lib/insights').CompanyStats};
export function ago(value:string|null|undefined){
 if(!value)return 'jamais';
 const minutes=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/60000));
 if(minutes<1)return 'à l’instant';if(minutes<60)return `il y a ${minutes} min`;if(minutes<1440)return `il y a ${Math.round(minutes/60)} h`;return `il y a ${Math.round(minutes/1440)} j`;
}
export const megabytes=(mb:number)=>mb>=1024?(mb/1024).toLocaleString('fr-TN',{maximumFractionDigits:1})+' Go':mb+' Mo';
const money=(minor:number,currency:string)=>new Intl.NumberFormat('fr-TN',{style:'currency',currency}).format(minor/(currency==='TND'?1000:100));
export function Meter({value,max,label}:{value:number;max:number;label:string}){
 const ratio=max>0?Math.min(1,Math.max(0,value/max)):0;
 return <div className="meter" role="img" aria-label={`${label} : ${Math.round(ratio*100)} %`}><span className={ratio>=.9?'meter-danger':ratio>=.75?'meter-warning':''} style={{width:ratio*100+'%'}}/></div>;
}
/** What needs the company's attention across all clients, most urgent first. */
export function AttentionList({insights,onOpen}:{insights:Insights|null;onOpen:(tab:string,client:string)=>void}){
 if(!insights?.alerts.length)return null;
 return <section className="panel"><div className="section-title"><h2><TriangleAlert size={18}/> À traiter</h2><span className="badge">{insights.alerts.length}</span></div>
  <div className="alert-list">{insights.alerts.slice(0,10).map((alert,index)=><button key={index} className={'alert alert-'+alert.level} onClick={()=>onOpen(alert.tab,alert.organization_id)}><span/><strong>{alert.client}</strong>{alert.message}<ArrowUpRight size={15}/></button>)}</div>
  {insights.alerts.length>10?<p className="small muted">+ {insights.alerts.length-10} autres points dans les fiches clients.</p>:null}</section>;
}
/** Everything about one client on one card: account health, usage of mail and applications, and visible modules. */
export function Client360({insight,alerts,onModules}:{insight:ClientInsight;alerts:Alert[];onModules:(modules:string[])=>Promise<boolean>}){
 const [modules,setModules]=useState<string[]>(insight.modules),[saving,setSaving]=useState(false);
 const changed=modules.slice().sort().join()!==insight.modules.slice().sort().join();
 const measured=insight.mail_measured>0;
 return <div className="client-360">
  {alerts.map((alert,index)=><p key={index} className={'small alert-text alert-text-'+alert.level}>{alert.message}</p>)}
  <div className="stats">
   <article className="stat"><span>Demandes & support</span><strong>{insight.tickets_open+insight.cases_open}</strong><small>{insight.tickets_open} demande(s) · {insight.cases_open} ticket(s) de support ouverts</small></article>
   <article className="stat"><span>Factures à encaisser</span><strong>{insight.invoices_due.length?insight.invoices_due.map(i=>money(i.amount_minor,i.currency)).join(' + '):'0'}</strong><small>{insight.invoices_overdue} en retard · {insight.purchases_pending} recharge(s) à valider</small></article>
   <article className="stat"><span>Utilisation des mails</span><strong>{insight.mailboxes?(measured?megabytes(insight.mail_used_mb):insight.mailboxes+' boîte(s)'):'—'}</strong>
    {insight.mailboxes?<>{measured?<Meter value={insight.mail_used_mb} max={insight.mail_quota_mb} label="Stockage mail utilisé"/>:null}<small>{measured?`sur ${megabytes(insight.mail_quota_mb)} · ${insight.mail_messages} messages · ${insight.mailboxes} boîte(s) · dernière activité ${ago(insight.mail_last_activity)}`:`${megabytes(insight.mail_quota_mb)} réservés · utilisation réelle non relevée`}</small></>:<small>Aucune boîte gérée</small>}</article>
   <article className="stat"><span>Utilisation des applications</span><strong>{insight.applications_tracked?insight.sessions_30d:'—'}</strong><small>{insight.applications_tracked?`sessions sur 30 jours · vue ${ago(insight.app_last_seen)}`:insight.applications?'Suivi non activé (onglet Applications)':'Aucune application'} · {insight.applications_tracked}/{insight.applications} suivie(s)</small></article>
  </div>
  <h3>Utilisateurs du portail</h3>
  {insight.users.map(user=><div className="mini-row" key={user.id}><div><strong>{user.name}</strong><span className="small muted">{user.email} · actif {ago(user.last_active)}</span></div>
   <span className={'badge '+(user.needs_password||!user.two_factor?'badge-warning':'badge-good')}>{user.needs_password?'Mot de passe à choisir':!user.two_factor?'Authenticator à configurer':'Compte actif'}</span>
   <span className="badge">{user.devices?`Face ID / empreinte : ${user.devices}`:'Sans appareil enregistré'}</span><span className={'badge '+(user.push_devices?'':'badge-warning')}>{user.push_devices?`Notifications : ${user.push_devices} appareil(s)`:'Notifications non activées'}</span></div>)}
  {!insight.users.length?<p className="muted">Aucun utilisateur associé.</p>:null}
  <h3>Modules visibles par ce client</h3><p className="small muted">Le client ne voit et n’utilise que les modules cochés. Le contrôle est appliqué par le serveur, pas seulement par le menu.</p>
  <div className="module-grid">{MODULES.map(module=><label key={module} className={'module'+(modules.includes(module)?' module-on':'')}><input type="checkbox" checked={modules.includes(module)} onChange={e=>setModules(current=>e.target.checked?[...current,module]:current.filter(m=>m!==module))}/>{moduleLabels[module]}</label>)}</div>
  <button className="primary" disabled={!changed||saving} onClick={async()=>{setSaving(true);await onModules(modules);setSaving(false);}}>{saving?'Enregistrement…':'Enregistrer les modules'}</button>
 </div>;
}
