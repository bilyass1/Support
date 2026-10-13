import { auth } from './auth';
import { getActor } from './service';
import { DomainError } from './domain';
export async function authenticated(request:Request) {
  const session=await auth.api.getSession({headers:request.headers});
  if(!session) throw new DomainError('Connectez-vous pour continuer.',401);
  return getActor(session.user.id,session.user.name);
}
export function sameOrigin(request:Request) {
  const expected=new URL(process.env.BETTER_AUTH_URL??request.url).origin;
  if(request.headers.get('origin')!==expected) throw new DomainError('Origine de la requête refusée.',403);
}
export function failure(error:unknown) {
  if(error instanceof DomainError) return Response.json({error:error.message},{status:error.status});
  console.error('Application request failed',error instanceof Error ? error.name : 'UnknownError');
  return Response.json({error:'Opération indisponible. Vérifiez la configuration du serveur.'},{status:500});
}
