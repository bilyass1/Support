import { needsPassword } from '@/lib/client-accounts';
import { auth } from '@/lib/auth';
import { pool } from '@/lib/db';
import { toNextJsHandler } from 'better-auth/next-js';
import { userVerified } from '@/lib/passkey-assurance';
import { deliverAfterResponse } from '@/lib/deliver-now';
const handlers=toNextJsHandler(auth);
export const runtime='nodejs';
const refuse=(message:string,status:number)=>Response.json({message},{status});
/** The session as it stands once the cookies set by `response` are applied to the request. */
async function sessionAfter(request:Request,response:Response){
 const cookies=new Map((request.headers.get('cookie')??'').split(';').filter(Boolean).map(value=>{const i=value.indexOf('=');return [value.slice(0,i).trim(),value.slice(i+1)] as [string,string];}));
 for(const value of response.headers.getSetCookie()){const entry=value.split(';')[0],i=entry.indexOf('=');cookies.set(entry.slice(0,i),entry.slice(i+1));}
 const headers=new Headers(request.headers);headers.set('cookie',Array.from(cookies).map(([key,value])=>key+'='+value).join('; '));
 return auth.api.getSession({headers});
}
/** Devices are registered, renamed or removed only from a session that already passed the authenticator. */
async function assured(request:Request){
 const session=await auth.api.getSession({headers:request.headers});
 if(!session||!session.user.twoFactorEnabled||await needsPassword(session.user.id))return false;
 return Boolean((await pool.query("SELECT 1 FROM session_assurance WHERE session_id=$1 AND user_id=$2 AND verified_at>now()-interval '1 day'",[session.session.id,session.user.id])).rowCount);
}
const deviceManagement=['/passkey/generate-register-options','/passkey/verify-registration','/passkey/delete-passkey','/passkey/update-passkey','/passkey/list-user-passkeys'];
export async function GET(request:Request){
 const path=new URL(request.url).pathname;
 if(deviceManagement.some(p=>path.endsWith(p))&&!await assured(request))return refuse('Vérifiez votre authenticator avant de gérer vos appareils.',428);
 return handlers.GET(request);
}
export async function POST(request:Request){
 const raw=await request.clone().text();if(raw.length>20000)return refuse('Requête trop volumineuse.',413);
 const path=new URL(request.url).pathname;
 if(path.endsWith('/sign-up/email'))return refuse('Les comptes clients sont créés par votre administrateur.',403);
 const sessionBefore=await auth.api.getSession({headers:request.headers});
 if(sessionBefore&&await needsPassword(sessionBefore.user.id)){
  const allowed=['/change-password','/sign-out','/sign-in/email','/request-password-reset','/reset-password'];
  if(!allowed.some(p=>path.endsWith(p)))return refuse('Remplacez votre mot de passe temporaire avant de continuer.',428);
  if(path.endsWith('/change-password')){const body=await request.clone().json().catch(()=>null);if(!body||body.currentPassword===body.newPassword)return refuse('Choisissez un nouveau mot de passe différent.',400);}
 }
 if(path.endsWith('/two-factor/disable') || path.endsWith('/two-factor/send-otp') || path.endsWith('/two-factor/verify-otp')) return refuse('Authenticator obligatoire. Contactez l’admin pour une récupération vérifiée.',403);
 if(path.endsWith('/two-factor/verify-totp') || path.endsWith('/two-factor/verify-backup-code')){
  const body=await request.clone().json().catch(()=>null);
  if(body?.trustDevice===true) return refuse('Un code est requis à chaque connexion.',403);
 }
 if(deviceManagement.some(p=>path.endsWith(p))&&!await assured(request))return refuse('Vérifiez votre authenticator avant de gérer vos appareils.',428);
 const passkeySignIn=path.endsWith('/passkey/verify-authentication');
 if(passkeySignIn){
  // The library does not require user verification itself. Without it, holding the device would be enough.
  const body=await request.clone().json().catch(()=>null);
  if(!userVerified(body?.response?.response?.authenticatorData))return refuse('Déverrouillez votre appareil (Face ID, empreinte ou code) pour vous connecter.',403);
 }
 const response=await handlers.POST(request);
 if(path.endsWith('/request-password-reset'))deliverAfterResponse();
 if(response.ok&&(passkeySignIn||path.endsWith('/two-factor/verify-totp')||path.endsWith('/two-factor/verify-backup-code'))){
  const session=await sessionAfter(request,response);
  // A device only stands in for the code on an account whose authenticator is set up.
  if(!session?.user.twoFactorEnabled)return passkeySignIn?response:refuse('Vérification incomplète.',403);
  if(passkeySignIn&&await needsPassword(session.user.id))return response;
  await pool.query('INSERT INTO session_assurance(session_id,user_id) VALUES($1,$2) ON CONFLICT(session_id) DO UPDATE SET verified_at=now()',[session.session.id,session.user.id]);
 }
 return response;
}
