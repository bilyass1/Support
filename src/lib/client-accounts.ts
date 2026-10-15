import {randomUUID} from 'node:crypto';
import {hashPassword} from 'better-auth/crypto';
import {z} from 'zod';
import {transaction,pool} from './db';
import {DomainError} from './domain';
import type {Actor} from './service';
import {hostname} from './mail-validation';
export const clientProfile={name:z.string().trim().min(2).max(120),tax_id:z.string().trim().min(3).max(80),billing_address:z.string().trim().min(5).max(1000),contact_name:z.string().trim().min(2).max(120),contact_email:z.email().trim().toLowerCase(),phone:z.string().trim().min(3).max(40),primary_domain:z.union([hostname,z.literal('')])};
export const createClientSchema=z.object({...clientProfile,temporary_password:z.string().min(12).max(128).refine(v=>!/[\r\n\u0000]/.test(v))});
export const updateClientSchema=z.object({id:z.uuid(),...clientProfile});
export async function needsPassword(userId:string){return Boolean((await pool.query('SELECT needs_password FROM client_onboarding WHERE user_id=$1',[userId])).rows[0]?.needs_password);}
export async function createClient(actor:Actor,input:z.infer<typeof createClientSchema>){
 if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);
 const password=await hashPassword(input.temporary_password);
 return transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.contact_email]);
  if((await c.query('SELECT id FROM "user" WHERE lower(email)=lower($1)',[input.contact_email])).rowCount)throw new DomainError('Cet e-mail possède déjà un compte. Utilisez l’association d’un compte existant.',409);
  const userId=randomUUID();
  await c.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","twoFactorEnabled") VALUES($1,$2,$3,false,now(),now(),false)',[userId,input.contact_name,input.contact_email]);
  await c.query('INSERT INTO "account"(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',[randomUUID(),userId,password]);
  const org=(await c.query('INSERT INTO organizations(name,tax_id,billing_address,contact_name,contact_email,phone,primary_domain) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[input.name,input.tax_id,input.billing_address,input.contact_name,input.contact_email,input.phone,input.primary_domain])).rows[0].id;
  await c.query('INSERT INTO memberships(user_id,organization_id) VALUES($1,$2)',[userId,org]);
  await c.query('INSERT INTO wallets(organization_id) VALUES($1)',[org]);
  await c.query('INSERT INTO client_onboarding(user_id,created_by) VALUES($1,$2)',[userId,actor.id]);
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES($1,\'create_client_account\',$2,$3)',[actor.id,org,JSON.stringify({user_id:userId})]);
  return {id:org,message:'Client créé. Transmettez le mot de passe temporaire par un canal privé. Il devra le remplacer puis activer son authenticator.'};
 });
}
export async function updateClient(actor:Actor,input:z.infer<typeof updateClientSchema>){
 if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);
 return transaction(async c=>{
  const r=await c.query('UPDATE organizations SET name=$2,tax_id=$3,billing_address=$4,contact_name=$5,contact_email=$6,phone=$7,primary_domain=$8 WHERE id=$1 RETURNING id',[input.id,input.name,input.tax_id,input.billing_address,input.contact_name,input.contact_email,input.phone,input.primary_domain]);
  if(!r.rowCount)throw new DomainError('Client introuvable.',404);
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES($1,\'update_client_profile\',$2,\'{}\')',[actor.id,input.id]);
  return {message:'Coordonnées client mises à jour. L’identifiant de connexion reste inchangé.'};
 });
}
export const reissueClientSchema=z.object({user_id:z.string().min(1).max(200),temporary_password:z.string().min(12).max(128).refine(v=>!/[\r\n\u0000]/.test(v)),reason:z.string().trim().min(15).max(1000),identity_verified:z.literal(true),admin_password:z.string().min(1).max(128)});
export async function reissueClient(actor:Actor,input:z.infer<typeof reissueClientSchema>){
 if(actor.role!=='admin')throw new DomainError('Action réservée à l’admin.',403);
 const password=await hashPassword(input.temporary_password);
 return transaction(async c=>{
  if((await c.query('SELECT user_id FROM app_roles WHERE user_id=$1',[input.user_id])).rowCount||input.user_id===actor.id)throw new DomainError('Ce parcours est réservé aux comptes clients.',403);
  const member=(await c.query('SELECT organization_id FROM memberships WHERE user_id=$1',[input.user_id])).rows[0];if(!member)throw new DomainError('Compte client introuvable.',404);
  await c.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE',[input.user_id]);
  const result=await c.query('UPDATE "account" SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\' RETURNING id',[input.user_id,password]);if(!result.rowCount)throw new DomainError('Compte sans mot de passe local.',409);
  await c.query('INSERT INTO client_onboarding(user_id,created_by) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET needs_password=true,completed_at=NULL,created_by=excluded.created_by,created_at=now()',[input.user_id,actor.id]);
  await c.query('DELETE FROM "session" WHERE "userId"=$1',[input.user_id]);
  await c.query('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES($1,\'reissue_client_access\',$2,$3)',[actor.id,input.user_id,JSON.stringify({reason:input.reason,identity_verified:true})]);
  await c.query('INSERT INTO notifications(organization_id,message) VALUES($1,\'Votre accès a été réinitialisé par l’administrateur. Choisissez un nouveau mot de passe à la connexion.\')',[member.organization_id]);
  return {message:'Mot de passe temporaire réémis et sessions révoquées. L’authenticator existant est conservé.'};
 });
}
