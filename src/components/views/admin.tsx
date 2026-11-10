'use client';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Plan, ViewProps } from '@/lib/types';
import { ActionForm, Field, PlanEditor } from '../forms';
import { Empty, date, dateTime, money } from '../ui';
type Audit={id:string;action:string;entity_id:string;detail:unknown;created_at:string;actor_name:string|null};
type Delivery={id:string;channel:string;status:string;attempts:number;error:string|null;created_at:string;sent_at:string|null;email:string|null;title:string};
const sections=[['plans','Formules'],['team','Équipe'],['announce','Annonces'],['deliveries','Envois e-mail & push'],['audit','Journal d’audit']] as const;
const deliveryLabels:Record<string,string>={pending:'En attente',sending:'En cours',sent:'Envoyé',failed:'Échec',skipped:'Non envoyé'};
export function AdminView({data,run}:ViewProps) {
  const [section,setSection]=useState<string>('plans'),[planEditor,setPlanEditor]=useState<Plan|'new'|null>(null);
  const [audit,setAudit]=useState<Audit[]|null>(null),[deliveries,setDeliveries]=useState<{deliveries:Delivery[];channels:{email:boolean;push:boolean}}|null>(null),[search,setSearch]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(section!=='audit'&&section!=='deliveries')return;
    setError('');
    fetch('/api/admin?view='+section,{cache:'no-store'}).then(async r=>{const value=await r.json();if(!r.ok)throw new Error(value.error);if(section==='audit')setAudit(value.audit);else setDeliveries(value);}).catch(e=>setError(e.message));
  },[section,data]);
  const filtered=(audit??[]).filter(a=>(a.action+' '+(a.actor_name??'')+' '+JSON.stringify(a.detail)).toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="tabs" role="tablist">{sections.map(([id,label])=><button key={id} role="tab" aria-selected={section===id} className={section===id?'tab-active':''} onClick={()=>setSection(id)}>{label}</button>)}</div>
    {error?<p className="error" role="alert">{error}</p>:null}
    {section==='plans'?<>
      {!planEditor?<button className="primary spaced" onClick={()=>setPlanEditor('new')}><Plus size={17}/>Créer une formule</button>:<section className="panel"><PlanEditor key={typeof planEditor==='string'?'new':planEditor.id} plan={typeof planEditor==='string'?undefined:planEditor} onSave={run} onCancel={()=>setPlanEditor(null)}/></section>}
      <div className="card-grid">{data.plans.map(p=><section className="panel" key={p.id}><span className="eyebrow">FORMULE · VERSION {p.revision}</span><h2>{p.name}</h2><p className="credit-big">{p.annual_tokens}<span> crédits / an</span></p><p>{money(p.price_minor,p.currency)} / an</p><p className="muted">{p.support_level} · {p.rules.length} règle(s)</p><button onClick={()=>setPlanEditor(p)}>Modifier</button></section>)}</div>
      {!data.plans.length?<Empty title="Aucune formule">Créez une formule pour attribuer un quota annuel à vos clients.</Empty>:null}</>:null}
    {section==='team'?<section className="panel"><h2>Équipe</h2><p className="muted">Un manager traite les demandes de tous les clients. Un administrateur gère en plus les clients, les formules, la facturation et les rôles.</p>
      {data.team.map(m=><div className="mini-row" key={m.user_id}><div><strong>{m.name}</strong><span className="small muted">{m.email}</span></div><span className="badge">{m.role==='admin'?'Administrateur':'Manager'}</span>
        {m.user_id!==data.actor.id?<button className="danger" onClick={()=>{if(window.confirm(`Retirer ${m.name} de l’équipe ?`))run({type:'set_role',email:m.email,role:'none'},'Membre retiré de l’équipe.');}}>Retirer</button>:null}</div>)}
      <ActionForm label="Attribuer le rôle" onSubmit={f=>run({type:'set_role',email:f.get('email'),role:f.get('role')},'Rôle attribué.')}><div className="form-grid"><Field label="E-mail d’un compte déjà créé"><input name="email" type="email" required/></Field><Field label="Rôle"><select name="role"><option value="manager">Manager</option><option value="admin">Administrateur</option></select></Field></div></ActionForm></section>:null}
    {section==='announce'?<><section className="panel"><h2>Publier une annonce</h2><p className="muted">Maintenance, nouveauté, congés… Les clients concernés la reçoivent par e-mail et notification, et la voient sur leur tableau de bord.</p>
      <ActionForm label="Publier et notifier" onSubmit={f=>run({type:'announce',organization_id:f.get('organization_id')||null,title:f.get('title'),body:f.get('body')},'Annonce publiée et envoyée.')}>
        <div className="form-grid"><Field label="Destinataires"><select name="organization_id"><option value="">Tous les clients</option>{data.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><Field label="Titre"><input name="title" required minLength={3} maxLength={120}/></Field></div>
        <Field label="Message"><textarea name="body" rows={3} required minLength={3} maxLength={2000}/></Field></ActionForm></section>
      <section className="panel"><h2>Annonces publiées</h2>{data.announcements.map(a=><div className="mini-row" key={a.id}><div><strong>{a.title}</strong><span className="small muted">{date(a.created_at)} · {a.organization_id?data.organizations.find(o=>o.id===a.organization_id)?.name:'Tous les clients'}</span></div></div>)}{!data.announcements.length?<p className="muted">Aucune annonce.</p>:null}</section></>:null}
    {section==='deliveries'?<section className="panel"><h2>Envois e-mail & push</h2>
      {deliveries?<><div className="actions spaced"><span className={'badge '+(deliveries.channels.email?'badge-good':'badge-danger')}>E-mail : {deliveries.channels.email?'SMTP configuré':'SMTP non configuré'}</span><span className={'badge '+(deliveries.channels.push?'badge-good':'badge-danger')}>Push : {deliveries.channels.push?'clés VAPID configurées':'clés VAPID manquantes'}</span></div>
        {!deliveries.channels.email||!deliveries.channels.push?<p className="warning">Tant qu’un canal n’est pas configuré sur le serveur (voir README), ses envois sont marqués « Non envoyé ».</p>:null}
        <div className="table-wrap"><table><thead><tr><th>Date</th><th>Canal</th><th>Destinataire</th><th>Objet</th><th>État</th></tr></thead><tbody>{deliveries.deliveries.map(d=><tr key={d.id}><td>{dateTime(d.created_at)}</td><td>{d.channel==='email'?'E-mail':'Push'}</td><td>{d.email}</td><td>{d.title}</td><td><span className={'badge delivery-'+d.status}>{deliveryLabels[d.status]}{d.attempts>1?` · ${d.attempts} essais`:''}</span>{d.error?<div className="small muted">{d.error}</div>:null}</td></tr>)}</tbody></table></div>
        {!deliveries.deliveries.length?<Empty title="Aucun envoi pour le moment"/>:null}</>:<p className="muted">Chargement…</p>}</section>:null}
    {section==='audit'?<section className="panel"><div className="section-title"><h2>Journal d’audit</h2><input aria-label="Filtrer le journal" placeholder="Filtrer par action, auteur…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {audit?<div className="table-wrap"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Détail</th></tr></thead><tbody>{filtered.map(a=><tr key={a.id}><td>{dateTime(a.created_at)}</td><td>{a.actor_name??'—'}</td><td><code>{a.action}</code></td><td className="small muted detail">{JSON.stringify(a.detail).slice(0,160)}</td></tr>)}</tbody></table></div>:<p className="muted">Chargement…</p>}
      {audit&&!filtered.length?<Empty title="Aucun événement"/>:null}</section>:null}
  </>;
}
