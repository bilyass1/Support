import { authenticated,sameOrigin,failure,jsonBody } from '@/lib/request';
import { DomainError } from '@/lib/domain';
import { pool } from '@/lib/db';
import { pushPublicKey,sendPush } from '@/lib/push';
import { pushSubscriptionSchema } from '@/lib/validation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const actor=await authenticated(request);
    const count=await pool.query('SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id=$1',[actor.id]);
    return Response.json({public_key:pushPublicKey(),devices:count.rows[0].count,required:process.env.FORCE_NOTIFICATIONS!=='false'});
  } catch(error) { return failure(error); }
}
export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const actor=await authenticated(request);
    const input=pushSubscriptionSchema.safeParse(await jsonBody(request,5000));
    if(!input.success) throw new DomainError('Abonnement aux notifications invalide.');
    const target={endpoint:input.data.endpoint,p256dh:input.data.keys.p256dh,auth:input.data.keys.auth};
    // A device belongs to the account that last signed in on it.
    await pool.query(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (endpoint) DO UPDATE SET user_id=$1,p256dh=$3,auth=$4,user_agent=$5`,
      [actor.id,target.endpoint,target.p256dh,target.auth,(request.headers.get('user-agent')??'').slice(0,300)]);
    if(new URL(request.url).searchParams.get('test')==='1') {
      await sendPush(target,{title:'Notifications activées',body:'Vous recevrez ici les nouveautés de vos demandes et factures.',url:'/'}).catch(()=>{});
    }
    return Response.json({ok:true});
  } catch(error) { return failure(error); }
}
export async function DELETE(request:Request) {
  try {
    sameOrigin(request);
    const actor=await authenticated(request);
    const body=await jsonBody(request,5000) as {endpoint?:unknown};
    await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2',[actor.id,String(body.endpoint??'')]);
    return Response.json({ok:true});
  } catch(error) { return failure(error); }
}
