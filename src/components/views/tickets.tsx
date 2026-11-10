'use client';
import { useMemo, useRef, useState } from 'react';
import { Download, Lock, Paperclip, Plus, Star, X } from 'lucide-react';
import type { ViewProps } from '@/lib/types';
import { priorityLabels, slaBreached, slaHours, statusLabels, suggestedCost, type TicketStatus } from '@/lib/domain';
import { ActionForm, Field } from '../forms';
import { Empty, dateTime, downloadCsv } from '../ui';
import { TicketRow } from './overview';
const categories={design:'Design',development:'Développement',bug:'Correction de bug'};
export function TicketsView({data,run,go,staff,selected,reload}:ViewProps&{selected:string|null;email:string}) {
  const [creating,setCreating]=useState(false),[search,setSearch]=useState(''),[status,setStatus]=useState('open'),[client,setClient]=useState(''),[pending,setPending]=useState(false),[uploadError,setUploadError]=useState(''),[stars,setStars]=useState(0);
  const file=useRef<HTMLInputElement>(null);
  const ticket=data.tickets.find(t=>t.id===selected);
  const tickets=useMemo(()=>data.tickets.filter(t=>(status==='all'||(status==='open'?!['closed','cancelled'].includes(t.status):t.status===status))&&(!client||t.organization_id===client)
    &&(t.title+' #'+t.number+' '+statusLabels[t.status]).toLowerCase().includes(search.trim().toLowerCase())),[data.tickets,status,client,search]);
  const organization=(id:string)=>data.organizations.find(o=>o.id===id);
  const canCreate=data.applications.length>0&&(staff||Boolean(data.organizations[0]?.snapshot&&new Date(data.organizations[0].ends_at??0)>new Date()));
  async function move(next:TicketStatus,message:string){setPending(true);await run({type:'move',ticket_id:ticket!.id,status:next},message);setPending(false);}
  async function upload(list:FileList|null) {
    if(!list?.length||!ticket)return;
    setUploadError('');setPending(true);
    try{
      const body=new FormData();body.set('ticket_id',ticket.id);body.set('file',list[0]);
      const response=await fetch('/api/attachments',{method:'POST',body});
      if(!response.ok)setUploadError((await response.json()).error??'Envoi impossible.');else await reload();
    }catch{setUploadError('Envoi impossible. Vérifiez votre connexion.');}finally{setPending(false);if(file.current)file.current.value='';}
  }
  if(ticket) {
    const breached=slaBreached(ticket),comments=data.comments.filter(c=>c.ticket_id===ticket.id),files=data.attachments.filter(a=>a.ticket_id===ticket.id);
    const active=!['closed','cancelled'].includes(ticket.status);
    return <section className="panel ticket-detail">
      <div className="section-title"><div><p className="eyebrow">DEMANDE #{ticket.number} · {categories[ticket.category].toUpperCase()}{staff?' · '+(organization(ticket.organization_id)?.name??'').toUpperCase():''}</p><h2>{ticket.title}</h2></div><button onClick={()=>go('tickets')}><X size={16}/>Fermer</button></div>
      <div className="actions"><span className={'badge status-'+ticket.status}>{statusLabels[ticket.status]}</span><span className={'badge priority-'+ticket.priority}>Priorité {priorityLabels[ticket.priority].toLowerCase()}</span>
        {staff&&active?<span className={'badge '+(breached?'badge-danger':'')}>{ticket.first_response_at?(breached?'Première réponse hors délai':'Première réponse dans le délai'):(breached?`Délai de ${slaHours[ticket.priority]} h dépassé`:`Réponse attendue sous ${slaHours[ticket.priority]} h`)}</span>:null}
        <span className="small muted">Créée le {dateTime(ticket.created_at)}</span></div>
      <p className="preserve description">{ticket.description}</p>
      {ticket.estimated_tokens!==null?<div className="quote-note"><strong>{ticket.estimated_tokens} crédits · estimation v{ticket.estimate_revision}</strong>{ticket.estimate_note?<p className="preserve">{ticket.estimate_note}</p>:null}</div>:null}
      {staff&&active?<ActionForm label="Enregistrer le tri" onSubmit={f=>run({type:'triage',ticket_id:ticket.id,priority:f.get('priority'),assignee_id:f.get('assignee_id')||null})}><div className="form-grid">
        <Field label="Priorité"><select name="priority" defaultValue={ticket.priority} key={ticket.priority}>{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Responsable"><select name="assignee_id" defaultValue={ticket.assignee_id??''} key={ticket.assignee_id??'none'}><option value="">Non assigné</option>{data.team.map(m=><option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></Field></div></ActionForm>:null}
      {staff&&['new','quoted'].includes(ticket.status)?<ActionForm label="Envoyer l’estimation au client" onSubmit={f=>run({type:'quote',ticket_id:ticket.id,tokens:Number(f.get('tokens')),note:f.get('note')},'Estimation envoyée au client.')}><div className="form-grid">
        <Field label="Coût en crédits"><input name="tokens" type="number" min={0} max={1000000} required defaultValue={ticket.estimated_tokens??suggestedCost(organization(ticket.organization_id)?.snapshot?.rules??[],ticket.category)??0}/></Field>
        <Field label="Périmètre et délai proposés"><input name="note" required minLength={3} maxLength={2000}/></Field></div></ActionForm>:null}
      <div className="actions spaced">
        {!staff&&ticket.status==='quoted'?<button className="primary" disabled={pending} onClick={async()=>{setPending(true);await run({type:'accept',ticket_id:ticket.id,estimate_revision:ticket.estimate_revision},'Estimation acceptée : crédits réservés.');setPending(false);}}>Accepter et réserver {ticket.estimated_tokens} crédits</button>:null}
        {staff&&ticket.status==='accepted'?<button className="primary" disabled={pending} onClick={()=>move('in_progress','Réalisation démarrée.')}>Démarrer la réalisation</button>:null}
        {staff&&ticket.status==='in_progress'?<button className="primary" disabled={pending} onClick={()=>move('ready','Livraison prête à tester.')}>Marquer prêt à tester</button>:null}
        {ticket.status==='ready'?<button className="primary" disabled={pending} onClick={()=>move('closed','Livraison validée, ticket clôturé.')}>Valider la livraison et clôturer</button>:null}
        {staff&&ticket.status==='ready'?<button disabled={pending} onClick={()=>move('in_progress','Réalisation reprise.')}>Reprendre la réalisation</button>:null}
        {(staff&&active)||(!staff&&['new','quoted'].includes(ticket.status))?<button className="danger" disabled={pending} onClick={()=>{if(window.confirm('Annuler définitivement cette demande ?'))move('cancelled','Demande annulée.');}}>Annuler la demande</button>:null}
      </div>
      {ticket.status==='closed'&&(ticket.rating||!staff)?<div className="rating-box"><h3>Satisfaction</h3>
        {ticket.rating?<p><span className="stars" aria-label={`${ticket.rating} sur 5`}>{[1,2,3,4,5].map(n=><Star key={n} size={18} className={n<=ticket.rating!?'star-on':''}/>)}</span> {ticket.rating_comment}</p>
        :<ActionForm label="Envoyer mon avis" onSubmit={async f=>stars?run({type:'rate',ticket_id:ticket.id,rating:stars,comment:f.get('comment')},'Merci pour votre avis.'):null}>
          <div className="stars" role="radiogroup" aria-label="Votre note">{[1,2,3,4,5].map(n=><button type="button" key={n} role="radio" aria-checked={stars===n} aria-label={`${n} sur 5`} className={'icon-button '+(n<=stars?'star-on':'')} onClick={()=>setStars(n)}><Star size={20}/></button>)}</div>
          <Field label="Un commentaire ? (facultatif)"><input name="comment" maxLength={1000}/></Field></ActionForm>}</div>:null}
      <h3>Pièces jointes</h3>
      <div className="files">{files.map(f=><a key={f.id} className="file" href={'/api/attachments?id='+f.id}><Paperclip size={15}/>{f.name}<span className="small muted">{Math.max(1,Math.round(f.size/1024))} Ko</span></a>)}
        <input ref={file} type="file" hidden onChange={e=>upload(e.target.files)}/><button disabled={pending} onClick={()=>file.current?.click()}><Plus size={15}/>Ajouter un fichier (5 Mo max)</button></div>
      {uploadError?<p className="error" role="alert">{uploadError}</p>:null}
      <h3>Discussion</h3>
      {comments.map(c=><article className={'comment'+(c.internal?' comment-internal':c.from_staff?' comment-staff':'')} key={c.id}><div className="comment-head"><strong>{c.author_name??'Équipe'}</strong>{c.internal?<span className="badge"><Lock size={11}/> Note interne</span>:c.from_staff?<span className="badge">Équipe</span>:null}<span className="small muted">{dateTime(c.created_at)}</span></div><p className="preserve">{c.body}</p></article>)}
      {!comments.length?<p className="muted">Aucun message pour le moment.</p>:null}
      <ActionForm label="Envoyer" onSubmit={f=>run({type:'comment',ticket_id:ticket.id,body:f.get('body'),internal:f.get('internal')==='on'},'Message envoyé.')}>
        <Field label="Votre message"><textarea name="body" rows={3} required maxLength={5000}/></Field>
        {staff?<label className="checkbox"><input type="checkbox" name="internal"/>Note interne, invisible pour le client</label>:null}</ActionForm>
    </section>;
  }
  return <>
    {creating?<section className="panel"><div className="section-title"><h2>Nouvelle demande</h2><button onClick={()=>setCreating(false)}><X size={16}/>Fermer</button></div>
      <ActionForm label="Envoyer la demande" onSubmit={async f=>{const created=await run({type:'create_ticket',application_id:f.get('application_id'),title:f.get('title'),description:f.get('description'),category:f.get('category'),priority:f.get('priority')},'Demande envoyée à l’équipe.');if(created)setCreating(false);return created;}}>
        <div className="form-grid"><Field label="Application"><select name="application_id" required>{data.applications.map(a=><option key={a.id} value={a.id}>{a.name}{staff?' · '+(organization(a.organization_id)?.name??''):''}</option>)}</select></Field>
          <Field label="Type de demande"><select name="category">{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Priorité"><select name="priority" defaultValue="normal">{Object.entries(priorityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field></div>
        <Field label="Titre"><input name="title" required minLength={3} maxLength={160}/></Field>
        <Field label="Décrivez le résultat attendu"><textarea name="description" required minLength={10} maxLength={10000} rows={5}/></Field>
        <p className="small muted">Aucun crédit n’est réservé avant votre acceptation de l’estimation. Vous pourrez joindre des fichiers une fois la demande créée.</p></ActionForm></section>:null}
    <section className="panel"><div className="section-title"><h2>Demandes</h2><div className="actions">
      <button onClick={()=>downloadCsv('demandes',['Numéro','Client','Titre','Statut','Priorité','Crédits','Créée le'],tickets.map(t=>[t.number,organization(t.organization_id)?.name,t.title,statusLabels[t.status],priorityLabels[t.priority],t.estimated_tokens,dateTime(t.created_at)]))}><Download size={16}/>Exporter</button>
      {canCreate&&!creating?<button className="primary" onClick={()=>setCreating(true)}><Plus size={17}/>Nouvelle demande</button>:null}</div></div>
      {!canCreate&&!staff?<p className="warning">{data.applications.length?'Une formule active est nécessaire pour créer une demande. Contactez notre équipe.':'Aucune application n’est encore associée à votre espace.'}</p>:null}
      <div className="filters"><input aria-label="Rechercher une demande" placeholder="Rechercher un titre, un numéro…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select aria-label="Filtrer par statut" value={status} onChange={e=>setStatus(e.target.value)}><option value="open">En cours</option><option value="all">Toutes</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        {staff?<select aria-label="Filtrer par client" value={client} onChange={e=>setClient(e.target.value)}><option value="">Tous les clients</option>{data.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>:null}</div>
      {tickets.map(t=><TicketRow key={t.id} ticket={t} data={data} go={go}/>)}
      {!tickets.length?<Empty title="Aucune demande trouvée">Modifiez les filtres ou créez une nouvelle demande.</Empty>:null}</section>
  </>;
}
