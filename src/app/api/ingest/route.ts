import { z } from 'zod';
import { failure } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { recordUsage } from '@/lib/platform';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Called by client applications from any origin. The application key is the only credential; no cookie is read.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-app-key','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Max-Age':'86400'};
const schema=z.object({event:z.string().trim().min(1).max(40).regex(/^[a-z0-9_.-]+$/i),user:z.string().trim().min(1).max(128).optional(),version:z.string().trim().min(1).max(40).optional()});
const windows=new Map<string,{start:number;count:number}>();
function limited(key:string){
 const now=Date.now(),entry=windows.get(key);
 if(windows.size>5000)windows.clear();
 if(!entry||now-entry.start>60_000){windows.set(key,{start:now,count:1});return false;}
 return ++entry.count>300;
}
export function OPTIONS(){return new Response(null,{status:204,headers:cors});}
export async function POST(request:Request){
 let response:Response;
 try{
  const key=request.headers.get('x-app-key')??'';
  if(!/^sf_[A-Za-z0-9_-]{20,80}$/.test(key))throw new DomainError('Clé d’application manquante.',401);
  if(limited(key))throw new DomainError('Trop d’événements. Réessayez dans une minute.',429);
  const raw=await request.text();if(raw.length>2000)throw new DomainError('Requête trop volumineuse.',413);
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new DomainError('JSON invalide.',400);}
  const input=schema.safeParse(value);if(!input.success)throw new DomainError('Événement invalide.',400);
  await recordUsage(key,input.data);
  response=Response.json({ok:true});
 }catch(error){response=failure(error);}
 Object.entries(cors).forEach(([name,value])=>response.headers.set(name,value));
 return response;
}
