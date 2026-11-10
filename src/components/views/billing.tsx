'use client';
import { useState } from 'react';
import { Download, Plus, Printer, Receipt, Trash2, X } from 'lucide-react';
import type { Invoice, ViewProps } from '@/lib/types';
import { invoiceTotals, minorUnits } from '@/lib/domain';
import { Field } from '../forms';
import { Empty, Stat, date, downloadCsv, money } from '../ui';
const labels={draft:'Brouillon',sent:'À régler',paid:'Payée',cancelled:'Annulée'};
export const invoiceLabel=(invoice:{number:string|number})=>'F-'+String(invoice.number).padStart(5,'0');
type Line={label:string;quantity:string;price:string};
function Editor({data,run,invoice,onClose}:Pick<ViewProps,'data'|'run'>&{invoice?:Invoice;onClose:()=>void}) {
  const [currency,setCurrency]=useState(invoice?.currency??'TND'),[pending,setPending]=useState(false);
  const unit=minorUnits(currency);
  const [lines,setLines]=useState<Line[]>(invoice?invoice.items.map(i=>({label:i.label,quantity:String(i.quantity),price:String(i.unit_minor/minorUnits(invoice.currency))})):[{label:'',quantity:'1',price:''}]);
  const [tax,setTax]=useState(String((invoice?.tax_rate_bp??1900)/100)),[stamp,setStamp]=useState(String((invoice?.stamp_minor??(currency==='TND'?1000:0))/unit));
  const items=lines.map(l=>({label:l.label.trim(),quantity:Number(l.quantity)||0,unit_minor:Math.round((Number(l.price)||0)*unit)}));
  const taxBp=Math.round((Number(tax)||0)*100),stampMinor=Math.round((Number(stamp)||0)*unit);
  let totals={subtotal:0,tax:0,total:0};try{totals=invoiceTotals(items,taxBp,stampMinor);}catch{}
  const update=(index:number,patch:Partial<Line>)=>setLines(current=>current.map((l,i)=>i===index?{...l,...patch}:l));
  return <section className="panel"><div className="section-title"><h2>{invoice?'Modifier '+invoiceLabel(invoice):'Nouvelle facture'}</h2><button onClick={onClose}><X size={16}/>Fermer</button></div>
    <form className="form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setPending(true);
      const saved=await run({type:'save_invoice',id:invoice?.id,organization_id:f.get('organization_id'),currency,items,tax_rate_bp:taxBp,stamp_minor:stampMinor,due_at:f.get('due_at'),note:f.get('note')},'Facture enregistrée en brouillon.');
      setPending(false);if(saved)onClose();}}>
      <div className="form-grid"><Field label="Client"><select name="organization_id" required defaultValue={invoice?.organization_id}>{data.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Devise"><select value={currency} onChange={e=>setCurrency(e.target.value)}><option>TND</option><option>EUR</option><option>USD</option></select></Field>
        <Field label="Échéance"><input name="due_at" type="date" required defaultValue={invoice?.due_at??new Date(Date.now()+30*86_400_000).toISOString().slice(0,10)}/></Field></div>
      {lines.map((line,index)=><div className="invoice-line" key={index}>
        <Field label="Désignation"><input required maxLength={200} value={line.label} onChange={e=>update(index,{label:e.target.value})}/></Field>
        <Field label="Quantité"><input type="number" min={0.01} step="0.01" required value={line.quantity} onChange={e=>update(index,{quantity:e.target.value})}/></Field>
        <Field label="Prix unitaire HT"><input type="number" min={0} step="0.001" required value={line.price} onChange={e=>update(index,{price:e.target.value})}/></Field>
        <button type="button" className="icon-button" aria-label="Retirer la ligne" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}
      <button type="button" onClick={()=>setLines(current=>[...current,{label:'',quantity:'1',price:''}])}><Plus size={15}/>Ajouter une ligne</button>
      <div className="form-grid"><Field label="TVA (%)"><input type="number" min={0} max={100} step="0.01" value={tax} onChange={e=>setTax(e.target.value)}/></Field>
        <Field label="Timbre fiscal"><input type="number" min={0} step="0.001" value={stamp} onChange={e=>setStamp(e.target.value)}/></Field>
        <Field label="Note sur la facture (facultatif)"><input name="note" maxLength={1000} defaultValue={invoice?.note??''}/></Field></div>
      <div className="totals"><span>Total HT <strong>{money(totals.subtotal,currency)}</strong></span><span>TVA <strong>{money(totals.tax,currency)}</strong></span><span>Timbre <strong>{money(stampMinor,currency)}</strong></span><span className="total">Total TTC <strong>{money(totals.total,currency)}</strong></span></div>
      <button className="primary" disabled={pending}>{pending?'Enregistrement…':'Enregistrer le brouillon'}</button>
    </form></section>;
}
export function BillingView({data,run,admin,staff}:ViewProps) {
  const [editing,setEditing]=useState<Invoice|'new'|null>(null),[filter,setFilter]=useState('all'),[pending,setPending]=useState(false);
  const name=(id:string)=>data.organizations.find(o=>o.id===id)?.name??'';
  const invoices=data.invoices.filter(i=>filter==='all'||(filter==='overdue'?i.overdue:i.status===filter));
  const sum=(list:Invoice[])=>{const by=list.reduce<Record<string,number>>((t,i)=>({...t,[i.currency]:(t[i.currency]??0)+i.total_minor}),{});return Object.entries(by).map(([c,v])=>money(v,c)).join(' + ')||'0';};
  const year=new Date().getFullYear();
  async function status(invoice:Invoice,next:string,message:string,confirm?:string){if(confirm&&!window.confirm(confirm))return;setPending(true);await run({type:'invoice_status',invoice_id:invoice.id,status:next},message);setPending(false);}
  return <>
    <div className="stats"><Stat label={staff?'À encaisser':'À régler'} value={sum(data.invoices.filter(i=>i.status==='sent'))} hint={`${data.invoices.filter(i=>i.status==='sent').length} facture(s) en attente`}/>
      <Stat label="En retard" value={sum(data.invoices.filter(i=>i.overdue))} hint={`${data.invoices.filter(i=>i.overdue).length} facture(s)`} tone={data.invoices.some(i=>i.overdue)?'danger':undefined}/>
      <Stat label={`Payé en ${year}`} value={sum(data.invoices.filter(i=>i.status==='paid'&&i.paid_at&&new Date(i.paid_at).getFullYear()===year))} tone="good"/></div>
    {editing?<Editor key={typeof editing==='string'?'new':editing.id} data={data} run={run} invoice={typeof editing==='string'?undefined:editing} onClose={()=>setEditing(null)}/>:null}
    <section className="panel"><div className="section-title"><h2>Factures</h2><div className="actions">
      <select aria-label="Filtrer les factures" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Toutes</option><option value="sent">À régler</option><option value="overdue">En retard</option><option value="paid">Payées</option>{staff?<option value="draft">Brouillons</option>:null}</select>
      <button onClick={()=>downloadCsv('factures',['Numéro','Client','Statut','Total HT','TVA','Timbre','Total TTC','Devise','Échéance','Payée le'],invoices.map(i=>{const u=minorUnits(i.currency);return [invoiceLabel(i),name(i.organization_id),labels[i.status],i.subtotal_minor/u,i.tax_minor/u,i.stamp_minor/u,i.total_minor/u,i.currency,i.due_at,i.paid_at?date(i.paid_at):''];}))}><Download size={16}/>Exporter</button>
      {admin&&!editing&&data.organizations.length?<button className="primary" onClick={()=>setEditing('new')}><Plus size={17}/>Nouvelle facture</button>:null}</div></div>
      <div className="table-wrap"><table><thead><tr><th>Facture</th>{staff?<th>Client</th>:null}<th>Statut</th><th>Échéance</th><th className="num">Total TTC</th><th/></tr></thead><tbody>
        {invoices.map(i=><tr key={i.id}><td><strong>{invoiceLabel(i)}</strong><div className="small muted">{i.items[0]?.label}{i.items.length>1?` + ${i.items.length-1}`:''}</div></td>{staff?<td>{name(i.organization_id)}</td>:null}
          <td><span className={'badge invoice-'+(i.overdue?'overdue':i.status)}>{i.overdue?'En retard':labels[i.status]}</span></td><td>{date(i.due_at)}</td><td className="num"><strong>{money(i.total_minor,i.currency)}</strong></td>
          <td><div className="actions end"><a className="button" href={'/facture/'+i.id} target="_blank" rel="noreferrer"><Printer size={15}/>PDF</a>
            {admin&&i.status==='draft'?<><button disabled={pending} onClick={()=>setEditing(i)}>Modifier</button><button className="primary" disabled={pending} onClick={()=>status(i,'sent','Facture envoyée au client par e-mail et notification.','Envoyer cette facture au client ? Elle ne pourra plus être modifiée.')}>Envoyer</button></>:null}
            {admin&&i.status==='sent'?<button className="primary" disabled={pending} onClick={()=>status(i,'paid','Paiement enregistré, client prévenu.','Confirmer la réception du paiement ?')}>Marquer payée</button>:null}
            {admin&&['draft','sent'].includes(i.status)?<button className="danger" disabled={pending} onClick={()=>status(i,'cancelled','Facture annulée.','Annuler cette facture ?')}>Annuler</button>:null}</div></td></tr>)}
      </tbody></table></div>
      {!invoices.length?<Empty icon={<Receipt size={30}/>} title="Aucune facture">{staff?'Créez une facture : le client la reçoit par e-mail et notification dès l’envoi.':'Vos factures apparaîtront ici dès leur émission.'}</Empty>:null}</section>
  </>;
}
