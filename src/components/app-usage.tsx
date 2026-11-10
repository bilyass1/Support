'use client';
import { useState } from 'react';
import { Activity, Copy, KeyRound } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { ago } from './client-insights';
function lastDays(count:number){
 const days:string[]=[];
 for(let i=count-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));}
 return days;
}
const kinds:Record<string,string>={web:'Web',mobile:'Mobile',software:'Logiciel'};
/** Sessions, distinct users, errors and version per application over the last thirty days. */
export function AppUsage({workspace,onChange}:{workspace:Workspace;onChange:()=>Promise<void>}){
 const admin=workspace.actor.role==='admin';
 const [secret,setSecret]=useState<{name:string;key:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const days=lastDays(30),today=days[days.length-1],origin=typeof window==='undefined'?'':window.location.origin;
 async function rotate(id:string,name:string,tracked:boolean){
  if(tracked&&!window.confirm('Générer une nouvelle clé désactive immédiatement l’ancienne. Continuer ?'))return;
  setBusy(true);setError('');
  try{const response=await fetch('/api/platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'rotate_app_key',application_id:id})});const value=await response.json();if(!response.ok)throw new Error(value.error);setSecret({name,key:value.key});await onChange();window.scrollTo({top:0,behavior:'smooth'});}
  catch(e){setError(e instanceof Error?e.message:'Génération impossible.');}finally{setBusy(false);}
 }
 return <>
  {admin?<p className="muted">Chaque application reçoit une clé et envoie un événement à chaque ouverture. Vous voyez ici qui utilise quoi, à quelle fréquence et sur quelle version.</p>:null}
  {error?<p className="error" role="alert">{error}</p>:null}
  {secret?<section className="panel key-box"><h2><KeyRound size={18}/> Clé de « {secret.name} » — affichée une seule fois</h2><p className="muted">Copiez-la maintenant dans la configuration de l’application. Seule son empreinte est conservée : en cas de perte, générez-en une nouvelle.</p>
   <code className="block">{secret.key}</code>
   <pre className="block">{`fetch('${origin}/api/ingest', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-App-Key': '${secret.key}'},
  body: JSON.stringify({event: 'open', user: 'identifiant-utilisateur', version: '1.0.0'})
});`}</pre>
   <p className="small muted"><code>open</code> ou <code>session</code> compte une session, <code>error</code> une erreur, tout autre nom un événement. « user » sert uniquement à compter les utilisateurs distincts ; seule une empreinte est conservée.</p>
   <div className="actions"><button className="primary" onClick={()=>void navigator.clipboard?.writeText(secret.key).catch(()=>{})}><Copy size={15}/>Copier la clé</button><button onClick={()=>setSecret(null)}>J’ai enregistré la clé</button></div></section>:null}
  <div className="application-grid">{workspace.applications.map(app=>{
   const rows=workspace.app_usage.filter(u=>u.application_id===app.id);
   const points=days.map(day=>({day,value:rows.find(u=>u.day===day)?.sessions??0})),max=Math.max(1,...points.map(p=>p.value));
   const total=(key:'sessions'|'events'|'errors')=>rows.reduce((sum,u)=>sum+u[key],0);
   const fresh=app.last_seen_at&&Date.now()-new Date(app.last_seen_at).getTime()<7*86_400_000;
   return <section className="panel" key={app.id}><div className="section-title"><div><h2>{app.name}</h2><span className="small muted">{kinds[app.kind]??app.kind}{admin?' · '+(workspace.organizations.find(o=>o.id===app.organization_id)?.name??''):''}{app.last_version?' · v'+app.last_version:''}</span></div>
     <span className={'badge '+(app.tracked?(fresh?'badge-good':'badge-warning'):'')}>{app.tracked?'Vue '+ago(app.last_seen_at):'Suivi non activé'}</span></div>
    {app.tracked?<><div className="bars" role="img" aria-label={`${total('sessions')} sessions sur 30 jours, maximum ${max} par jour`}>{points.map(p=><span key={p.day} title={`${new Date(p.day).toLocaleDateString('fr-TN',{day:'2-digit',month:'short'})} : ${p.value} sessions`} className={p.value?'':'bar-zero'} style={{height:Math.max(p.value?6:2,p.value/max*100)+'%'}}/>)}</div>
     <div className="kpis"><div><strong>{total('sessions')}</strong><span>sessions · 30 j</span></div><div><strong>{rows.find(u=>u.day===today)?.users??0}</strong><span>utilisateurs aujourd’hui</span></div><div><strong>{Math.max(0,...rows.map(u=>u.users))}</strong><span>pic d’utilisateurs / jour</span></div><div><strong>{total('events')}</strong><span>événements</span></div><div className={total('errors')?'kpi-danger':''}><strong>{total('errors')}</strong><span>erreurs</span></div></div></>
     :<p className="muted">{admin?'Générez une clé, puis intégrez l’appel dans l’application pour commencer la mesure.':'Le suivi d’utilisation n’est pas encore activé pour cette application.'}</p>}
    {admin?<button disabled={busy} onClick={()=>void rotate(app.id,app.name,Boolean(app.tracked))}><KeyRound size={15}/>{app.tracked?'Régénérer la clé':'Générer la clé de suivi'}</button>:null}</section>;})}</div>
  {!workspace.applications.length?<div className="empty"><Activity size={30}/><h3>Aucune application</h3><p>{admin?'Ajoutez les applications de vos clients depuis « Clients & applications ».':'Vos applications apparaîtront ici.'}</p></div>:null}
 </>;
}
