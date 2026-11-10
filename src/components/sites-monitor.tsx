'use client';
import { useState } from 'react';
import { Globe, Plus, Trash2 } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { Field } from './forms';
type Site=Workspace['sites'][number];
const day=86_400_000;
const date=(value:string)=>new Date(value).toLocaleDateString('fr-TN');
function left(value:string|null){return value?Math.ceil((new Date(value).getTime()-Date.now())/day):null;}
function expiry(label:string,value:string|null,warn:number){
 const days=left(value);
 if(days===null)return null;
 return <span className={'badge '+(days<=0?'badge-danger':days<=warn?'status-quoted':'')}>{label} : {days<=0?'expiré':`${date(value!)} (${days} j)`}</span>;
}
/** Availability, certificate and domain expiry of each client site, checked by the server every five minutes. */
export function SitesMonitor({workspace,onChange}:{workspace:Workspace;onChange:()=>Promise<void>}){
 const admin=workspace.actor.role==='admin';
 const [editing,setEditing]=useState<Site|'new'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function send(body:Record<string,unknown>){
  setBusy(true);setError('');setMessage('');
  try{const response=await fetch('/api/platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error);setMessage(value.message??'');await onChange();return true;}
  catch(e){setError(e instanceof Error?e.message:'Opération impossible.');return false;}finally{setBusy(false);}
 }
 const organization=(id:string)=>workspace.organizations.find(o=>o.id===id)?.name??'';
 if(!admin&&!workspace.sites.length)return null;
 return <section className="panel"><div className="section-title"><div><h2><Globe size={18}/> Sites surveillés</h2><p className="small muted">Contrôle toutes les cinq minutes. Disponibilité calculée sur 30 jours.</p></div>
   {admin&&!editing&&workspace.organizations.length?<button className="primary" onClick={()=>setEditing('new')}><Plus size={16}/>Ajouter un site</button>:null}</div>
  {error?<p className="error" role="alert">{error}</p>:null}{message?<p className="success" role="status">{message}</p>:null}
  {editing?<form className="form" key={typeof editing==='string'?'new':editing.id} onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);
    if(await send({type:'save_site',id:typeof editing==='string'?undefined:editing.id,organization_id:f.get('organization_id'),label:f.get('label'),url:f.get('url'),domain_expires_at:f.get('domain_expires_at')||null,enabled:f.get('enabled')==='on'}))setEditing(null);}}>
    <div className="form-grid"><Field label="Client"><select name="organization_id" required defaultValue={typeof editing==='string'?undefined:editing.organization_id}>{workspace.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
     <Field label="Nom du site"><input name="label" required minLength={2} maxLength={80} defaultValue={typeof editing==='string'?'':editing.label}/></Field>
     <Field label="Adresse à contrôler"><input name="url" type="url" required placeholder="https://www.exemple.tn" defaultValue={typeof editing==='string'?'':editing.url}/></Field>
     <Field label="Expiration du nom de domaine (facultatif)"><input name="domain_expires_at" type="date" defaultValue={typeof editing==='string'?'':editing.domain_expires_at??''}/></Field></div>
    <label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={typeof editing==='string'?true:editing.enabled}/>Surveillance active</label>
    <div className="actions"><button className="primary" disabled={busy}>{busy?'Enregistrement…':'Enregistrer le site'}</button><button type="button" onClick={()=>setEditing(null)}>Annuler</button></div></form>:null}
  <div className="card-grid spaced">{workspace.sites.map(site=>{
   const uptime=site.checks?Math.round((1-site.failures/site.checks)*1000)/10:null;
   return <article className="application" key={site.id}><div className="section-title"><div><strong>{site.label}</strong><p className="small muted">{admin?organization(site.organization_id)+' · ':''}{new URL(site.url).host}</p></div>
     <span className={'badge '+(!site.enabled?'':site.status==='up'?'badge-good':site.status==='down'?'badge-danger':'')}>{!site.enabled?'En pause':site.status==='up'?'En ligne':site.status==='down'?'Indisponible':'En attente du premier contrôle'}</span></div>
    <div className="kpis"><div><strong>{uptime===null?'—':uptime.toLocaleString('fr-TN')+' %'}</strong><span>disponibilité · 30 j</span></div><div><strong>{site.last_latency_ms===null?'—':site.last_latency_ms+' ms'}</strong><span>temps de réponse</span></div></div>
    <div className="actions">{expiry('SSL',site.ssl_expires_at,14)}{expiry('Domaine',site.domain_expires_at,30)}</div>
    {site.status==='down'&&site.status_since?<p className="small alert-text alert-text-danger">Indisponible depuis le {new Date(site.status_since).toLocaleString('fr-TN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</p>:null}
    {admin?<div className="actions"><button disabled={busy} onClick={()=>setEditing(site)}>Modifier</button><button className="danger" disabled={busy} aria-label={'Retirer '+site.label} onClick={()=>{if(window.confirm(`Retirer ${site.label} de la surveillance ? Son historique sera supprimé.`))send({type:'delete_site',id:site.id});}}><Trash2 size={15}/></button></div>:null}
   </article>;})}</div>
  {!workspace.sites.length?<p className="muted">Aucun site surveillé. Ajoutez l’adresse du site d’un client pour être prévenu dès qu’il ne répond plus.</p>:null}
 </section>;
}
