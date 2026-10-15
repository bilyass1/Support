import {randomUUID,createHash} from 'node:crypto';
import {mkdir,open,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {z} from 'zod';
import {transaction,pool} from './db';
import {DomainError} from './domain';
import type {Actor} from './service';
export const MAX_PDF=10*1024*1024;
export function validatePdf(bytes:Buffer){if(!bytes.length||bytes.length>MAX_PDF)throw new DomainError('Le PDF doit faire au maximum 10 Mo.',400);if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw new DomainError('Le fichier doit être un PDF valide.',400);}
function directory(){return resolve(process.env.INVOICE_STORAGE_DIR??'/opt/supportflow/private-invoices');}
export async function attachInvoice(actor:Actor,invoiceId:string,bytes:Buffer){
 if(actor.role!=='admin')throw new DomainError('Seul l’admin peut déposer une facture.',403);
 if(!z.uuid().safeParse(invoiceId).success)throw new DomainError('Facture invalide.',400);validatePdf(bytes);
 const root=directory(),key=randomUUID()+'.pdf',file=join(root,key);let created=false;
 try{return await transaction(async c=>{
  const invoice=(await c.query('SELECT organization_id,number FROM invoices WHERE id=$1 FOR UPDATE',[invoiceId])).rows[0];if(!invoice)throw new DomainError('Facture introuvable.',404);
  if((await c.query('SELECT invoice_id FROM invoice_files WHERE invoice_id=$1',[invoiceId])).rowCount)throw new DomainError('Un PDF est déjà joint à cette facture. Il ne peut pas être écrasé.',409);
  await mkdir(root,{recursive:true,mode:0o700});const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await c.query('INSERT INTO invoice_files(invoice_id,storage_key,size_bytes,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5)',[invoiceId,key,bytes.length,createHash('sha256').update(bytes).digest('hex'),actor.id]);
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES($1,\'attach_invoice_pdf\',$2,$3)',[actor.id,invoiceId,JSON.stringify({size:bytes.length})]);
  await c.query('INSERT INTO notifications(organization_id,message) VALUES($1,$2)',[invoice.organization_id,'La facture PDF '+invoice.number+' est disponible.']);
  return {message:'PDF déposé dans le stockage privé et client notifié.'};
 });}catch(e){if(created)await unlink(file).catch(()=>{});throw e;}
}
export async function downloadInvoice(actor:Actor,invoiceId:string){
 if(!z.uuid().safeParse(invoiceId).success)throw new DomainError('Document introuvable.',404);
 const item=(await pool.query('SELECT f.*,i.organization_id,i.number FROM invoice_files f JOIN invoices i ON i.id=f.invoice_id WHERE i.id=$1',[invoiceId])).rows[0];
 if(!item||(actor.role!=='admin'&&actor.organization_id!==item.organization_id))throw new DomainError('Document introuvable.',404);
 if(!/^[0-9a-f-]{36}\.pdf$/.test(item.storage_key))throw new DomainError('Document indisponible.',500);
 const handle=await open(join(directory(),item.storage_key),constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_PDF||stat.size!==item.size_bytes)throw new DomainError('Document indisponible.',500);bytes=await handle.readFile();}finally{await handle.close();}
 if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new DomainError('Document indisponible.',500);
 return {bytes,filename:String(item.number).replace(/[^a-zA-Z0-9_-]/g,'_')+'.pdf'};
}
export async function limitedMultipart(request:Request){if(Number(request.headers.get('content-length')??0)>MAX_PDF+65536)throw new DomainError('Fichier trop volumineux.',413);const reader=request.body?.getReader();if(!reader)throw new DomainError('Fichier manquant.',400);const chunks:Uint8Array[]=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_PDF+65536){await reader.cancel();throw new DomainError('Fichier trop volumineux.',413);}chunks.push(value);}}finally{reader.releaseLock();}return new Request(request.url,{method:'POST',headers:request.headers,body:Buffer.concat(chunks)}).formData();}
