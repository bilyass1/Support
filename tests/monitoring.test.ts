import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
const harness=vi.hoisted(()=>({db:null as unknown as import('@electric-sql/pglite').PGlite}));
const result=(r:{rows:unknown[];affectedRows?:number})=>({rows:r.rows,rowCount:r.rows.length||r.affectedRows||0});
vi.mock('../src/lib/db',()=>({
 pool:{query:async(sql:string,args:unknown[]=[])=>result(await harness.db.query(sql,args))},
 transaction:async(fn:(c:PoolClient)=>Promise<unknown>)=>harness.db.transaction(async db=>fn({query:async(sql:string,args:unknown[]=[])=>result(await db.query(sql,args))} as unknown as PoolClient))
}));
import {workspace,type Actor} from '../src/lib/service';
import {platformAct,platformSchema} from '../src/lib/platform';
import {companyStats} from '../src/lib/insights';
import {monitorUrl,privateAddress,runMonitor,runReminders} from '../src/lib/monitor.mjs';
describe('site monitoring, reminders and company figures',()=>{
 const boss:Actor={id:'boss',name:'Boss',role:'admin',organization_id:null};
 let member:Actor,stranger:Actor,org='',other='';
 const db={query:async(sql:string,args:unknown[]=[])=>({rows:(await harness.db.query(sql,args)).rows as Record<string,unknown>[]})};
 const q=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[])=>(await harness.db.query<T>(sql,args)).rows;
 const act=(actor:Actor,input:unknown)=>platformAct(actor,platformSchema.parse(input));
 beforeAll(async()=>{
  harness.db=new PGlite();
  await harness.db.exec(`CREATE TABLE "user"(id text PRIMARY KEY,name text,email text,"twoFactorEnabled" boolean);CREATE TABLE "passkey"(id text,"userId" text);
   CREATE TABLE "session"(id text,"userId" text,"updatedAt" timestamptz);CREATE TABLE "account"(id text,"providerId" text,"userId" text,password text);`);
  for(const name of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql','005_auth_email.sql','006_session_assurance.sql','007_client_onboarding.sql','008_modules_usage.sql','009_ticket_followup.sql','010_monitoring.sql','011_mail_logins.sql'])await harness.db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
  org=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Mon One') RETURNING id"))[0].id;
  other=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Mon Two') RETURNING id"))[0].id;
  await q('INSERT INTO wallets(organization_id,balance) VALUES($1,10),($2,0)',[org,other]);
  await q(`INSERT INTO "user"(id,name,email) VALUES('boss','Boss','boss@example.com'),('m1','Member','m1@example.com'),('m2','Stranger','m2@example.com')`);
  await q("INSERT INTO app_roles(user_id,role) VALUES('boss','admin')");
  await q("INSERT INTO memberships(user_id,organization_id) VALUES('m1',$1),('m2',$2)",[org,other]);
  member={id:'m1',name:'Member',role:'client',organization_id:org};stranger={id:'m2',name:'Stranger',role:'client',organization_id:other};
 });
 afterAll(async()=>harness.db.close());
 it('refuses addresses that would make the server probe its own network',()=>{
  for(const address of ['127.0.0.1','10.1.2.3','172.16.0.9','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:10.0.0.1'])expect(privateAddress(address),address).toBe(true);
  for(const address of ['41.226.11.10','102.211.210.97','2001:4860:4860::8888'])expect(privateAddress(address),address).toBe(false);
  expect(monitorUrl('https://www.cimeevents.com/')).toBe('https://www.cimeevents.com/');
  for(const url of ['ftp://example.tn','https://127.0.0.1/','http://localhost/','https://user:pass@example.tn/','https://example.tn:8443/','https://[::1]/','javascript:alert(1)','not a url'])expect(monitorUrl(url),url).toBeNull();
 });
 it('lets only the admin add a site, and shows each client only its own',async()=>{
  await expect(act(member,{type:'save_site',organization_id:org,label:'Mine',url:'https://client.example.tn'})).rejects.toMatchObject({status:403});
  await expect(act(boss,{type:'save_site',organization_id:org,label:'Internal',url:'https://192.168.1.10/'})).rejects.toMatchObject({status:400});
  await act(boss,{type:'save_site',organization_id:org,label:'Site vitrine',url:'https://www.example.tn',domain_expires_at:null});
  await act(boss,{type:'save_site',organization_id:other,label:'Boutique',url:'https://shop.example.tn'});
  await expect(act(boss,{type:'save_site',organization_id:org,label:'Again',url:'https://www.example.tn'})).rejects.toMatchObject({status:409});
  expect(((await workspace(member)).sites as {label:string}[]).map(s=>s.label)).toEqual(['Site vitrine']);
  expect(((await workspace(stranger)).sites as {label:string}[]).map(s=>s.label)).toEqual(['Boutique']);
  expect((await workspace(boss)).sites).toHaveLength(2);
  await act(boss,{type:'set_modules',organization_id:org,modules:['tickets']});
  expect((await workspace(member)).sites).toHaveLength(0);
  await act(boss,{type:'set_modules',organization_id:org,modules:['tickets','usage','billing','tokens','support','mail']});
 });
 it('declares a site down after two failures in a row, notifies once, and announces recovery',async()=>{
  const state:Record<string,boolean>={'https://www.example.tn/':true,'https://shop.example.tn/':true};
  const check=async(url:string)=>state[url]?{ok:true,error:null,latency_ms:120,ssl_expires_at:new Date(Date.now()+60*86_400_000).toISOString()}:{ok:false,error:'ETIMEDOUT',latency_ms:10000,ssl_expires_at:null};
  const status=async()=>(await q<{status:string}>("SELECT status FROM monitored_sites WHERE label='Site vitrine'"))[0].status;
  const notices=async(pattern:string)=>(await q('SELECT 1 FROM notifications WHERE organization_id=$1 AND message LIKE $2',[org,pattern])).length;
  await runMonitor(db,check);expect(await status()).toBe('up');
  state['https://www.example.tn/']=false;
  await runMonitor(db,check);expect(await status()).toBe('up');expect(await notices('Site indisponible%')).toBe(0);
  expect(await runMonitor(db,check)).toMatchObject({checked:2,down:1,changed:1});expect(await status()).toBe('down');expect(await notices('Site indisponible%')).toBe(1);
  await runMonitor(db,check);expect(await notices('Site indisponible%')).toBe(1);
  state['https://www.example.tn/']=true;
  await runMonitor(db,check);expect(await status()).toBe('up');expect(await notices('Site rétabli%')).toBe(1);
  const site=((await workspace(member)).sites as {checks:number;failures:number;ssl_expires_at:string|null}[])[0];
  expect(site).toMatchObject({checks:5,failures:3});expect(site.ssl_expires_at).not.toBeNull();
  expect((await q('SELECT 1 FROM notifications WHERE organization_id=$1 AND message LIKE $2',[other,'Site %']))).toHaveLength(0);
 });
 it('sends each renewal, domain, certificate and overdue-invoice reminder exactly once',async()=>{
  const plan=(await q<{id:string}>(`INSERT INTO plans(name,annual_tokens,price_minor,support_level) VALUES('R',10,1,'S') RETURNING id`))[0].id;
  await q(`INSERT INTO subscriptions(organization_id,plan_id,snapshot,ends_at) VALUES($1,$2,'{"name":"R","annual_tokens":10,"rules":[]}',now()+interval '20 days')`,[org,plan]);
  await q("UPDATE monitored_sites SET domain_expires_at=current_date+5,ssl_expires_at=now()+interval '10 days' WHERE label='Site vitrine'");
  await q(`INSERT INTO invoices(number,organization_id,description,amount_minor,currency,issuer,client_name,due_at,created_by) VALUES('INV-R1',$1,'Late',1000,'TND','{}','Mon One',current_date-3,'boss')`,[org]);
  expect((await runReminders(db)).sent).toBe(4);
  expect((await runReminders(db)).sent).toBe(0);
  const messages=(await q<{message:string}>("SELECT message FROM notifications WHERE organization_id=$1 AND (message LIKE 'Rappel%' OR message LIKE 'Certificat%')",[org])).map(r=>r.message).join('\n');
  for(const part of ['formule R','nom de domaine de Site vitrine','Certificat SSL','facture INV-R1'])expect(messages).toContain(part);
  // Entering the seven-day window is a new reminder; staying in it is not.
  await q("UPDATE subscriptions SET ends_at=now()+interval '6 days' WHERE organization_id=$1",[org]);
  expect((await runReminders(db)).sent).toBe(1);expect((await runReminders(db)).sent).toBe(0);
 });
 it('gives the admin six months of figures and refuses everyone else',async()=>{
  await expect(companyStats(member)).rejects.toMatchObject({status:403});
  await q(`INSERT INTO invoices(number,organization_id,description,amount_minor,currency,status,issuer,client_name,due_at,created_by) VALUES('INV-P1',$1,'Paid',250000,'TND','paid','{}','Mon One',current_date,'boss')`,[org]);
  const stats=await companyStats(boss);
  expect(stats.months).toHaveLength(6);
  const tnd=stats.revenue.find(r=>r.currency==='TND')!;
  expect(tnd.paid[5]).toBe(250000);expect(tnd.paid.slice(0,5).every(v=>v===0)).toBe(true);
  expect(stats.unpaid).toEqual([{currency:'TND',total:1000,count:1,overdue:1}]);
  expect(stats.sites).toEqual({total:2,down:0});
  expect(stats.tickets_created).toHaveLength(6);
 });
});
