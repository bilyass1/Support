import { z } from 'zod';
import { authenticated, sameOrigin, failure } from '@/lib/request';
import { pool } from '@/lib/db';
import { configuredPushKey } from '@/lib/push-config.mjs';
import { allowedPushEndpoint } from '@/lib/push-endpoint.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({endpoint:z.string().max(2048).refine(allowedPushEndpoint),keys:z.object({p256dh:z.string().min(20).max(300),auth:z.string().min(10).max(100)})});
export async function GET(request:Request){try{await authenticated(request);return Response.json({publicKey:configuredPushKey()??''});}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);const actor=await authenticated(request);if(!configuredPushKey())return Response.json({error:'Notifications non configurées sur le serveur.'},{status:503});const raw=await request.text();if(raw.length>8192)return Response.json({error:'Requête trop volumineuse.'},{status:413});let value:unknown;try{value=JSON.parse(raw);}catch{return Response.json({error:'Abonnement invalide.'},{status:400});}const parsed=schema.safeParse(value);if(!parsed.success)return Response.json({error:'Abonnement push non pris en charge.'},{status:400});
 const r=await pool.query('INSERT INTO push_subscriptions(endpoint,user_id,subscription) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription WHERE push_subscriptions.user_id=excluded.user_id RETURNING endpoint',[parsed.data.endpoint,actor.id,JSON.stringify(parsed.data)]);if(!r.rowCount)return Response.json({error:'Cet appareil est associé à un autre compte. Désactivez son abonnement avant de changer de compte.'},{status:409});return Response.json({ok:true});}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{sameOrigin(request);const actor=await authenticated(request);const body=await request.json();await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2',[body.endpoint,actor.id]);return Response.json({ok:true});}catch(e){return failure(e);}}
