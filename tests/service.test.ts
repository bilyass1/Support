import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
const harness=vi.hoisted(()=>({db:null as unknown as import('@electric-sql/pglite').PGlite}));
vi.mock('../src/lib/db',()=>({
  pool:{query:async(text:string,values?:unknown[])=>{const r=await harness.db.query(text,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}},
  transaction:async(operation:(c:PoolClient)=>Promise<unknown>)=>harness.db.transaction(async db=>operation({query:async(text:string,values?:unknown[])=>{const r=await db.query(text,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}} as PoolClient))
}));
import { act,workspace,type Actor } from '../src/lib/service';
const admin:Actor={id:'admin',name:'Admin',role:'admin',organization_id:null};
let client:Actor,other:Actor,appId:string,planId:string;
async function query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]){return (await harness.db.query<T>(sql,args)).rows;}
beforeEach(async()=>{
  harness.db=new PGlite();
  await harness.db.exec('CREATE TABLE "user" (id text PRIMARY KEY,name text,email text); INSERT INTO "user" VALUES (\'client\',\'Client\',\'client@example.com\'),(\'other\',\'Other\',\'other@example.com\');');
  for(const name of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql']) await harness.db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
  const organization=await act(admin,{type:'create_organization',name:'Client One',email:'client@example.com'}) as {id:string};
  const second=await act(admin,{type:'create_organization',name:'Client Two',email:'other@example.com'}) as {id:string};
  client={id:'client',name:'Client',role:'client',organization_id:organization.id};
  other={id:'other',name:'Other',role:'client',organization_id:second.id};
  const plan=await act(admin,{type:'save_plan',mail_max_mailboxes:100,mail_total_mb:100000,mail_per_box_mb:10000,mail_create_tokens:0,name:'Basic',annual_tokens:100,price_minor:100000,currency:'TND',support_level:'Standard',rules:[],apply_to_existing:false}) as {id:string};
  planId=plan.id;
  await act(admin,{type:'assign_plan',organization_id:organization.id,plan_id:planId});
  const app=await act(admin,{type:'create_application',organization_id:organization.id,name:'Client app',kind:'web'}) as {id:string};
  appId=app.id;
});
afterEach(async()=>{await harness.db.close();});
async function ticket(){return await act(client,{type:'create_ticket',application_id:appId,title:'Add a new module',description:'We need a new dashboard for our team.',category:'development'}) as {id:string};}
async function wallet(){return (await query<{balance:number;reserved:number}>('SELECT balance,reserved FROM wallets WHERE organization_id=$1',[client.organization_id]))[0];}
describe('PostgreSQL business flow',()=>{
  it('rejects lowering an existing pack below its allocated mailbox storage without changing the snapshot',async()=>{
    const [domain]=await query<{id:string}>(`INSERT INTO email_domains(organization_id,domain,provider,total_quota_mb,mailbox_quota_mb,imap_host,smtp_host) VALUES ($1,'client.example','manual',2000,1000,'mail.example','mail.example') RETURNING id`,[client.organization_id]);
    await query(`INSERT INTO email_mailboxes(domain_id,local_part,display_name,quota_mb,status) VALUES ($1,'contact','Contact',1000,'active')`,[domain.id]);
    await expect(act(admin,{type:'save_plan',id:planId,name:'Too small',annual_tokens:100,price_minor:100000,currency:'TND',support_level:'Standard',rules:[],mail_max_mailboxes:100,mail_total_mb:100000,mail_per_box_mb:500,mail_create_tokens:0,apply_to_existing:true})).rejects.toThrow('déjà alloués');
    const [plan]=await query<{name:string}>('SELECT name FROM plans WHERE id=$1',[planId]);
    expect(plan.name).toBe('Basic');
  });
  it('persists a complete request, quote, acceptance, delivery and consumption',async()=>{
    const t=await ticket();
    await act(admin,{type:'quote',ticket_id:t.id,tokens:25,note:'Module and tests, three working days.'});
    await act(client,{type:'accept',ticket_id:t.id,estimate_revision:1});
    expect(await wallet()).toEqual({balance:100,reserved:25});
    await act(admin,{type:'move',ticket_id:t.id,status:'in_progress'});
    await act(admin,{type:'move',ticket_id:t.id,status:'ready'});
    await act(client,{type:'move',ticket_id:t.id,status:'closed'});
    expect(await wallet()).toEqual({balance:75,reserved:0});
    await expect(act(client,{type:'move',ticket_id:t.id,status:'closed'})).rejects.toThrow();
    const ledger=await query('SELECT * FROM credit_ledger WHERE ticket_id=$1',[t.id]);
    expect(ledger).toHaveLength(2);
  });
  it('rejects stale quotes and repeated acceptance',async()=>{
    const t=await ticket();await act(admin,{type:'quote',ticket_id:t.id,tokens:15,note:'First quote'});
    await act(admin,{type:'quote',ticket_id:t.id,tokens:20,note:'Updated quote'});
    await expect(act(client,{type:'accept',ticket_id:t.id,estimate_revision:1})).rejects.toThrow('changé');
    await act(client,{type:'accept',ticket_id:t.id,estimate_revision:2});
    await expect(act(client,{type:'accept',ticket_id:t.id,estimate_revision:2})).rejects.toThrow();
    expect(await wallet()).toEqual({balance:100,reserved:20});
  });
  it('rolls back insufficient balance and protects tenant isolation',async()=>{
    const t=await ticket();await act(admin,{type:'quote',ticket_id:t.id,tokens:101,note:'Larger feature'});
    await expect(act(client,{type:'accept',ticket_id:t.id,estimate_revision:1})).rejects.toThrow('insuffisant');
    expect(await wallet()).toEqual({balance:100,reserved:0});
    await expect(act(other,{type:'comment',ticket_id:t.id,body:'Unauthorized comment'})).rejects.toThrow('refusé');
    await expect(act(other,{type:'create_ticket',application_id:appId,title:'Intrusion',description:'Invalid tenant access test.',category:'design'})).rejects.toThrow('refusé');
    const view=await workspace(other);expect(view.tickets).toHaveLength(0);expect(view.applications).toHaveLength(0);
  });
  it('releases cancelled reservations and audits manual recharges',async()=>{
    const t=await ticket();await act(admin,{type:'quote',ticket_id:t.id,tokens:20,note:'Small feature'});await act(client,{type:'accept',ticket_id:t.id,estimate_revision:1});
    await act(admin,{type:'move',ticket_id:t.id,status:'cancelled'});
    await act(admin,{type:'recharge',organization_id:client.organization_id!,tokens:50,note:'Bank transfer reference 001'});
    expect(await wallet()).toEqual({balance:150,reserved:0});
    expect(await query("SELECT * FROM audit_events WHERE action='recharge'")).toHaveLength(1);
    await expect(act(client,{type:'recharge',organization_id:client.organization_id!,tokens:50,note:'Self grant'})).rejects.toThrow('admin');
  });
  it('changes future rules without modifying accepted costs or granting twice',async()=>{
    const t=await ticket();await act(admin,{type:'quote',ticket_id:t.id,tokens:20,note:'Agreed scope'});await act(client,{type:'accept',ticket_id:t.id,estimate_revision:1});
    await act(admin,{type:'save_plan',mail_max_mailboxes:100,mail_total_mb:100000,mail_per_box_mb:10000,mail_create_tokens:0,id:planId,name:'Basic v2',annual_tokens:200,price_minor:200000,currency:'TND',support_level:'Priority',rules:[{kind:'category_cost',category:'development',tokens:80},{kind:'max_open_tickets',limit:1}],apply_to_existing:true});
    await expect(ticket()).rejects.toThrow('limite');
    await act(admin,{type:'assign_plan',organization_id:client.organization_id!,plan_id:planId});
    expect(await wallet()).toEqual({balance:100,reserved:20});
    const stored=(await query<{estimated_tokens:number}>('SELECT estimated_tokens FROM tickets WHERE id=$1',[t.id]))[0];expect(stored.estimated_tokens).toBe(20);
    await expect(act(admin,{type:'quote',ticket_id:t.id,tokens:80,note:'Change agreed price'})).rejects.toThrow('validé');
  });
  it('denies new requests and acceptance after the annual term expires',async()=>{
    const t=await ticket();await act(admin,{type:'quote',ticket_id:t.id,tokens:20,note:'Before expiry'});
    await harness.db.query("UPDATE subscriptions SET ends_at=now()-interval '1 day' WHERE organization_id=$1",[client.organization_id]);
    await expect(ticket()).rejects.toThrow('active');
    await expect(act(client,{type:'accept',ticket_id:t.id,estimate_revision:1})).rejects.toThrow('active');
  });
});

