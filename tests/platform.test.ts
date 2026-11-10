import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
const harness=vi.hoisted(()=>({db:null as unknown as import('@electric-sql/pglite').PGlite}));
vi.mock('../src/lib/db',()=>({
  pool:{query:async(text:string,values?:unknown[])=>{const r=await harness.db.query(text,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}},
  transaction:async(operation:(c:PoolClient)=>Promise<unknown>)=>harness.db.transaction(async db=>operation({query:async(text:string,values?:unknown[])=>{const r=await db.query(text,values);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};}} as PoolClient))
}));
import { act,workspace,recordUsage,reminders,adminView,type Actor } from '../src/lib/service';
import { actionSchema,pushSubscriptionSchema } from '../src/lib/validation';
import { invoiceTotals,slaBreached } from '../src/lib/domain';
const admin:Actor={id:'admin',name:'Admin',role:'admin',organization_id:null};
const manager:Actor={id:'manager',name:'Manager',role:'manager',organization_id:null};
let client:Actor,other:Actor,appId:string;
const run=(actor:Actor,input:unknown)=>act(actor,actionSchema.parse(input));
async function query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]){return (await harness.db.query<T>(sql,args)).rows;}
beforeEach(async()=>{
  harness.db=new PGlite();
  await harness.db.exec(`CREATE TABLE "user" (id text PRIMARY KEY,name text,email text); CREATE TABLE session (id text PRIMARY KEY,"userId" text,"updatedAt" timestamptz);
    INSERT INTO "user" VALUES ('admin','Admin','admin@example.com'),('manager','Manager','manager@example.com'),('client','Client','client@example.com'),('colleague','Colleague','colleague@example.com'),('other','Other','other@example.com');`);
  for(const file of ['001_initial.sql','002_email.sql','003_platform.sql']) await harness.db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await harness.db.exec("INSERT INTO app_roles VALUES ('admin','admin'),('manager','manager')");
  const one=await run(admin,{type:'create_organization',name:'Client One',email:'client@example.com'}) as {id:string};
  const two=await run(admin,{type:'create_organization',name:'Client Two',email:'other@example.com'}) as {id:string};
  client={id:'client',name:'Client',role:'client',organization_id:one.id};
  other={id:'other',name:'Other',role:'client',organization_id:two.id};
  await run(admin,{type:'add_member',organization_id:one.id,email:'colleague@example.com'});
  const plan=await run(admin,{type:'save_plan',name:'Basic',annual_tokens:100,price_minor:100000,currency:'TND',support_level:'Standard',rules:[]}) as {id:string};
  await run(admin,{type:'assign_plan',organization_id:one.id,plan_id:plan.id});
  appId=(await run(admin,{type:'create_application',organization_id:one.id,name:'Client app',kind:'web'}) as {id:string}).id;
});
afterEach(async()=>{await harness.db.close();});
const newTicket=()=>run(client,{type:'create_ticket',application_id:appId,title:'Add a module',description:'We need a new dashboard.',category:'development'}) as Promise<{id:string}>;
const invoice=(status?:string)=>run(admin,{type:'save_invoice',organization_id:client.organization_id,currency:'TND',items:[{label:'Maintenance',quantity:2,unit_minor:500000}],tax_rate_bp:1900,stamp_minor:1000,due_at:'2020-01-31'})
  .then(async created=>{if(status)await run(admin,{type:'invoice_status',invoice_id:created.id,status});return created.id as string;});

describe('modules per client',()=>{
  it('hides data and refuses actions for modules the admin switched off',async()=>{
    const ticket=await newTicket();await invoice('sent');
    await run(admin,{type:'set_modules',organization_id:client.organization_id,modules:['credits']});
    const view=await workspace(client);
    expect(view.modules).toEqual(['credits']);
    expect([view.tickets.length,view.invoices.length,view.usage.length,view.comments.length]).toEqual([0,0,0,0]);
    expect(view.ledger.length).toBeGreaterThan(0);
    await expect(newTicket()).rejects.toMatchObject({status:403});
    await expect(run(client,{type:'comment',ticket_id:ticket.id,body:'still here?'})).rejects.toMatchObject({status:403});
    expect((await workspace(admin)).tickets).toHaveLength(1);
  });
  it('lets only the admin choose modules, and only known ones',async()=>{
    await expect(run(client,{type:'set_modules',organization_id:client.organization_id,modules:['billing']})).rejects.toMatchObject({status:403});
    await expect(run(manager,{type:'set_modules',organization_id:client.organization_id,modules:['billing']})).rejects.toMatchObject({status:403});
    expect(actionSchema.safeParse({type:'set_modules',organization_id:client.organization_id,modules:['everything']}).success).toBe(false);
  });
});

