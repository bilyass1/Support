'use client';
import { useState } from 'react';
import { Activity, Copy, KeyRound } from 'lucide-react';
import type { ViewProps } from '@/lib/types';
import { Bars, Empty, ago, lastDays } from '../ui';
const kinds:Record<string,string>={web:'Web',mobile:'Mobile',software:'Logiciel'};
export function UsageView({data,run,staff}:ViewProps) {
  const [secret,setSecret]=useState<{id:string;key:string}|null>(null),[pending,setPending]=useState(false);
  const days=lastDays(30),today=days[days.length-1];
  const origin=typeof window==='undefined'?'':window.location.origin;
  return <>
    {staff?<p className="muted intro">Chaque application reçoit une clé. Elle envoie un événement à chaque ouverture : vous voyez ici qui utilise quoi, à quelle fréquence et sur quelle version.</p>:null}
    {secret?<section className="panel key-box"><h2><KeyRound size={18}/> Clé d’application — affichée une seule fois</h2><p className="muted">Copiez-la maintenant dans la configuration de l’application. Elle n’est pas conservée en clair : en cas de perte, générez-en une nouvelle.</p>
      <code className="block">{secret.key}</code>
      <pre className="block">{`fetch('${origin}/api/ingest', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-App-Key': '${secret.key}'},
  body: JSON.stringify({event: 'open', user: 'identifiant-utilisateur', version: '1.0.0'})
});`}</pre>
      <p className="small muted">Événements reconnus : <code>open</code> / <code>session</code> (une session), <code>error</code> (une erreur), ou tout autre nom pour une action. « user » sert uniquement à compter les utilisateurs distincts ; seule une empreinte est conservée.</p>
      <div className="actions"><button className="primary" onClick={()=>navigator.clipboard?.writeText(secret.key).catch(()=>{})}><Copy size={15}/>Copier la clé</button><button onClick={()=>setSecret(null)}>J’ai enregistré la clé</button></div></section>:null}
    <div className="card-grid">{data.applications.map(app=>{
      const rows=data.usage.filter(u=>u.application_id===app.id);
      const sessions=days.map(day=>({label:new Date(day).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}),value:rows.find(u=>u.day===day)?.sessions??0}));
      const total=(key:'sessions'|'events'|'errors')=>rows.reduce((sum,u)=>sum+u[key],0);
      const peak=Math.max(0,...rows.map(u=>u.users));
      return <section className="panel" key={app.id}><div className="section-title"><div><h2>{app.name}</h2><span className="small muted">{kinds[app.kind]??app.kind}{staff?' · '+(data.organizations.find(o=>o.id===app.organization_id)?.name??''):''}{app.last_version?' · v'+app.last_version:''}</span></div>
        <span className={'badge '+(app.tracked?(app.last_seen_at&&Date.now()-new Date(app.last_seen_at).getTime()<7*86_400_000?'badge-good':'badge-danger'):'')}>{app.tracked?'Vue '+ago(app.last_seen_at).toLowerCase():'Suivi non activé'}</span></div>
        {app.tracked?<><Bars points={sessions} unit="sessions"/><div className="kpis"><div><strong>{total('sessions')}</strong><span>sessions · 30 j</span></div><div><strong>{rows.find(u=>u.day===today)?.users??0}</strong><span>utilisateurs aujourd’hui</span></div><div><strong>{peak}</strong><span>pic d’utilisateurs / jour</span></div><div><strong>{total('events')}</strong><span>événements</span></div><div className={total('errors')?'kpi-danger':''}><strong>{total('errors')}</strong><span>erreurs</span></div></div></>
        :<p className="muted">{staff?'Générez une clé puis intégrez l’appel dans l’application pour commencer la mesure.':'Le suivi d’utilisation n’est pas encore activé pour cette application.'}</p>}
        {staff?<button disabled={pending} onClick={async()=>{if(app.tracked&&!window.confirm('Générer une nouvelle clé désactive immédiatement l’ancienne. Continuer ?'))return;setPending(true);const result=await run({type:'rotate_app_key',application_id:app.id},'');setPending(false);if(result?.key)setSecret({id:app.id,key:String(result.key)});window.scrollTo({top:0,behavior:'smooth'});}}><KeyRound size={15}/>{app.tracked?'Régénérer la clé':'Générer la clé de suivi'}</button>:null}
      </section>;})}</div>
    {!data.applications.length?<Empty icon={<Activity size={30}/>} title="Aucune application">{staff?'Ajoutez les applications de vos clients depuis la vue Clients.':'Vos applications apparaîtront ici.'}</Empty>:null}
  </>;
}
