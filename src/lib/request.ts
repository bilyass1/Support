import { auth } from './auth';
import { getActor } from './service';
import { DomainError } from './domain';
import { pool } from './db';
export async function authenticated(request:Request) {
  const session=await auth.api.getSession({headers:request.headers});
  if(!session) throw new DomainError('Connectez-vous pour continuer.',401);
  if(!session.user.twoFactorEnabled) throw new DomainError('Activez votre authenticator pour accéder à votre espace.',428);
  const assurance=await pool.query("SELECT 1 FROM session_assurance WHERE session_id=$1 AND user_id=$2 AND verified_at>now()-interval '1 day'",[session.session.id,session.user.id]);
  if(!assurance.rowCount)throw new DomainError('Vérifiez votre authenticator pour cette session.',428);
  const rate=await pool.query('INSERT INTO app_rate_limits(user_id,bucket,count) VALUES($1,$2,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=app_rate_limits.count+1 RETURNING count',[session.user.id,Math.floor(Date.now()/60000)]);
  if(rate.rows[0].count>120)throw new DomainError('Trop de requêtes. Réessayez dans une minute.',429);
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

