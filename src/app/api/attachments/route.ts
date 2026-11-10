import { authenticated,sameOrigin,failure } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { pool } from '@/lib/db';
import { moduleOn,type Actor } from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BYTES=5*1024*1024,MAX_FILES=10;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function ticketAccess(actor:Actor,ticketId:string) {
  if(!uuid.test(ticketId)) throw new DomainError('Ticket introuvable.',404);
  const ticket=await pool.query('SELECT organization_id FROM tickets WHERE id=$1',[ticketId]);
  if(!ticket.rowCount) throw new DomainError('Ticket introuvable.',404);
  await moduleOn(pool,actor,ticket.rows[0].organization_id,'tickets');
}
export async function GET(request:Request) {
  try {
    const actor=await authenticated(request);
    const id=new URL(request.url).searchParams.get('id')??'';
    if(!uuid.test(id)) throw new DomainError('Fichier introuvable.',404);
    const file=await pool.query('SELECT ticket_id,name,data FROM ticket_attachments WHERE id=$1',[id]);
    if(!file.rowCount) throw new DomainError('Fichier introuvable.',404);
    await ticketAccess(actor,file.rows[0].ticket_id);
    // Always served as a download with a neutral type, so an uploaded file can never run in the portal's origin.
    return new Response(new Uint8Array(file.rows[0].data),{headers:{'Content-Type':'application/octet-stream',
      'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.rows[0].name)}`,'Content-Security-Policy':"default-src 'none'; sandbox"}});
  } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const actor=await authenticated(request);
    if(Number(request.headers.get('content-length')??'0')>MAX_BYTES+100_000) throw new DomainError('Fichier trop volumineux (5 Mo maximum).',413);
    const form=await request.formData();
    const file=form.get('file'),ticketId=String(form.get('ticket_id')??'');
    if(!(file instanceof File)||!file.size) throw new DomainError('Choisissez un fichier.');
    if(file.size>MAX_BYTES) throw new DomainError('Fichier trop volumineux (5 Mo maximum).',413);
    await ticketAccess(actor,ticketId);
    const count=await pool.query('SELECT count(*)::int AS count FROM ticket_attachments WHERE ticket_id=$1',[ticketId]);
    if(count.rows[0].count>=MAX_FILES) throw new DomainError(`Un ticket accepte ${MAX_FILES} fichiers au maximum.`,409);
    const name=file.name.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,160)||'fichier';
    await pool.query('INSERT INTO ticket_attachments(ticket_id,uploaded_by,name,mime,size,data) VALUES ($1,$2,$3,$4,$5,$6)',
      [ticketId,actor.id,name,(file.type||'application/octet-stream').slice(0,100),file.size,Buffer.from(await file.arrayBuffer())]);
    return Response.json({ok:true});
  } catch(error) { return failure(error); }
}
