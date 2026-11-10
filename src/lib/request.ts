import { auth, twoFactorRequired } from './auth';
import { getActor } from './service';
import { DomainError } from './domain';
export async function authenticated(request:Request) {
  const session=await auth.api.getSession({headers:request.headers});
  if(!session) throw new DomainError('Connectez-vous pour continuer.',401);
  // No data is served until the account is protected by a second factor.
  if(twoFactorRequired() && !(session.user as {twoFactorEnabled?:boolean|null}).twoFactorEnabled) {
    throw new DomainError('Activez la double authentification pour accéder à votre espace.',403,'two_factor_required');
  }
  return getActor(session.user.id,session.user.name);
}
export function sameOrigin(request:Request) {
  const expected=new URL(process.env.BETTER_AUTH_URL??request.url).origin;
  if(request.headers.get('origin')!==expected) throw new DomainError('Origine de la requête refusée.',403);
}
export async function jsonBody(request:Request,limit=20000):Promise<unknown> {
  const raw=await request.text();
  if(raw.length>limit) throw new DomainError('Requête trop volumineuse.',413);
  try { return JSON.parse(raw); } catch { throw new DomainError('JSON invalide.'); }
}
export function failure(error:unknown) {
  if(error instanceof DomainError) return Response.json({error:error.message,code:error.code},{status:error.status});
  console.error('Application request failed',error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error:'Opération indisponible. Vérifiez la configuration du serveur.'},{status:500});
}
