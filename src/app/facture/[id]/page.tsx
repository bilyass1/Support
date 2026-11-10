import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth, twoFactorRequired } from '@/lib/auth';
import { pool } from '@/lib/db';
import { getActor, moduleOn } from '@/lib/service';
import { formatMoney, type InvoiceItem } from '@/lib/domain';
import { PrintButton } from '@/components/print-button';
export const dynamic='force-dynamic';
const day=(value:string|Date)=>new Date(value).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
const states:Record<string,string>={draft:'BROUILLON',sent:'À RÉGLER',paid:'PAYÉE',cancelled:'ANNULÉE'};
/** Printable invoice: the browser's "Save as PDF" produces the document. */
export default async function InvoicePage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect('/login');
  if(twoFactorRequired()&&!(session.user as {twoFactorEnabled?:boolean|null}).twoFactorEnabled)redirect('/securite');
  if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
  const actor=await getActor(session.user.id,session.user.name);
  const found=await pool.query(`SELECT i.*,i.due_at::text AS due,o.name,o.address,o.tax_id,o.contact_email FROM invoices i JOIN organizations o ON o.id=i.organization_id WHERE i.id=$1`,[id]);
  const invoice=found.rows[0];
  if(!invoice||(actor.role==='client'&&(invoice.organization_id!==actor.organization_id||invoice.status==='draft')))notFound();
  try{await moduleOn(pool,actor,invoice.organization_id,'billing');}catch{notFound();}
  const money=(minor:number)=>formatMoney(minor,invoice.currency);
  const company={name:process.env.COMPANY_NAME||'SupportFlow',address:process.env.COMPANY_ADDRESS,tax:process.env.COMPANY_TAX_ID,contact:process.env.COMPANY_CONTACT};
  return <main className="invoice-page"><div className="invoice-toolbar"><a className="button" href="/?tab=billing">← Retour</a><PrintButton/></div>
    <article className="invoice-sheet">
      <header><div><h1>{company.name}</h1>{company.address?<p>{company.address}</p>:null}{company.tax?<p>Matricule fiscal : {company.tax}</p>:null}{company.contact?<p>{company.contact}</p>:null}</div>
        <div className="invoice-meta"><h2>FACTURE F-{String(invoice.number).padStart(5,'0')}</h2><p className="invoice-state">{states[invoice.status]}</p><p>Date : {day(invoice.issued_at??invoice.created_at)}</p><p>Échéance : {day(invoice.due)}</p>{invoice.paid_at?<p>Payée le {day(invoice.paid_at)}</p>:null}</div></header>
      <section className="invoice-client"><span>FACTURÉ À</span><strong>{invoice.name}</strong>{invoice.address?<p>{invoice.address}</p>:null}{invoice.tax_id?<p>Matricule fiscal : {invoice.tax_id}</p>:null}{invoice.contact_email?<p>{invoice.contact_email}</p>:null}</section>
      <table><thead><tr><th>Désignation</th><th className="num">Qté</th><th className="num">Prix unitaire HT</th><th className="num">Total HT</th></tr></thead>
        <tbody>{(invoice.items as InvoiceItem[]).map((item,index)=><tr key={index}><td>{item.label}</td><td className="num">{item.quantity}</td><td className="num">{money(item.unit_minor)}</td><td className="num">{money(Math.round(item.quantity*item.unit_minor))}</td></tr>)}</tbody></table>
      <div className="invoice-totals"><p><span>Total HT</span><strong>{money(invoice.subtotal_minor)}</strong></p><p><span>TVA ({invoice.tax_rate_bp/100} %)</span><strong>{money(invoice.tax_minor)}</strong></p>{invoice.stamp_minor?<p><span>Timbre fiscal</span><strong>{money(invoice.stamp_minor)}</strong></p>:null}<p className="grand"><span>Total TTC</span><strong>{money(invoice.total_minor)}</strong></p></div>
      {invoice.note?<p className="invoice-note">{invoice.note}</p>:null}
    </article></main>;
}
