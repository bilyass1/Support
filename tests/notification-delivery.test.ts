import {expect,it,vi} from 'vitest';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
const harness=vi.hoisted(()=>({query:vi.fn(),send:vi.fn(),end:vi.fn(),close:vi.fn()}));
vi.mock('pg',()=>({Pool:class {query=harness.query;end=harness.end;}}));
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:harness.send,close:harness.close})}}));
it('delivers queued password recovery with administration as the From address',async()=>{
 const secret='delivery-test-only-secret-12345678901234567890',iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
 const mail={to:'client@example.com',subject:'Réinitialiser votre mot de passe',text:'https://support.example/reset-password?token=test-only'};
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(mail)),cipher.final()]);const payload=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
 let claimed=false;
 harness.query.mockImplementation(async(sql:string)=>{
  if(sql.startsWith('UPDATE auth_email_jobs SET attempts')&&!claimed){claimed=true;return {rows:[{id:'job-test',payload}]};}
  return {rows:[],rowCount:1};
 });
 for(const [name,value] of Object.entries({DATABASE_URL:'postgres://not-used/test',SMTP_HOST:'mail.example',SMTP_USER:'test',SMTP_PASSWORD:'test-only',BETTER_AUTH_SECRET:secret,BETTER_AUTH_URL:'https://support.example',VAPID_PUBLIC_KEY:'',VAPID_PRIVATE_KEY:''}))vi.stubEnv(name,value);
 try{
  await import('../scripts/deliver-notifications.mjs');
  expect(harness.send).toHaveBeenCalledExactlyOnceWith({...mail,from:{name:'Solumove',address:'administration@solumove.net'},disableFileAccess:true,disableUrlAccess:true});
  expect(harness.query).toHaveBeenCalledWith('UPDATE auth_email_jobs SET delivered_at=now(),payload=$2 WHERE id=$1',['job-test','']);
  expect(harness.end).toHaveBeenCalledOnce();
 }finally{vi.unstubAllEnvs();}
});
