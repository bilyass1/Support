import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
function sql(info:unknown,org:string){const args={organization:org,actor:'admin',domain:'cimeevents.com',max_mailboxes:10,total_mb:10000,per_box_mb:1000};const records=['contact','director','events','editor','acc','designer','it','cm'].map(local_part=>({id:randomUUID(),local_part,existing:false}));return execFileSync('python3',['-c',`import importlib.util,types,json,sys; s=importlib.util.spec_from_file_location('helper','deploy/local-mail/import_existing.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); x=json.load(sys.stdin); print(m.sql_for_import(types.SimpleNamespace(**x['args']),x['info'],x['records']))`],{input:JSON.stringify({args,info,records}),encoding:'utf8'});}
it('imports eight identities into a dedicated ten-box pack without charging wallets or extending the subscription',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE "user"(id text PRIMARY KEY,email text);');for(const file of ['001_initial.sql','002_email.sql','003_local_mail.sql','004_platform.sql'])await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
 const org=randomUUID(),plan=randomUUID();await db.query("INSERT INTO organizations(id,name) VALUES($1,'Cime Events')",[org]);await db.exec("INSERT INTO app_roles VALUES('admin','admin');INSERT INTO \"user\" VALUES('aref','contact@cimeevents.com')");await db.query("INSERT INTO memberships VALUES('aref',$1)",[org]);await db.query('INSERT INTO wallets VALUES($1,100,0)',[org]);await db.query("INSERT INTO plans(id,name,annual_tokens,price_minor,support_level,mail_max_mailboxes,mail_total_mb,mail_per_box_mb,mail_create_tokens) VALUES($1,'basic',100,100000,'Standard',5,10000,1000,7)",[plan]);
 const snapshot=(await db.query('SELECT * FROM plans WHERE id=$1',[plan])).rows[0];await db.query("INSERT INTO subscriptions(organization_id,plan_id,snapshot,ends_at) VALUES($1,$2,$3,'2027-10-15')",[org,plan,JSON.stringify(snapshot)]);const subscription=(await db.query<{snapshot:object;plan_id:string}>('SELECT * FROM subscriptions WHERE organization_id=$1',[org])).rows[0];
 const text=sql({email:'contact@cimeevents.com',subscription,domain:null,rows:[]},org);await db.exec(text);
 expect((await db.query('SELECT balance,reserved FROM wallets')).rows[0]).toEqual({balance:100,reserved:0});expect((await db.query('SELECT * FROM credit_ledger')).rows).toHaveLength(0);
 expect((await db.query('SELECT * FROM email_mailboxes')).rows).toHaveLength(8);const updated=(await db.query<{snapshot:{mail_max_mailboxes:number};ends_at:Date}>('SELECT * FROM subscriptions')).rows[0];expect(updated.snapshot.mail_max_mailboxes).toBe(10);expect(updated.ends_at.toISOString().slice(0,10)).toBe('2027-10-15');expect((await db.query('SELECT mail_max_mailboxes FROM plans WHERE id=$1',[plan])).rows[0]).toEqual({mail_max_mailboxes:5});
 expect((await db.query('SELECT max_mailboxes,total_quota_mb,mailbox_quota_mb,imap_host,smtp_host,smtp_port FROM email_domains')).rows[0]).toEqual({max_mailboxes:10,total_quota_mb:10000,mailbox_quota_mb:1000,imap_host:'mail.solumove.net',smtp_host:'mail.solumove.net',smtp_port:587});
 await expect(db.exec(text)).rejects.toThrow();await db.exec('ROLLBACK');expect((await db.query('SELECT * FROM email_mailboxes')).rows).toHaveLength(8);
 }finally{await db.close();}
},30000);
