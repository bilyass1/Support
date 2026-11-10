'use client';
import { useState } from 'react';
import { ArrowLeft, Plus, Search, Users } from 'lucide-react';
import type { Organization, ViewProps } from '@/lib/types';
import { MODULES, moduleLabels } from '@/lib/domain';
import { ActionForm, Field } from '../forms';
import { Empty, Meter, Stat, ago, date, megabytes, money } from '../ui';
import { TicketRow } from './overview';
export function ClientsView(props:ViewProps) {
  const {data,run,admin}=props;
  const [selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState(''),[adding,setAdding]=useState(false);
  const client=data.organizations.find(o=>o.id===selected);
  if(client)return <Client360 {...props} client={client} back={()=>setSelected(null)}/>;
  const list=data.organizations.filter(o=>o.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <>
    <div className="section-title"><div className="search"><Search size={16}/><input aria-label="Rechercher un client" placeholder="Rechercher un client…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {admin?<button className="primary" onClick={()=>setAdding(!adding)}><Plus size={17}/>Nouveau client</button>:null}</div>
    {adding?<section className="panel"><h2>Nouveau client</h2><ActionForm label="Créer le client" onSubmit={async f=>{const created=await run({type:'create_organization',name:f.get('name'),email:f.get('email')||undefined},'Client créé.');if(created){setAdding(false);setSelected(String(created.id));}return created;}}>
      <div className="form-grid"><Field label="Nom de l’organisation"><input name="name" required minLength={2} maxLength={120}/></Field><Field label="E-mail d’un compte déjà créé (facultatif)"><input name="email" type="email"/></Field></div>
      <p className="small muted">Vous pourrez ajouter des utilisateurs, une formule, des applications et choisir les modules visibles depuis la fiche du client.</p></ActionForm></section>:null}
    <div className="card-grid">{list.map(o=>{
      const alerts=data.alerts.filter(a=>a.organization_id===o.id),open=data.tickets.filter(t=>t.organization_id===o.id&&!['closed','cancelled'].includes(t.status)).length;
      const members=data.members.filter(m=>m.organization_id===o.id),last=members.map(m=>m.last_active).filter(Boolean).sort().pop();
      return <button className="panel client-card" key={o.id} onClick={()=>setSelected(o.id)}><div className="section-title"><h2>{o.name}</h2><span className="badge">{o.snapshot?.name??'Sans formule'}</span></div>
        <div className="kpis"><div><strong>{o.balance-o.reserved}</strong><span>crédits</span></div><div><strong>{open}</strong><span>demandes ouvertes</span></div><div><strong>{data.applications.filter(a=>a.organization_id===o.id).length}</strong><span>applications</span></div></div>
        <p className="small muted">{members.length} utilisateur(s) · dernière activité : {ago(last).toLowerCase()}</p>
        {alerts.length?<p className={'small alert-text alert-text-'+(alerts.some(a=>a.level==='danger')?'danger':'warning')}>{alerts.length} point(s) d’attention · {alerts[0].message}</p>:null}</button>;})}</div>
    {!list.length?<Empty icon={<Users size={30}/>} title="Aucun client">{admin?'Créez votre premier client pour commencer.':'Aucun client ne correspond à cette recherche.'}</Empty>:null}
  </>;
}
function Client360({data,run,go,admin,client,back}:ViewProps&{client:Organization;back:()=>void}) {
  const [modules,setModules]=useState<string[]>(client.modules);
  const of=<T extends {organization_id:string|null}>(list:T[])=>list.filter(item=>item.organization_id===client.id);
  const tickets=of(data.tickets),invoices=of(data.invoices),applications=of(data.applications),members=of(data.members),alerts=of(data.alerts),mail=data.mail.find(m=>m.organization_id===client.id);
  const due=invoices.filter(i=>i.status==='sent'),sessions=data.usage.filter(u=>applications.some(a=>a.id===u.application_id)).reduce((sum,u)=>sum+u.sessions,0);
  const rated=tickets.filter(t=>t.rating);
  const changed=modules.slice().sort().join()!==client.modules.slice().sort().join();
  return <>
    <div className="section-title"><button onClick={back}><ArrowLeft size={16}/>Tous les clients</button><span className="small muted">Client depuis le {date(client.created_at)}</span></div>
    <section className="panel"><div className="section-title"><div><h2 className="client-name">{client.name}</h2><span className="small muted">{[client.contact_email,client.phone,client.tax_id&&'MF '+client.tax_id].filter(Boolean).join(' · ')||'Coordonnées à compléter'}</span></div>
      <span className="badge">{client.snapshot?`${client.snapshot.name} · jusqu’au ${date(client.ends_at)}`:'Sans formule'}</span></div>
      {alerts.map((a,index)=><p key={index} className={'small alert-text alert-text-'+a.level}>{a.message}</p>)}</section>
    <div className="stats">
      <Stat label="Crédits disponibles" value={client.balance-client.reserved} hint={<Meter value={client.balance-client.reserved} max={client.balance} label="Part des crédits disponibles" remaining/>}/>
      <Stat label="Demandes" value={tickets.filter(t=>!['closed','cancelled'].includes(t.status)).length} hint={`${tickets.length} au total${rated.length?' · satisfaction '+(rated.reduce((s,t)=>s+(t.rating??0),0)/rated.length).toFixed(1)+'/5':''}`}/>
      <Stat label="Factures à encaisser" value={due.length?due.map(i=>money(i.total_minor,i.currency)).join(' + '):'0'} hint={`${invoices.filter(i=>i.status==='paid').length} payée(s) · ${due.filter(i=>i.overdue).length} en retard`} tone={due.some(i=>i.overdue)?'danger':undefined}/>
      <Stat label="Messagerie" value={mail?.mailboxes?`${mail.mailboxes} boîte(s)`:'—'} hint={mail?.mailboxes?(mail.synced_at?`${megabytes(mail.used_mb)} utilisés sur ${megabytes(mail.quota_mb)} · ${mail.messages} messages`:`${megabytes(mail.quota_mb)} réservés · utilisation réelle non relevée`):'Aucun domaine'} tone={mail?.nearly_full?'warning':undefined}/>
      <Stat label="Utilisation des applications" value={sessions} hint={`sessions sur 30 jours · ${applications.filter(a=>a.tracked).length}/${applications.length} application(s) suivie(s)`}/>
    </div>
    <div className="overview-grid">
      <div className="stack">
        <section className="panel"><h2>Modules visibles par ce client</h2><p className="small muted">Le client ne voit et n’utilise que les modules cochés. Le contrôle est appliqué côté serveur.</p>
          <div className="module-grid">{MODULES.map(m=><label key={m} className={'module'+(modules.includes(m)?' module-on':'')}><input type="checkbox" disabled={!admin} checked={modules.includes(m)} onChange={e=>setModules(current=>e.target.checked?[...current,m]:current.filter(x=>x!==m))}/>{moduleLabels[m]}</label>)}</div>
          {admin?<button className="primary" disabled={!changed} onClick={()=>run({type:'set_modules',organization_id:client.id,modules},'Modules mis à jour.')}>Enregistrer les modules</button>:null}</section>
        <section className="panel"><div className="section-title"><h2>Utilisateurs du portail</h2><span className="badge">{members.length}</span></div>
          {members.map(m=><div className="mini-row" key={m.user_id}><div><strong>{m.name}</strong><span className="small muted">{m.email} · {m.last_active?'actif '+ago(m.last_active).toLowerCase():'jamais connecté'}</span></div>{admin?<button className="danger" onClick={()=>{if(window.confirm(`Retirer l’accès de ${m.name} à ce client ?`))run({type:'remove_member',user_id:m.user_id},'Accès retiré.');}}>Retirer</button>:null}</div>)}
          {!members.length?<p className="muted">Aucun utilisateur associé.</p>:null}
          {admin?<ActionForm label="Ajouter l’utilisateur" onSubmit={f=>run({type:'add_member',organization_id:client.id,email:f.get('email')},'Utilisateur ajouté.')}><Field label="E-mail d’un compte déjà créé"><input name="email" type="email" required/></Field></ActionForm>:null}</section>
        <section className="panel"><div className="section-title"><h2>Applications</h2><button className="text-button" onClick={()=>go('usage')}>Utilisation →</button></div>
          {applications.map(a=><div className="mini-row" key={a.id}><div><strong>{a.name}</strong><span className="small muted">{a.kind}{a.last_version?' · v'+a.last_version:''}</span></div><span className="small muted">{a.tracked?'vue '+ago(a.last_seen_at).toLowerCase():'suivi non activé'}</span></div>)}
          <ActionForm label="Ajouter l’application" onSubmit={f=>run({type:'create_application',organization_id:client.id,name:f.get('name'),kind:f.get('kind')},'Application ajoutée.')}><div className="form-grid"><Field label="Nom"><input name="name" required minLength={2} maxLength={120}/></Field><Field label="Type"><select name="kind"><option value="web">Web</option><option value="mobile">Mobile</option><option value="software">Logiciel</option></select></Field></div></ActionForm></section>
      </div>
      <div className="stack">
        {admin?<section className="panel"><h2>Formule & crédits</h2>
          <ActionForm label="Appliquer la formule" onSubmit={f=>run({type:'assign_plan',organization_id:client.id,plan_id:f.get('plan_id')},'Formule appliquée.')}><Field label="Formule"><select name="plan_id" required defaultValue={client.snapshot?.id}>{data.plans.map(p=><option key={p.id} value={p.id}>{p.name} · {p.annual_tokens} crédits/an</option>)}</select></Field>
            <p className="small muted">Le quota est crédité à la première attribution. Changer de formule ne recharge pas le solde.</p></ActionForm>
          {client.snapshot?<button onClick={()=>{if(window.confirm(`Renouveler la formule pour un an et créditer ${client.snapshot!.annual_tokens} crédits ?`))run({type:'renew_subscription',organization_id:client.id},'Formule renouvelée pour un an.');}}>Renouveler pour un an (+{client.snapshot.annual_tokens} crédits)</button>:null}
          <h3>Recharge manuelle</h3>
          <ActionForm label="Créditer le portefeuille" onSubmit={f=>run({type:'recharge',organization_id:client.id,tokens:Number(f.get('tokens')),note:f.get('note')},'Crédits ajoutés.')}><div className="form-grid"><Field label="Nombre de crédits"><input name="tokens" type="number" min={1} max={1000000} required/></Field><Field label="Motif ou référence du paiement"><input name="note" required minLength={3} maxLength={500}/></Field></div></ActionForm></section>:null}
        {admin?<section className="panel"><h2>Coordonnées & facturation</h2>
          <ActionForm label="Enregistrer" onSubmit={f=>run({type:'update_organization',organization_id:client.id,name:f.get('name'),contact_email:f.get('contact_email')||null,phone:f.get('phone'),tax_id:f.get('tax_id'),address:f.get('address')},'Coordonnées enregistrées.')}>
            <div className="form-grid" key={client.id+client.name+client.contact_email+client.phone+client.tax_id+client.address}><Field label="Nom"><input name="name" required minLength={2} defaultValue={client.name}/></Field><Field label="E-mail de contact"><input name="contact_email" type="email" defaultValue={client.contact_email??''}/></Field>
              <Field label="Téléphone"><input name="phone" maxLength={40} defaultValue={client.phone??''}/></Field><Field label="Matricule fiscal"><input name="tax_id" maxLength={60} defaultValue={client.tax_id??''}/></Field></div>
            <Field label="Adresse de facturation"><input name="address" maxLength={300} defaultValue={client.address??''}/></Field></ActionForm></section>:null}
        <section className="panel"><div className="section-title"><h2>Dernières demandes</h2><button className="text-button" onClick={()=>go('tickets')}>Toutes →</button></div>
          {tickets.slice(0,5).map(t=><TicketRow key={t.id} ticket={t} data={data} go={go}/>)}{!tickets.length?<p className="muted">Aucune demande.</p>:null}</section>
      </div>
    </div>
  </>;
}
