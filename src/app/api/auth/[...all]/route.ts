import { needsPassword } from '@/lib/client-accounts';
import { auth } from '@/lib/auth';
import { pool } from '@/lib/db';
import { toNextJsHandler } from 'better-auth/next-js';
const handlers=toNextJsHandler(auth);
export const GET=handlers.GET;
export const runtime='nodejs';
export async function POST(request:Request){
 const raw=await request.clone().text();if(raw.length>20000)return Response.json({message:'Requête trop volumineuse.'},{status:413});
 const path=new URL(request.url).pathname;
 if(path.endsWith('/sign-up/email'))return Response.json({message:'Les comptes clients sont créés par votre administrateur.'},{status:403});
 const sessionBefore=await auth.api.getSession({headers:request.headers});
 if(sessionBefore&&await needsPassword(sessionBefore.user.id)){
  const allowed=['/change-password','/sign-out','/sign-in/email','/request-password-reset','/reset-password'];
  if(!allowed.some(p=>path.endsWith(p)))return Response.json({message:'Remplacez votre mot de passe temporaire avant de continuer.'},{status:428});
  if(path.endsWith('/change-password')){const body=await request.clone().json().catch(()=>null);if(!body||body.currentPassword===body.newPassword)return Response.json({message:'Choisissez un nouveau mot de passe différent.'},{status:400});}
 }
 if(path.endsWith('/two-factor/disable') || path.endsWith('/two-factor/send-otp') || path.endsWith('/two-factor/verify-otp')) return Response.json({message:'Authenticator obligatoire. Contactez l’admin pour une récupération vérifiée.'},{status:403});
 if(path.endsWith('/two-factor/verify-totp') || path.endsWith('/two-factor/verify-backup-code')){
  const body=await request.clone().json().catch(()=>null);
  if(body?.trustDevice===true) return Response.json({message:'Un code est requis à chaque connexion.'},{status:403});
 }
 const response=await handlers.POST(request);
 if(response.ok&&(path.endsWith('/two-factor/verify-totp')||path.endsWith('/two-factor/verify-backup-code'))){
  const cookies=new Map((request.headers.get('cookie')??'').split(';').filter(Boolean).map(value=>{const i=value.indexOf('=');return [value.slice(0,i).trim(),value.slice(i+1)] as [string,string];}));
  for(const value of response.headers.getSetCookie()){const entry=value.split(';')[0],i=entry.indexOf('=');cookies.set(entry.slice(0,i),entry.slice(i+1));}
  const headers=new Headers(request.headers);headers.set('cookie',Array.from(cookies).map(([key,value])=>key+'='+value).join('; '));
  const session=await auth.api.getSession({headers});
  if(!session?.user.twoFactorEnabled)return Response.json({message:'Vérification incomplète.'},{status:403});
  await pool.query('INSERT INTO session_assurance(session_id,user_id) VALUES($1,$2) ON CONFLICT(session_id) DO UPDATE SET verified_at=now()',[session.session.id,session.user.id]);
 }
 return response;
}
