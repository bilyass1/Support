import { headers } from 'next/headers';
import { DomainError } from '@/lib/domain';
import { authenticated } from '@/lib/request';
import { pool } from '@/lib/db';
import { notFound, redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 let actor;try{actor=await authenticated(new Request(process.env.BETTER_AUTH_URL??'http://localhost',{headers:await headers()}));}catch(e){if(e instanceof DomainError&&e.status===428)redirect('/');redirect('/login');}
 const invoice=(await pool.query('SELECT * FROM invoices WHERE id=$1',[id])).rows[0];if(!invoice||(actor.role==='client'&&actor.organization_id!==invoice.organization_id))notFound();
 return <main className="invoice-sheet"><img className="brand-logo" src="/solumove-logo.webp" alt="Solumove Technologies"/><h1>Facture {invoice.number}</h1><address><strong>{invoice.issuer.name}</strong><br/>{invoice.issuer.address}<br/>Identifiant fiscal : {invoice.issuer.tax_id}</address><hr/><h2>Client : {invoice.client_name}</h2><p>Émise le {new Date(invoice.issued_at).toLocaleDateString('fr-TN')} · Échéance {new Date(invoice.due_at).toLocaleDateString('fr-TN')}</p><table><thead><tr><th>Description</th><th>Montant total</th></tr></thead><tbody><tr><td className="preserve">{invoice.description}</td><td>{new Intl.NumberFormat('fr-TN',{style:'currency',currency:invoice.currency}).format(invoice.amount_minor/(invoice.currency==='TND'?1000:100))}</td></tr></tbody></table><p>Statut : {invoice.status}</p><p className="print-controls">Utilisez Imprimer → Enregistrer en PDF dans votre navigateur.</p></main>;
}
