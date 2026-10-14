import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { pool } from './db';
export async function queueAuthEmail(to:string,subject:string,text:string){
 const secret=process.env.BETTER_AUTH_SECRET;if(!secret)throw new Error('AuthEmailNotConfigured');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({to,subject,text}),'utf8'),cipher.final()]);
 const payload=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
 await pool.query("INSERT INTO auth_email_jobs(payload,expires_at) VALUES($1,now()+interval '30 minutes')",[payload]);
}