describe('notifications, e-mail and push queue',()=>{
  it('queues one e-mail and one push per recipient on the other side, never for the author',async()=>{
    const ticket=await newTicket();
    const staff=await query<{user_id:string;channel:string}>(`SELECT d.user_id,d.channel FROM deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.audience='staff' ORDER BY 1,2`);
    expect(staff).toEqual([{user_id:'admin',channel:'email'},{user_id:'admin',channel:'push'},{user_id:'manager',channel:'email'},{user_id:'manager',channel:'push'}]);
    await run(admin,{type:'quote',ticket_id:ticket.id,tokens:10,note:'Two days of work'});
    const clients=await query<{user_id:string}>(`SELECT DISTINCT d.user_id FROM deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.audience='client' AND n.ticket_id=$1 ORDER BY 1`,[ticket.id]);
    expect(clients.map(row=>row.user_id)).toEqual(['client','colleague']);
    await run(client,{type:'comment',ticket_id:ticket.id,body:'Thanks'});
    const authored=await query(`SELECT 1 FROM deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.title LIKE 'Nouveau message%' AND d.user_id='client'`);
    expect(authored).toHaveLength(0);
  });
  it('writes readable status labels and tracks unread per user',async()=>{
    const ticket=await newTicket();
    await run(admin,{type:'quote',ticket_id:ticket.id,tokens:10,note:'Two days of work'});
    await run(client,{type:'accept',ticket_id:ticket.id,estimate_revision:1});
    await run(admin,{type:'move',ticket_id:ticket.id,status:'in_progress'});
    const view=await workspace(client);
    expect(view.notifications[0].message).toContain('En cours');
    expect(view.notifications.some(n=>String(n.message).includes('in_progress'))).toBe(false);
    expect(view.unread).toBeGreaterThan(0);
    await run(client,{type:'mark_seen'});
    expect((await workspace(client)).unread).toBe(0);
    expect((await workspace({...client,id:'colleague'})).unread).toBeGreaterThan(0);
    expect((await workspace(other)).notifications).toHaveLength(0);
  });
  it('keeps internal notes inside the team and never notifies the client about them',async()=>{
    const ticket=await newTicket();
    await run(manager,{type:'comment',ticket_id:ticket.id,body:'Margin is thin on this one',internal:true});
    await expect(run(client,{type:'comment',ticket_id:ticket.id,body:'sneaky',internal:true})).rejects.toMatchObject({status:403});
    expect((await workspace(client)).comments).toHaveLength(0);
    expect((await workspace(client)).notifications.some(n=>String(n.message).includes('Margin'))).toBe(false);
    expect((await workspace(admin)).comments).toHaveLength(1);
  });
});

describe('billing',()=>{
  it('computes totals in minor units with VAT and stamp duty',()=>{
    expect(invoiceTotals([{label:'a',quantity:2,unit_minor:500000}],1900,1000)).toEqual({subtotal:1000000,tax:190000,total:1191000});
    expect(()=>invoiceTotals([{label:'a',quantity:100000,unit_minor:2_000_000_000}],0,0)).toThrow();
  });
  it('keeps drafts private, notifies on sending and payment, and locks sent invoices',async()=>{
    const id=await invoice();
    expect((await workspace(client)).invoices).toHaveLength(0);
    await expect(run(client,{type:'invoice_status',invoice_id:id,status:'sent'})).rejects.toMatchObject({status:403});
    await expect(run(admin,{type:'invoice_status',invoice_id:id,status:'paid'})).rejects.toMatchObject({status:409});
    await run(admin,{type:'invoice_status',invoice_id:id,status:'sent'});
    const visible=(await workspace(client)).invoices[0];
    expect(visible).toMatchObject({total_minor:1191000,status:'sent',overdue:true});
    await expect(run(admin,{type:'save_invoice',id,organization_id:client.organization_id,currency:'TND',items:[{label:'Changed',quantity:1,unit_minor:1}],tax_rate_bp:0,stamp_minor:0,due_at:'2030-01-01'})).rejects.toMatchObject({status:409});
    expect((await workspace(other)).invoices).toHaveLength(0);
    await run(admin,{type:'invoice_status',invoice_id:id,status:'paid'});
    const titles=(await workspace(client)).notifications.map(n=>n.title);
    expect(titles).toEqual(expect.arrayContaining(['Nouvelle facture F-00001','Paiement reçu']));
  });
  it('sends each overdue reminder once, however often the job runs',async()=>{
    await invoice('sent');
    await reminders();await reminders();
    expect(await query("SELECT 1 FROM notifications WHERE dedupe_key LIKE 'inv:overdue:%'")).toHaveLength(2);
    expect((await workspace(admin)).alerts.some(alert=>alert.message.includes('en retard'))).toBe(true);
  });
});

