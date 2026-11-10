'use client';
import { ArrowUpRight, Megaphone, Tickets, TriangleAlert } from 'lucide-react';
import type { Ticket, ViewProps } from '@/lib/types';
import { priorityLabels, statusLabels } from '@/lib/domain';
import { Bars, Empty, Meter, Stat, date, lastDays, money } from '../ui';

export function TicketRow({ticket,data,go}:{ticket:Ticket}&Pick<ViewProps,'data'|'go'>) {
  const organization=data.organizations.find(o=>o.id===ticket.organization_id)?.name;
  return <button className="ticket-row" onClick={()=>go('tickets',ticket.id)}>
    <div><span className="small muted">#{String(ticket.number).padStart(4,'0')}{data.actor.role!=='client'&&organization?' · '+organization:''} · {data.applications.find(a=>a.id===ticket.application_id)?.name}</span><strong>{ticket.title}</strong></div>
    {ticket.priority!=='normal'?<span className={'badge priority-'+ticket.priority}>{priorityLabels[ticket.priority]}</span>:null}
    <span className={'badge status-'+ticket.status}>{statusLabels[ticket.status]}</span>
    <span className="token-amount">{ticket.estimated_tokens===null?'À estimer':ticket.estimated_tokens+' crédits'}</span><ArrowUpRight size={17}/></button>;
}
export function Overview({data,go,staff}:ViewProps) {
  const has=(module:string)=>data.modules.includes(module);
  const open=data.tickets.filter(t=>!['closed','cancelled'].includes(t.status));
  const due=data.invoices.filter(i=>i.status==='sent');
  const dueByCurrency=Object.entries(due.reduce<Record<string,number>>((sum,i)=>({...sum,[i.currency]:(sum[i.currency]??0)+i.total_minor}),{}));
  const available=data.organizations.reduce((sum,o)=>sum+o.balance-o.reserved,0);
  const days=lastDays(30);
  const sessions=days.map(day=>({label:new Date(day).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}),value:data.usage.filter(u=>u.day===day).reduce((sum,u)=>sum+u.sessions,0)}));
  const rated=data.tickets.filter(t=>t.rating);
  const toValidate=open.filter(t=>t.status==='quoted').length,toEstimate=open.filter(t=>t.status==='new').length;
  return <>
    {staff&&data.alerts.length?<section className="panel"><div className="section-title"><h2><TriangleAlert size={18}/> À traiter</h2><span className="badge">{data.alerts.length}</span></div>
      <div className="alert-list">{data.alerts.slice(0,8).map((alert,index)=><button key={index} className={'alert alert-'+alert.level} onClick={()=>go(alert.tab)}><span/>{alert.message}<ArrowUpRight size={15}/></button>)}</div>
      {data.alerts.length>8?<p className="small muted">+ {data.alerts.length-8} autres points d’attention dans la vue Clients.</p>:null}</section>:null}
    {!staff?data.announcements.slice(0,2).map(a=><section className="panel announcement" key={a.id}><Megaphone size={20}/><div><strong>{a.title}</strong><p className="preserve">{a.body}</p><span className="small muted">{date(a.created_at)}</span></div></section>):null}
    <div className="stats">
      {staff?<Stat label="Clients" value={data.organizations.length} hint={`${data.applications.length} application(s) suivie(s)`}/>:null}
      {has('tickets')?<Stat label="Demandes ouvertes" value={open.length} hint={staff?`${toEstimate} à estimer`:`${toValidate} estimation(s) à valider`} tone={!staff&&toValidate?'warning':undefined}/>:null}
      {has('credits')?<Stat label="Crédits disponibles" value={available} hint={`${data.organizations.reduce((sum,o)=>sum+o.reserved,0)} réservés`}/>:null}
      {has('billing')?<Stat label={staff?'Factures à encaisser':'Factures à régler'} value={dueByCurrency.length?dueByCurrency.map(([currency,total])=>money(total,currency)).join(' + '):'0'} hint={`${due.length} en attente · ${due.filter(i=>i.overdue).length} en retard`} tone={due.some(i=>i.overdue)?'danger':undefined}/>:null}
      {staff&&rated.length?<Stat label="Satisfaction" value={(rated.reduce((sum,t)=>sum+(t.rating??0),0)/rated.length).toFixed(1)+' / 5'} hint={`${rated.length} avis clients`} tone="good"/>:null}
      {!staff&&has('usage')?<Stat label="Applications" value={data.applications.length} hint={`${data.applications.filter(a=>a.tracked).length} avec suivi d’utilisation`}/>:null}
    </div>
    <div className="overview-grid">
      {has('tickets')?<section className="panel"><div className="section-title"><h2>Dernières demandes</h2><button className="text-button" onClick={()=>go('tickets')}>Tout voir →</button></div>
        {data.tickets.slice(0,6).map(t=><TicketRow key={t.id} ticket={t} data={data} go={go}/>)}
        {!data.tickets.length?<Empty icon={<Tickets size={30}/>} title="Aucune demande pour le moment">{staff?'Les demandes de vos clients apparaîtront ici.':'Créez votre première demande depuis l’onglet Demandes.'}</Empty>:null}</section>:null}
      <div className="stack">
        {has('usage')&&data.usage.length?<section className="panel"><div className="section-title"><h2>Utilisation des applications</h2><button className="text-button" onClick={()=>go('usage')}>Détail →</button></div>
          <p className="credit-big">{sessions.reduce((sum,p)=>sum+p.value,0)}<span> sessions sur 30 jours</span></p><Bars points={sessions} unit="sessions"/></section>:null}
        {!staff&&has('credits')?data.organizations.map(o=><section className="panel" key={o.id}><div className="section-title"><h2>Votre formule</h2><span className="badge">{o.snapshot?.name??'À attribuer'}</span></div>
          <p className="credit-big">{o.balance-o.reserved}<span> crédits disponibles</span></p><Meter value={o.balance-o.reserved} max={o.balance} label="Part des crédits encore disponibles" remaining/>
          <p className="small muted">{o.reserved} réservés · {o.snapshot?.support_level??'Support à définir'}{o.ends_at?' · échéance le '+date(o.ends_at):''}</p></section>):null}
        {staff?<section className="panel"><div className="section-title"><h2>Clients</h2><button className="text-button" onClick={()=>go('clients')}>Vue 360° →</button></div>
          {data.organizations.slice(0,6).map(o=><div className="mini-row" key={o.id}><div><strong>{o.name}</strong><span className="small muted">{o.snapshot?.name??'Sans formule'}{o.ends_at?' · jusqu’au '+date(o.ends_at):''}</span></div><span className="token-amount">{o.balance-o.reserved} crédits</span></div>)}
          {!data.organizations.length?<p className="muted">Ajoutez votre premier client dans l’onglet Clients.</p>:null}</section>:null}
      </div>
    </div>
  </>;
}
