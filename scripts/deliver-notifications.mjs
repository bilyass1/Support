import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { createHash,createDecipheriv } from 'node:crypto';
if(!process.env.DATABASE_URL||!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASSWORD||!process.env.BETTER_AUTH_SECRET)throw Error('Configure database and SMTP credentials before starting delivery');
const origin=new URL(process.env.BETTER_AUTH_URL).origin;
const port=Number(process.env.SMTP_PORT??587);if(![465,587].includes(port))throw Error('Use TLS SMTP on 465 or STARTTLS on 587');
const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port===587,
 auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,socketTimeout:15000});
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const pushEnabled=!!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY);
if(pushEnabled)webpush.setVapidDetails('mailto:contact@solumove.net',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
const allowedEndpoint=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}};
const send=(to,subject,text)=>transport.sendMail({from:'Solumove <contact@solumove.net>',to,subject,text,disableFileAccess:true,disableUrlAccess:true});
async function claim(table){return (await pool.query(`UPDATE ${table} SET attempts=attempts+1,available_at=now()+interval '5 minutes' WHERE id=(SELECT id FROM ${table} WHERE delivered_at IS NULL AND available_at<=now() AND attempts<5 ${table==='auth_email_jobs'?'AND expires_at>now()':''} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];}
try{
 await pool.query("DELETE FROM app_rate_limits WHERE bucket<$1",[Math.floor(Date.now()/60000)-1440]);
 await pool.query("DELETE FROM session_assurance WHERE verified_at<now()-interval '2 days'");
 await pool.query("DELETE FROM auth_email_jobs WHERE expires_at<now() OR delivered_at<now()-interval '1 day'");
 for(let i=0;i<20;i++){
  const job=await claim('auth_email_jobs');if(!job)break;
  try{const b=Buffer.from(job.payload,'base64'),cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(process.env.BETTER_AUTH_SECRET).digest(),b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));const mail=JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString());await send(mail.to,mail.subject,mail.text);await pool.query('UPDATE auth_email_jobs SET delivered_at=now(),payload=$2 WHERE id=$1',[job.id,'']);}
  catch{console.error('Auth email delivery failed; retry scheduled.');}
 }
 for(let i=0;i<20;i++){
  const job=await claim('notification_outbox');if(!job)break;
  try{const notification=(await pool.query('SELECT * FROM notifications WHERE id=$1',[job.notification_id])).rows[0];
   const users=(await pool.query(`SELECT DISTINCT u.id,u.email FROM "user" u WHERE u.id IN(SELECT user_id FROM memberships WHERE organization_id=$1 UNION SELECT user_id FROM app_roles WHERE role='admin')`,[notification.organization_id])).rows;
   for(const user of users){await send(user.email,'Nouvelle activité — Solumove',notification.message+'\n\nOuvrir votre espace : '+origin);
    if(pushEnabled){const subscriptions=(await pool.query('SELECT endpoint,subscription FROM push_subscriptions WHERE user_id=$1',[user.id])).rows;
     for(const row of subscriptions){if(!allowedEndpoint(row.endpoint))continue;try{await webpush.sendNotification(row.subscription,JSON.stringify({activity:true}),{TTL:3600,timeout:10000});}catch(e){if([404,410].includes(e.statusCode))await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2',[row.endpoint,user.id]);else throw e;}}
    }
   }
   await pool.query('UPDATE notification_outbox SET delivered_at=now() WHERE id=$1',[job.id]);
  }catch{console.error('Activity notification delivery failed; retry scheduled.');}
 }
}finally{await pool.end();transport.close();}