describe('application usage tracking',()=>{
  it('counts sessions, errors and distinct users behind a hashed key shown once',async()=>{
    const {key}=await run(manager,{type:'rotate_app_key',application_id:appId}) as {key:string};
    expect(await query('SELECT 1 FROM applications WHERE ingest_key_hash=$1',[key])).toHaveLength(0);
    await recordUsage(key,{event:'open',user:'u1',version:'1.2.0'});
    await recordUsage(key,{event:'open',user:'u1'});
    await recordUsage(key,{event:'open',user:'u2'});
    await recordUsage(key,{event:'error'});
    await recordUsage(key,{event:'export_pdf',user:'u2'});
    const view=await workspace(client);
    expect(view.usage[0]).toMatchObject({events:5,sessions:3,errors:1,users:2});
    expect(view.applications[0]).toMatchObject({tracked:true,last_version:'1.2.0'});
    expect(await query("SELECT 1 FROM app_usage_users WHERE user_hash IN ('u1','u2')")).toHaveLength(0);
    expect((await workspace(other)).usage).toHaveLength(0);
    await expect(recordUsage('sf_unknown',{event:'open'})).rejects.toMatchObject({status:401});
    await run(admin,{type:'rotate_app_key',application_id:appId});
    await expect(recordUsage(key,{event:'open'})).rejects.toMatchObject({status:401});
    await expect(run(client,{type:'rotate_app_key',application_id:appId})).rejects.toMatchObject({status:403});
  });
});

describe('team, renewals and ticket follow-up',()=>{
  it('gives the team a 360° view that clients never receive',async()=>{
    const team=await workspace(admin),mine=await workspace(client);
    expect(team.members.filter(m=>m.organization_id===client.organization_id).map(m=>m.user_id).sort()).toEqual(['client','colleague']);
    expect(team.team.map(m=>m.user_id).sort()).toEqual(['admin','manager']);
    expect(team.alerts.some(alert=>alert.organization_id===other.organization_id&&alert.message.includes('formule'))).toBe(true);
    expect([mine.members,mine.team,mine.alerts,mine.mail,mine.plans]).toEqual([[],[],[],[],[]]);
    await expect(adminView(manager,'audit')).rejects.toMatchObject({status:403});
    expect((await adminView(admin,'audit')).audit!.length).toBeGreaterThan(0);
  });
  it('manages roles from the interface without letting an admin lock themselves out',async()=>{
    await run(admin,{type:'set_role',email:'colleague@example.com',role:'manager'});
    expect(await query("SELECT 1 FROM app_roles WHERE user_id='colleague' AND role='manager'")).toHaveLength(1);
    await expect(run(admin,{type:'set_role',email:'admin@example.com',role:'none'})).rejects.toMatchObject({status:409});
    await expect(run(manager,{type:'set_role',email:'client@example.com',role:'admin'})).rejects.toMatchObject({status:403});
  });
  it('renews for a year from the current end date and credits the annual quota again',async()=>{
    const before=(await query<{ends_at:Date}>('SELECT ends_at FROM subscriptions WHERE organization_id=$1',[client.organization_id]))[0].ends_at;
    await run(admin,{type:'renew_subscription',organization_id:client.organization_id});
    const after=(await query<{ends_at:Date}>('SELECT ends_at FROM subscriptions WHERE organization_id=$1',[client.organization_id]))[0].ends_at;
    expect(Math.round((after.getTime()-before.getTime())/86_400_000)).toBeGreaterThanOrEqual(365);
    expect((await workspace(client)).organizations[0].balance).toBe(200);
    await expect(run(admin,{type:'renew_subscription',organization_id:other.organization_id})).rejects.toMatchObject({status:409});
  });
  it('tracks priority, assignment, first response and satisfaction',async()=>{
    const ticket=await run(client,{type:'create_ticket',application_id:appId,title:'Site down',description:'The site is unreachable.',category:'bug',priority:'urgent'}) as {id:string};
    await expect(run(admin,{type:'triage',ticket_id:ticket.id,priority:'high',assignee_id:'client'})).rejects.toMatchObject({status:409});
    await run(admin,{type:'triage',ticket_id:ticket.id,priority:'high',assignee_id:'manager'});
    await run(manager,{type:'comment',ticket_id:ticket.id,body:'On it'});
    const row=(await workspace(admin)).tickets[0];
    expect(row).toMatchObject({priority:'high',assignee_id:'manager'});
    expect(row.first_response_at).not.toBeNull();
    await expect(run(client,{type:'rate',ticket_id:ticket.id,rating:5})).rejects.toMatchObject({status:409});
    const created=new Date('2026-01-01T00:00:00Z');
    expect(slaBreached({priority:'urgent',created_at:created,first_response_at:null,status:'new'},created.getTime()+5*3_600_000)).toBe(true);
    expect(slaBreached({priority:'urgent',created_at:created,first_response_at:new Date(created.getTime()+3_600_000),status:'new'},created.getTime()+9e9)).toBe(false);
  });
});

describe('push subscription endpoint',()=>{
  it('accepts browser push services only, so the server cannot be pointed at arbitrary hosts',()=>{
    const keys={p256dh:'B'.repeat(87),auth:'a'.repeat(22)};
    expect(pushSubscriptionSchema.safeParse({endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys}).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({endpoint:'https://web.push.apple.com/abc',keys}).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({endpoint:'https://updates.push.services.mozilla.com/wpush/v2/abc',keys}).success).toBe(true);
    for(const endpoint of ['https://internal.example/hook','http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.tn/x','https://169.254.169.254/latest','https://fcm.googleapis.com:8443/x']) {
      expect(pushSubscriptionSchema.safeParse({endpoint,keys}).success).toBe(false);
    }
  });
});
