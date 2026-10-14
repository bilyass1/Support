import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {betterAuth} from 'better-auth';
import {getMigrations} from 'better-auth/db/migration';
import {twoFactor} from 'better-auth/plugins/two-factor';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const harness=vi.hoisted(()=>({auth:null as unknown as {handler:(request:Request)=>Promise<Response>;api:{getSession:(input:{headers:Headers})=>Promise<unknown>}},db:null as unknown as PGlite}));
const query=async(sql:string,args:unknown[]=[])=>{const r=await harness.db.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length,command:sql.trim().split(/\s/)[0].toUpperCase()};};
vi.mock('../src/lib/db',()=>({pool:{query:async(sql:string,args:unknown[]=[])=>{const r=await harness.db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}}}));
vi.mock('../src/lib/auth',()=>({auth:{handler:(request:Request)=>harness.auth.handler(request),api:{getSession:(input:{headers:Headers})=>harness.auth.api.getSession(input)}}}));
import {POST} from '../src/app/api/auth/[...all]/route';
import {authenticated} from '../src/lib/request';
const cookies=new Map<string,string>();
async function call(path:string,body:unknown){const response=await POST(new Request('https://support.test/api/auth/'+path,{method:'POST',headers:{Origin:'https://support.test','Content-Type':'application/json',Cookie:Array.from(cookies).map(([k,v])=>k+'='+v).join('; ')},body:JSON.stringify(body)}));for(const value of response.headers.getSetCookie()){const part=value.split(';')[0],i=part.indexOf('=');cookies.set(part.slice(0,i),part.slice(i+1));}return response;}
function code(secret:string){let bits=0,value=0;const bytes:number[]=[];for(const c of secret.toUpperCase().replace(/=/g,'')){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=hash.at(-1)!&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
beforeAll(async()=>{
 vi.stubEnv('BETTER_AUTH_URL','https://support.test');harness.db=new PGlite();
 const db={connect:async()=>({query,release:()=>{}}),end:async()=>{}};
 const options={database:db as never,baseURL:'https://support.test',secret:'test-secret-at-least-thirty-two-characters',emailAndPassword:{enabled:true,minPasswordLength:12},rateLimit:{enabled:false},plugins:[twoFactor({issuer:'Solumove Support'})]};
 await (await getMigrations(options)).runMigrations();
 for(const name of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql','005_auth_email.sql','006_session_assurance.sql'])await harness.db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
 harness.auth=betterAuth(options);
});
afterAll(async()=>{vi.unstubAllEnvs();await harness.db.close();});
it('requires enrollment, validates TOTP, grants session assurance and challenges the next login',async()=>{
 const signup=await call('sign-up/email',{email:'client@cimeevents.com',password:'StrongPassword-12345',name:'Client'});expect(signup.status).toBe(200);
 const request=()=>new Request('https://support.test/api/mail',{headers:{Cookie:Array.from(cookies).map(([k,v])=>k+'='+v).join('; ')}});
 await expect(authenticated(request())).rejects.toThrow('authenticator');
 const enrollment=await call('two-factor/enable',{password:'StrongPassword-12345'});expect(enrollment.status).toBe(200);const data=await enrollment.json();
 const secret=new URL(data.totpURI).searchParams.get('secret')!;
 const bad=await call('two-factor/verify-totp',{code:'99999999',trustDevice:false});expect(bad.ok).toBe(false);
 const trusted=await call('two-factor/verify-totp',{code:code(secret),trustDevice:true});expect(trusted.status).toBe(403);
 const verified=await call('two-factor/verify-totp',{code:code(secret),trustDevice:false});expect(verified.status).toBe(200);
 expect((await authenticated(request())).id).toBeTruthy();
 expect((await call('two-factor/disable',{password:'StrongPassword-12345'})).status).toBe(403);
 await call('sign-out',{});cookies.clear();
 const signin=await call('sign-in/email',{email:'client@cimeevents.com',password:'StrongPassword-12345'});expect(signin.status).toBe(200);expect((await signin.json()).twoFactorRedirect).toBe(true);
 await expect(authenticated(request())).rejects.toThrow('Connectez-vous');
 const next=await call('two-factor/verify-totp',{code:code(secret),trustDevice:false});expect(next.status).toBe(200);expect((await authenticated(request())).id).toBeTruthy();
},30000);
