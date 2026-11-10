import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import type {PoolClient} from 'pg';
const harness=vi.hoisted(()=>({db:null as unknown as PGlite}));
vi.mock('../src/lib/db',()=>({pool:{query:async(sql:string,args:unknown[]=[])=>{const r=await harness.db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}},transaction:async(fn:(c:PoolClient)=>Promise<unknown>)=>harness.db.transaction(async db=>fn({query:async(sql:string,args:unknown[]=[])=>{const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}} as PoolClient))}));
import {platformAct,platformSchema,platformWorkspace,recordUsage as record} from '../src/lib/platform';
// --- Modules per client, application usage and the admin 360° view ---
import {workspace as fullWorkspace,act as coreAct} from '../src/lib/service';
import {clientInsights,alerts as computeAlerts} from '../src/lib/insights';
import {actionSchema} from '../src/lib/validation';
import {userVerified} from '../src/lib/passkey-assurance';
describe('modules, usage tracking and client insights',()=>{
 const boss={id:'boss',name:'Boss',role:'admin' as const,organization_id:null};
 let org='',other='',member:{id:string;name:string;role:'client';organization_id:string},stranger:{id:string;name:string;role:'client';organization_id:string},app='';
 const q=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[])=>(await harness.db.query<T>(sql,args)).rows;
 beforeAll(async()=>{
  harness.db=new PGlite();
  await harness.db.exec(`CREATE TABLE "user"(id text PRIMARY KEY,name text,email text,"twoFactorEnabled" boolean);CREATE TABLE "passkey"(id text,"userId" text);
   CREATE TABLE "session"(id text,"userId" text,"updatedAt" timestamptz);CREATE TABLE "account"(id text,"providerId" text,"userId" text,password text);`);
  for(const name of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql','005_auth_email.sql','006_session_assurance.sql','007_client_onboarding.sql','008_modules_usage.sql','009_ticket_followup.sql','010_monitoring.sql'])await harness.db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
  org=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Modules One') RETURNING id"))[0].id;
  other=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Modules Two') RETURNING id"))[0].id;
  await q('INSERT INTO wallets(organization_id,balance) VALUES($1,50),($2,0)',[org,other]);
  await q(`INSERT INTO "user"(id,name,email,"twoFactorEnabled") VALUES('m1','Member','m1@example.com',true),('m2','Stranger','m2@example.com',false) ON CONFLICT DO NOTHING`);
  await q("INSERT INTO memberships(user_id,organization_id) VALUES('m1',$1),('m2',$2)",[org,other]);
  member={id:'m1',name:'Member',role:'client',organization_id:org};stranger={id:'m2',name:'Stranger',role:'client',organization_id:other};
  const plan=(await q<{id:string}>(`INSERT INTO plans(name,annual_tokens,price_minor,support_level) VALUES('P',100,1,'S') RETURNING id`))[0].id;
  await q(`INSERT INTO subscriptions(organization_id,plan_id,snapshot) VALUES($1,$2,'{"name":"P","annual_tokens":100,"rules":[]}')`,[org,plan]);
  app=(await q<{id:string}>("INSERT INTO applications(organization_id,name,kind) VALUES($1,'Shop','web') RETURNING id",[org]))[0].id;
 });
 afterAll(async()=>harness.db.close());
 const ticket=()=>coreAct(member,actionSchema.parse({type:'create_ticket',application_id:app,title:'New page',description:'We need a new landing page.',category:'design'}));
 it('hides data and refuses actions for every module the admin switched off',async()=>{
  await ticket();
  await platformAct(member,platformSchema.parse({type:'create_support',organization_id:org,title:'Question',body:'How do I reset my mailbox password?'}));
  expect((await fullWorkspace(member)).modules).toHaveLength(6);
  await expect(platformAct(member,platformSchema.parse({type:'set_modules',organization_id:org,modules:['billing']}))).rejects.toMatchObject({status:403});
  await platformAct(boss,platformSchema.parse({type:'set_modules',organization_id:org,modules:['billing']}));
  const view=await fullWorkspace(member),platform=await platformWorkspace(member);
  expect(view.modules).toEqual(['billing']);
  expect([view.tickets.length,view.ledger.length,view.comments.length,view.app_usage.length,platform.cases.length,platform.offers.length,platform.purchases.length]).toEqual([0,0,0,0,0,0,0]);
  await expect(ticket()).rejects.toMatchObject({status:403});
  await expect(platformAct(member,platformSchema.parse({type:'create_support',organization_id:org,title:'Again',body:'Still allowed to write here?'}))).rejects.toMatchObject({status:403});
  expect((await fullWorkspace(boss)).tickets.length).toBeGreaterThan(0);
  expect(platformSchema.safeParse({type:'set_modules',organization_id:org,modules:['everything']}).success).toBe(false);
  await platformAct(boss,platformSchema.parse({type:'set_modules',organization_id:org,modules:['tokens','billing','support','tickets','mail','usage']}));
 });
 it('counts sessions, errors and distinct users behind a key stored only as a hash',async()=>{
  await expect(platformAct(member,platformSchema.parse({type:'rotate_app_key',application_id:app}))).rejects.toMatchObject({status:403});
  const {key}=await platformAct(boss,platformSchema.parse({type:'rotate_app_key',application_id:app})) as {key:string};
  expect(await q('SELECT 1 FROM applications WHERE ingest_key_hash=$1',[key])).toHaveLength(0);
  await record(key,{event:'open',user:'u1',version:'2.0.1'});await record(key,{event:'open',user:'u1'});await record(key,{event:'open',user:'u2'});await record(key,{event:'error'});
  const view=await fullWorkspace(member);
  expect(view.app_usage[0]).toMatchObject({events:4,sessions:3,errors:1,users:2});
  expect(view.applications[0]).toMatchObject({tracked:true,last_version:'2.0.1'});
  expect(await q("SELECT 1 FROM app_usage_users WHERE user_hash IN('u1','u2')")).toHaveLength(0);
  expect((await fullWorkspace(stranger)).app_usage).toHaveLength(0);
  await expect(record('sf_unknown-key-unknown-key',{event:'open'})).rejects.toMatchObject({status:401});
  const next=await platformAct(boss,platformSchema.parse({type:'rotate_app_key',application_id:app})) as {key:string};
  await expect(record(key,{event:'open'})).rejects.toMatchObject({status:401});
  await record(next.key,{event:'open'});
 });
 it('gives the admin one view per client and nothing to clients',async()=>{
  await expect(clientInsights(member)).rejects.toMatchObject({status:403});
  const {clients,alerts}=await clientInsights(boss);
  const one=clients.find(c=>c.organization_id===org)!,two=clients.find(c=>c.organization_id===other)!;
  expect(one).toMatchObject({plan:'P',available:50,applications:1,applications_tracked:1,tickets_open:1,cases_open:1});
  expect(one.sessions_30d).toBeGreaterThanOrEqual(4);
  expect(one.users.map(u=>u.email)).toEqual(['m1@example.com']);
  expect(two.users[0]).toMatchObject({two_factor:false,devices:0,push_devices:0});
  expect(alerts.some(a=>a.organization_id===other&&a.message.includes('formule'))).toBe(true);
  expect(alerts.some(a=>a.organization_id===other&&a.message.includes('activation'))).toBe(true);
 });
 it('raises alerts for low tokens, overdue invoices, full mailboxes and silent applications',()=>{
  const base={organization_id:'o',name:'Client',plan:'P',ends_at:new Date(Date.now()+10*86_400_000).toISOString(),available:5,reserved:0,annual_tokens:100,modules:[],users:[],tickets_open:0,tickets_total:0,cases_open:0,purchases_pending:0,invoices_due:[],invoices_overdue:2,mailboxes:3,mail_quota_mb:300,mail_used_mb:290,mail_messages:9,mail_measured:3,mail_nearly_full:1,mail_last_activity:null,mail_synced_at:null,applications:1,applications_tracked:1,sessions_30d:0,app_last_seen:new Date(Date.now()-9*86_400_000).toISOString(),last_active:null};
  const messages=computeAlerts([base]).map(a=>a.message).join(' | ');
  for(const expected of ['renouveler dans 10','Il reste 5','2 facture(s) en retard','90 %','depuis 7 jours'])expect(messages).toContain(expected);
  expect(computeAlerts([base])[0].level).toBe('danger');
  expect(computeAlerts([{...base,available:80,invoices_overdue:0,mail_nearly_full:0,ends_at:new Date(Date.now()+200*86_400_000).toISOString(),app_last_seen:new Date().toISOString()}])).toEqual([]);
 });
 it('accepts a device sign-in only when the device verified its owner',()=>{
  const data=(flags:number)=>Buffer.concat([Buffer.alloc(32,1),Buffer.from([flags]),Buffer.alloc(4)]).toString('base64url');
  expect(userVerified(data(0x05))).toBe(true);   // present + verified (Face ID, fingerprint, device code)
  expect(userVerified(data(0x01))).toBe(false);  // present only: holding the device is not enough
  expect(userVerified(data(0x04))).toBe(false);
  for(const bad of [undefined,null,'',42,'short','*'.repeat(60),{}])expect(userVerified(bad)).toBe(false);
 });
});
