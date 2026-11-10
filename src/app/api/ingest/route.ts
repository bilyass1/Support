import { failure,jsonBody } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { recordUsage } from '@/lib/service';
import { ingestSchema } from '@/lib/validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Called from client applications on any origin; the application key is the only credential and no cookie is read.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-app-key','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Max-Age':'86400'};
const windows=new Map<string,{start:number;count:number}>();
function limited(key:string) {
  const now=Date.now(),entry=windows.get(key);
  if(windows.size>5000) windows.clear();
  if(!entry||now-entry.start>60_000) { windows.set(key,{start:now,count:1}); return false; }
  return ++entry.count>300;
}
export function OPTIONS() { return new Response(null,{status:204,headers:cors}); }
export async function POST(request:Request) {
  try {
    const key=request.headers.get('x-app-key')??'';
    if(!/^sf_[A-Za-z0-9_-]{20,80}$/.test(key)) throw new DomainError('Clé d’application manquante.',401);
    if(limited(key)) throw new DomainError('Trop d’événements. Réessayez dans une minute.',429);
    const input=ingestSchema.safeParse(await jsonBody(request,2000));
    if(!input.success) throw new DomainError('Événement invalide.');
    await recordUsage(key,input.data);
    return Response.json({ok:true},{headers:cors});
  } catch(error) {
    const response=failure(error);
    Object.entries(cors).forEach(([name,value])=>response.headers.set(name,value));
    return response;
  }
}
