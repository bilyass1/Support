import { auth } from '@/lib/auth';
import { authenticated, failure, sameOrigin } from '@/lib/request';
import { platformAct, platformSchema, platformWorkspace } from '@/lib/platform';
export const runtime='nodejs';
export async function GET(request:Request){try{return Response.json(await platformWorkspace(await authenticated(request)));}catch(error){return failure(error);}}
export async function POST(request:Request){try{sameOrigin(request);const actor=await authenticated(request);const raw=await request.text();if(raw.length>20000)return Response.json({error:'Requête trop volumineuse.'},{status:413});const parsed=platformSchema.safeParse(JSON.parse(raw));if(!parsed.success)return Response.json({error:'Vérifiez les champs du formulaire.'},{status:400});if(parsed.data.type==='reset_mfa'){const verified=await auth.api.verifyPassword({body:{password:parsed.data.admin_password},headers:request.headers});if(!verified.status)return Response.json({error:'Mot de passe admin refusé.'},{status:403});}
return Response.json(await platformAct(actor,parsed.data));}catch(error){return failure(error);}}
