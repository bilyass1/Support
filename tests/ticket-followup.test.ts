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
import {act,workspace,type Actor} from '../src/lib/service';
import {actionSchema} from '../src/lib/validation';
import {slaBreached} from '../src/lib/domain';
describe('ticket follow-up, renewals and announcements',()=>{
 const boss:Actor={id:'boss',name:'Boss',role:'admin',organization_id:null};
 let member:Actor,stranger:Actor,org='',other='',app='';
 const q=async<T=Record<string,unknown>>(sql:string,args:unknown[]=[])=>(await harness.db.query<T>(sql,args)).rows;
 const run=(actor:Actor,input:unknown)=>act(actor,actionSchema.parse(input));
 beforeAll(async()=>{
  harness.db=new PGlite();
  await harness.db.exec(`CREATE TABLE "user"(id text PRIMARY KEY,name text,email text,"twoFactorEnabled" boolean);CREATE TABLE "passkey"(id text,"userId" text);
   CREATE TABLE "session"(id text,"userId" text,"updatedAt" timestamptz);CREATE TABLE "account"(id text,"providerId" text,"userId" text,password text);`);
  for(const name of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql','005_auth_email.sql','006_session_assurance.sql','007_client_onboarding.sql','008_modules_usage.sql','009_ticket_followup.sql','010_monitoring.sql','011_mail_logins.sql'])await harness.db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
  org=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Follow One') RETURNING id"))[0].id;
  other=(await q<{id:string}>("INSERT INTO organizations(name) VALUES('Follow Two') RETURNING id"))[0].id;
  await q('INSERT INTO wallets(organization_id,balance) VALUES($1,100),($2,0)',[org,other]);
  await q(`INSERT INTO "user"(id,name,email) VALUES('boss','Boss','boss@example.com'),('f1','Member','f1@example.com'),('f2','Stranger','f2@example.com')`);
  await q("INSERT INTO app_roles(user_id,role) VALUES('boss','admin')");
  await q("INSERT INTO memberships(user_id,organization_id) VALUES('f1',$1),('f2',$2)",[org,other]);
  member={id:'f1',name:'Member',role:'client',organization_id:org};stranger={id:'f2',name:'Stranger',role:'client',organization_id:other};
  const plan=(await q<{id:string}>(`INSERT INTO plans(name,annual_tokens,price_minor,support_level) VALUES('P',100,1,'S') RETURNING id`))[0].id;
  await q(`INSERT INTO subscriptions(organization_id,plan_id,snapshot) VALUES($1,$2,'{"name":"P","annual_tokens":100,"rules":[]}')`,[org,plan]);
  app=(await q<{id:string}>("INSERT INTO applications(organization_id,name,kind) VALUES($1,'Shop','web') RETURNING id",[org]))[0].id;
 });
 afterAll(async()=>harness.db.close());
 const ticket=(priority?:string)=>run(member,{type:'create_ticket',application_id:app,title:'Fix checkout',description:'The checkout page fails on mobile.',category:'bug',priority}) as Promise<{id:string}>;
 it('stores the priority chosen by the client and lets only the team change it',async()=>{
  const urgent=await ticket('urgent'),plain=await ticket();
  const rows=(await workspace(boss)).tickets as {id:string;priority:string}[];
  expect(rows.find(t=>t.id===urgent.id)?.priority).toBe('urgent');
  expect(rows.find(t=>t.id===plain.id)?.priority).toBe('normal');
  await expect(run(member,{type:'set_priority',ticket_id:urgent.id,priority:'low'})).rejects.toMatchObject({status:403});
  await run(boss,{type:'set_priority',ticket_id:urgent.id,priority:'high'});
  expect(((await workspace(member)).tickets as {id:string;priority:string}[]).find(t=>t.id===urgent.id)?.priority).toBe('high');
  expect(actionSchema.safeParse({type:'set_priority',ticket_id:urgent.id,priority:'critical'}).success).toBe(false);
 });
 it('keeps internal notes inside the team, without notifying the client',async()=>{
  const created=await ticket();
  const before=(await q('SELECT 1 FROM notifications WHERE organization_id=$1',[org])).length;
  await run(boss,{type:'comment',ticket_id:created.id,body:'Margin is thin on this one',internal:true});
  expect((await q('SELECT 1 FROM notifications WHERE organization_id=$1',[org])).length).toBe(before);
  expect(((await workspace(member)).comments as {ticket_id:string}[]).filter(c=>c.ticket_id===created.id)).toHaveLength(0);
  expect(((await workspace(boss)).comments as {ticket_id:string;internal:boolean}[]).filter(c=>c.ticket_id===created.id&&c.internal)).toHaveLength(1);
  await expect(run(member,{type:'comment',ticket_id:created.id,body:'sneaky',internal:true})).rejects.toMatchObject({status:403});
  expect((await q<{first_response_at:Date|null}>('SELECT first_response_at FROM tickets WHERE id=$1',[created.id]))[0].first_response_at).toBeNull();
  await run(boss,{type:'comment',ticket_id:created.id,body:'We are on it'});
  expect((await q<{first_response_at:Date|null}>('SELECT first_response_at FROM tickets WHERE id=$1',[created.id]))[0].first_response_at).not.toBeNull();
  const visible=((await workspace(member)).comments as {ticket_id:string;from_staff:boolean}[]).filter(c=>c.ticket_id===created.id);
  expect(visible).toHaveLength(1);expect(visible[0].from_staff).toBe(true);
 });
 it('measures the first-response delay by priority',()=>{
  const created=new Date('2026-01-01T00:00:00Z'),hours=(n:number)=>created.getTime()+n*3_600_000;
  expect(slaBreached({priority:'urgent',created_at:created,first_response_at:null,status:'new'},hours(5))).toBe(true);
  expect(slaBreached({priority:'normal',created_at:created,first_response_at:null,status:'new'},hours(5))).toBe(false);
  expect(slaBreached({priority:'urgent',created_at:created,first_response_at:new Date(hours(1)),status:'quoted'},hours(500))).toBe(false);
  expect(slaBreached({priority:'urgent',created_at:created,first_response_at:null,status:'cancelled'},hours(500))).toBe(false);
 });
 it('accepts a satisfaction rating only from the client, once the ticket is closed',async()=>{
  const created=await ticket();
  await expect(run(member,{type:'rate',ticket_id:created.id,rating:5})).rejects.toMatchObject({status:409});
  await run(boss,{type:'quote',ticket_id:created.id,tokens:5,note:'Half a day'});
  await run(member,{type:'accept',ticket_id:created.id,estimate_revision:1});
  await run(boss,{type:'move',ticket_id:created.id,status:'in_progress'});await run(boss,{type:'move',ticket_id:created.id,status:'ready'});
  await run(member,{type:'move',ticket_id:created.id,status:'closed'});
  await expect(run(boss,{type:'rate',ticket_id:created.id,rating:5})).rejects.toMatchObject({status:403});
  await expect(run(stranger,{type:'rate',ticket_id:created.id,rating:1})).rejects.toMatchObject({status:403});
  await run(member,{type:'rate',ticket_id:created.id,rating:4,comment:'Quick fix'});
  const row=(await q<{rating:number;rating_comment:string;closed_at:Date|null}>('SELECT rating,rating_comment,closed_at FROM tickets WHERE id=$1',[created.id]))[0];
  expect(row).toMatchObject({rating:4,rating_comment:'Quick fix'});expect(row.closed_at).not.toBeNull();
  expect(actionSchema.safeParse({type:'rate',ticket_id:created.id,rating:6}).success).toBe(false);
 });
 it('renews a plan for a year and credits the annual quota again',async()=>{
  const before=(await q<{ends_at:Date}>('SELECT ends_at FROM subscriptions WHERE organization_id=$1',[org]))[0].ends_at;
  const balance=(await q<{balance:number}>('SELECT balance FROM wallets WHERE organization_id=$1',[org]))[0].balance;
  await expect(run(member,{type:'renew_subscription',organization_id:org})).rejects.toMatchObject({status:403});
  await run(boss,{type:'renew_subscription',organization_id:org});
  const after=(await q<{ends_at:Date}>('SELECT ends_at FROM subscriptions WHERE organization_id=$1',[org]))[0].ends_at;
  expect(Math.round((after.getTime()-before.getTime())/86_400_000)).toBeGreaterThanOrEqual(365);
  expect((await q<{balance:number}>('SELECT balance FROM wallets WHERE organization_id=$1',[org]))[0].balance).toBe(balance+100);
  await expect(run(boss,{type:'renew_subscription',organization_id:other})).rejects.toMatchObject({status:409});
 });
 it('shows an announcement only to the clients it targets',async()=>{
  await expect(run(member,{type:'announce',organization_id:null,title:'Hello',body:'Not allowed'})).rejects.toMatchObject({status:403});
  await run(boss,{type:'announce',organization_id:org,title:'Maintenance',body:'Saturday night, 30 minutes.'});
  await run(boss,{type:'announce',organization_id:null,title:'New office',body:'We moved.'});
  expect(((await workspace(member)).announcements as {title:string}[]).map(a=>a.title).sort()).toEqual(['Maintenance','New office']);
  expect(((await workspace(stranger)).announcements as {title:string}[]).map(a=>a.title)).toEqual(['New office']);
  expect((await q("SELECT 1 FROM notifications WHERE organization_id=$1 AND message LIKE 'Maintenance%'",[other]))).toHaveLength(0);
  expect((await q("SELECT 1 FROM notifications WHERE organization_id=$1 AND message LIKE 'New office%'",[other]))).toHaveLength(1);
 });
});
