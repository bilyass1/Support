'use client';
import { Bell, Download } from 'lucide-react';
import type { ViewProps } from '@/lib/types';
import { Empty, date, dateTime, downloadCsv } from '../ui';
const kinds:Record<string,string>={annual_allocation:'Quota annuel',manual_recharge:'Recharge',reserve:'Réservation',consume:'Consommation',release:'Libération'};
export function LedgerView({data,staff}:ViewProps) {
  const name=(id:string)=>data.organizations.find(o=>o.id===id)?.name??'';
  return <section className="panel"><div className="section-title"><h2>Mouvements de crédits</h2>
    <button onClick={()=>downloadCsv('credits',['Date','Client','Opération','Solde','Réservés','Motif'],data.ledger.map(l=>[date(l.created_at),name(l.organization_id),kinds[l.kind]??l.kind,l.balance_delta,l.reserved_delta,l.note]))}><Download size={16}/>Exporter</button></div>
    <div className="table-wrap"><table><thead><tr><th>Date</th>{staff?<th>Client</th>:null}<th>Opération</th><th className="num">Solde</th><th className="num">Réservés</th><th>Motif</th></tr></thead>
      <tbody>{data.ledger.map(l=><tr key={l.id}><td>{date(l.created_at)}</td>{staff?<td>{name(l.organization_id)}</td>:null}<td>{kinds[l.kind]??l.kind}</td><td className="num">{l.balance_delta>0?'+':''}{l.balance_delta}</td><td className="num">{l.reserved_delta>0?'+':''}{l.reserved_delta}</td><td>{l.note}</td></tr>)}</tbody></table></div>
    {!data.ledger.length?<Empty title="Aucun mouvement enregistré"/>:null}</section>;
}
export function NotificationsView({data,go,staff}:ViewProps) {
  return <section className="panel"><h2>Notifications</h2>
    {data.notifications.map(n=><button className="notification" key={n.id} onClick={()=>go(n.tab,n.ticket_id)}><Bell size={18}/><div><strong>{n.title}</strong><p>{n.message}</p>
      <span className="small muted">{dateTime(n.created_at)}{staff?' · '+(data.organizations.find(o=>o.id===n.organization_id)?.name??''):''}</span></div></button>)}
    {!data.notifications.length?<Empty icon={<Bell size={30}/>} title="Vous êtes à jour">Les nouveautés de vos demandes et factures arriveront ici, par e-mail et en notification.</Empty>:null}</section>;
}
