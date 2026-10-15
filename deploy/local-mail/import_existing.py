#!/usr/bin/python3
"""Explicit root-only adoption of verified existing Postfix/PAM mailboxes.

Never reachable from the web broker. Dry run is the default. Does not create
Linux users, change passwords, delete mail, or debit/credit wallets.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import uuid

HERE = Path(__file__).resolve().parent
DB = 'supportflow'
BACKUPS = Path('/root/supportflow-backups')

class Refused(Exception):
    pass

def command(args, data=None, timeout=30):
    result = subprocess.run(args, input=data, text=True, capture_output=True,
                            timeout=timeout, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}, check=False)
    if result.returncode:
        raise Refused('Command failed: ' + Path(args[0]).name)
    return result.stdout.strip()

def pg(sql):
    output = command(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',DB], sql)
    return json.loads(output) if output else None

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def load_broker():
    path = HERE / 'broker.py'
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise Refused('The installed broker must be a root-owned, non-writable regular file.')
    spec = importlib.util.spec_from_file_location('supportflow_import_broker', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def query_alias(address, alias_path):
    result=subprocess.run(['/usr/sbin/postmap','-q',address,'hash:'+str(alias_path)],text=True,capture_output=True,timeout=10,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
    if result.returncode not in (0,1) or result.stderr or (result.returncode==1 and result.stdout.strip()):
        raise Refused('Cannot query compiled alias map.')
    return result.stdout.strip()

def validated_args(args):
    args.organization = str(uuid.UUID(args.organization))
    args.actor = str(args.actor)
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,200}', args.actor):
        raise Refused('Invalid admin identity.')
    if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?', args.domain):
        raise Refused('Invalid domain.')
    parts = args.mailboxes.split(',')
    if not parts or len(set(parts)) != len(parts) or len(parts)>100:
        raise Refused('Invalid or duplicate mailbox list.')
    if any(not re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*',p) or len((p+'-'+args.domain).encode())>32 for p in parts):
        raise Refused('Invalid mailbox name.')
    if not 1 <= args.max_mailboxes <= 1000 or not 1 <= args.per_box_mb <= args.total_mb <= 100000000:
        raise Refused('Invalid pack limits.')
    return parts

def inspect_accounts(broker, domain, parts, db_rows):
    records = []
    known = {}
    directory = broker.STATE.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or directory.st_mode & 0o077:
        raise Refused('Unsafe broker state directory.')
    for path in broker.STATE.glob('*.json'):
        broker.secure_file(path)
        record = json.loads(path.read_text())
        if record.get('domain') == domain and record.get('local_part') in parts:
            local = record['local_part']
            if local in known:
                raise Refused('Duplicate broker identity for '+local)
            known[local] = (str(uuid.UUID(path.stem)),record)
    aliases = broker.entries(broker.ALIAS)
    if '@'+domain in aliases or domain in aliases:
        raise Refused('A catch-all requires separate review.')
    current = {r['local_part']:r for r in db_rows}
    for local in parts:
        username=local+'-'+domain
        try: account=pwd.getpwnam(username)
        except KeyError: raise Refused('Missing Linux account: '+username)
        home=broker.HOME_ROOT/username
        if account.pw_uid<1000 or account.pw_shell!='/sbin/nologin' or account.pw_dir!=str(home):
            raise Refused('Unexpected Linux identity: '+username)
        for path in [home,home/'Maildir',home/'Maildir/cur',home/'Maildir/new',home/'Maildir/tmp']:
            try: info=path.lstat()
            except FileNotFoundError: raise Refused('Missing mailbox directory: '+str(path))
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=account.pw_uid:
                raise Refused('Unsafe mailbox directory: '+str(path))
        target=username+'@localhost'
        address=local+'@'+domain
        # A missing alias can be added; an existing conflicting route is never replaced.
        if address in aliases and aliases[address]!=target:
            raise Refused('Conflicting alias: '+address)
        compiled=query_alias(address,broker.ALIAS)
        if compiled!=(aliases.get(address) or ''):
            raise Refused('Source and compiled alias maps disagree: '+address)
        expected={'domain':domain,'local_part':local,'username':username,'uid':account.pw_uid,'phase':'active'}
        state=known.get(local)
        if state and state[1]!=expected:
            raise Refused('Incomplete or changed broker identity: '+address)
        row=current.get(local)
        if row and (row['status']!='active' or row['operation'] or row['reserved_tokens']):
            raise Refused('Mailbox has an unresolved operation: '+address)
        if row and state and row['id']!=state[0]:
            raise Refused('Application and broker identities disagree: '+address)
        mailbox_id=row['id'] if row else state[0] if state else str(uuid.uuid4())
        # Never overwrite a broker record whose UUID belongs to another identity.
        path=broker.STATE/(mailbox_id+'.json')
        if path.exists() and not state:
            raise Refused('Broker UUID is already owned.')
        if row and row['quota_mb']>100000000:
            raise Refused('Invalid existing quota.')
        records.append({'id':mailbox_id,'local_part':local,'record':expected,'existing':bool(row),'alias_missing':address not in aliases,'state_missing':not bool(state),'quota_mb':row['quota_mb'] if row else None})
    count=len(list(broker.STATE.glob('*.json')))+sum(r['state_missing'] for r in records)
    if count>broker.settings()['max_accounts']:
        raise Refused('Independent root broker account limit would be exceeded.')
    return records

def sql_for_import(args, info, records):
    org=literal(args.organization); actor=literal(args.actor); domain=literal(args.domain)
    expected_rows=literal(json.dumps(sorted(info['rows'],key=lambda r:r['id'])))+'::jsonb'
    expected_snapshot=literal(json.dumps(info['subscription']['snapshot']))+'::jsonb'
    dedicated_name='Cime Events - 10 boites' if args.domain=='cimeevents.com' else args.domain+' - mail'
    old=info['subscription']['snapshot']
    same_pack=old.get('name')==dedicated_name and old.get('mail_max_mailboxes')==args.max_mailboxes and old.get('mail_total_mb')==args.total_mb and old.get('mail_per_box_mb')==args.per_box_mb and old.get('id')==info['subscription']['plan_id']
    plan_id=info['subscription']['plan_id'] if same_pack else str(uuid.uuid4());domain_id=info['domain']['id'] if info['domain'] else str(uuid.uuid4())
    snapshot=dict(info['subscription']['snapshot'])
    snapshot.update({'id':plan_id,'name':dedicated_name, 'revision':old.get('revision',1) if same_pack else 1,'mail_max_mailboxes':args.max_mailboxes,'mail_total_mb':args.total_mb,'mail_per_box_mb':args.per_box_mb})
    values=[literal(plan_id),literal(snapshot['name']),str(int(snapshot['annual_tokens'])),str(int(snapshot['price_minor'])),literal(snapshot['currency']),literal(snapshot['support_level']),literal(json.dumps(snapshot['rules']))+'::jsonb',str(args.max_mailboxes),str(args.total_mb),str(args.per_box_mb),str(int(snapshot.get('mail_create_tokens',0)))]
    snapshot['mail_create_tokens']=int(snapshot.get('mail_create_tokens',0))
    sql=['BEGIN; SET LOCAL lock_timeout=\'5s\'; SET LOCAL standard_conforming_strings=on;',
         'SELECT id FROM organizations WHERE id='+org+' FOR UPDATE;',
         '''DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM app_roles WHERE user_id='''+actor+''' AND role='admin') THEN RAISE EXCEPTION 'Admin changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id='''+org+''' AND u.email='''+literal(info['email'])+''') THEN RAISE EXCEPTION 'Client identity changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM subscriptions WHERE organization_id='''+org+''' AND ends_at>now() AND snapshot='''+expected_snapshot+''') THEN RAISE EXCEPTION 'Subscription changed'; END IF;
 IF EXISTS(SELECT 1 FROM email_domains WHERE domain='''+domain+''' AND (organization_id<>'''+org+''' OR provider<>'postfix')) THEN RAISE EXCEPTION 'Domain belongs to another client'; END IF;
 IF (SELECT coalesce(jsonb_agg(b ORDER BY b.id),'[]'::jsonb) FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.domain='''+domain+''' AND b.status<>'cancelled')<>'''+expected_rows+''' THEN RAISE EXCEPTION 'Mailbox records changed'; END IF;
 END $$;''',
         ('INSERT INTO plans(id,name,annual_tokens,price_minor,currency,support_level,rules,mail_max_mailboxes,mail_total_mb,mail_per_box_mb,mail_create_tokens) VALUES('+','.join(values)+');') if not same_pack else 'SELECT 1;',
         'UPDATE subscriptions SET plan_id='+literal(plan_id)+',snapshot='+literal(json.dumps(snapshot))+'::jsonb WHERE organization_id='+org+';',
         'INSERT INTO email_domains(id,organization_id,domain,provider,enabled,max_mailboxes,total_quota_mb,mailbox_quota_mb,imap_host,smtp_host,smtp_port) VALUES('+','.join([literal(domain_id),org,domain,"'postfix'",'true',str(args.max_mailboxes),str(args.total_mb),str(args.per_box_mb),literal('mail.solumove.net'),literal('mail.solumove.net'),'587'])+') ON CONFLICT(domain) DO UPDATE SET enabled=true,max_mailboxes=excluded.max_mailboxes,total_quota_mb=excluded.total_quota_mb,mailbox_quota_mb=excluded.mailbox_quota_mb,imap_host=excluded.imap_host,smtp_host=excluded.smtp_host,smtp_port=excluded.smtp_port;']
    for row in records:
        if row['existing']:continue
        sql.append('INSERT INTO email_mailboxes(id,domain_id,local_part,display_name,quota_mb,status,reserved_tokens) VALUES('+','.join([literal(row['id']),literal(domain_id),literal(row['local_part']),literal(row['local_part']),str(args.per_box_mb),"'active'",'0'])+');')
    sql.append('''DO $$ DECLARE n integer; q bigint; biggest integer; BEGIN
 SELECT count(*),coalesce(sum(b.quota_mb),0),coalesce(max(b.quota_mb),0) INTO n,q,biggest FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id='''+org+''' AND b.status<>'cancelled';
 IF n>'''+str(args.max_mailboxes)+''' OR q>'''+str(args.total_mb)+''' OR biggest>'''+str(args.per_box_mb)+''' THEN RAISE EXCEPTION 'Pack limit exceeded'; END IF;
 END $$;''')
    detail={'domain':args.domain,'addresses':[r['local_part']+'@'+args.domain for r in records],'limits':{'count':args.max_mailboxes,'total_mb':args.total_mb,'per_box_mb':args.per_box_mb},'wallet_unchanged':True,'passwords_unchanged':True}
    sql.append('INSERT INTO audit_events(actor_id,action,entity_id,detail) VALUES('+actor+",'import_existing_mailboxes',"+org+','+literal(json.dumps(detail))+'::jsonb);')
    sql.append('COMMIT;')
    return '\n'.join(sql)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--organization',required=True);parser.add_argument('--actor',required=True)
    parser.add_argument('--domain',required=True);parser.add_argument('--mailboxes',required=True)
    parser.add_argument('--max-mailboxes',type=int,required=True);parser.add_argument('--total-mb',type=int,required=True);parser.add_argument('--per-box-mb',type=int,required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0:raise Refused('Run only from the authorized root console.')
    os.umask(0o077);parts=validated_args(args);broker=load_broker();broker.verify_domain(args.domain)
    info=pg('''SELECT jsonb_build_object('organization',row_to_json(o),'email',(SELECT u.email FROM memberships m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=o.id),'subscription',(SELECT row_to_json(s) FROM subscriptions s WHERE s.organization_id=o.id),'active_subscription',EXISTS(SELECT 1 FROM subscriptions s WHERE s.organization_id=o.id AND s.ends_at>now()),'admin',EXISTS(SELECT 1 FROM app_roles WHERE user_id='''+literal(args.actor)+''' AND role='admin'),'domain',(SELECT row_to_json(d) FROM email_domains d WHERE d.domain='''+literal(args.domain)+'''),'other_mailboxes',(SELECT count(*) FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.organization_id=o.id AND d.domain<>'''+literal(args.domain)+''' AND b.status<>'cancelled'),'rows',coalesce((SELECT jsonb_agg(b) FROM email_mailboxes b JOIN email_domains d ON d.id=b.domain_id WHERE d.domain='''+literal(args.domain)+''' AND b.status<>'cancelled'),'[]'::jsonb)) FROM organizations o WHERE o.id='''+literal(args.organization)+';')
    if not info or not info['email'] or not info['admin'] or not info['active_subscription']:
        raise Refused('Missing client identity, authorized admin, or active subscription.')
    if info['domain'] and (info['domain']['organization_id']!=args.organization or info['domain']['provider']!='postfix'):
        raise Refused('Domain belongs to another client or provider.')
    if info['other_mailboxes']:
        raise Refused('Other domains already consume this client pack; review before reserving exactly two additional boxes.')
    if info['rows'] and any(r['local_part'] not in parts for r in info['rows']):
        raise Refused('Extra application mailboxes need separate review.')
    records=inspect_accounts(broker,args.domain,parts,info['rows'])
    root_count=len(list(broker.STATE.glob('*.json')))+sum(r['state_missing'] for r in records)
    if root_count+max(0,args.max_mailboxes-len(records))>broker.settings()['max_accounts']:
        raise Refused('Root broker limit does not leave room for the remaining pack slots.')
    print('Client: '+info['organization']['name']+' / '+info['email'])
    print('Import: '+', '.join(r['local_part']+'@'+args.domain for r in records))
    print('Pack: '+str(args.max_mailboxes)+' mailboxes; '+str(args.total_mb)+' MB allocated; '+str(args.per_box_mb)+' MB per box.')
    print('Missing routes: '+', '.join(r['local_part'] for r in records if r['alias_missing']))
    print('Outlook: mail.solumove.net IMAP 993 TLS; SMTP 587 STARTTLS; full email as login.')
    sql=sql_for_import(args,info,records)
    if not args.apply:
        print('DRY RUN OK. No users, passwords, messages, maps or database records changed.');return
    backup=BACKUPS/('mail-import-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]);backup.mkdir(parents=True,mode=0o700)
    with (backup/'database.dump').open('wb') as stream:
        r=subprocess.run(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/pg_dump','-Fc',DB],stdout=stream,stderr=subprocess.PIPE,check=False)
        if r.returncode:raise Refused('Database backup failed.')
    command(['/usr/bin/pg_restore','--list',str(backup/'database.dump')])
    shutil.copy2(broker.ALIAS,backup/'virtual');shutil.copy2(str(broker.ALIAS)+'.db',backup/'virtual.db')
    shutil.copytree(broker.STATE,backup/'broker-state')
    (backup/'import.sql').write_text(sql)
    # Stop only the provisioning helper. Postfix, Dovecot and websites keep running.
    running=command(['/usr/bin/systemctl','is-active','supportflow-mail'])=='active'
    if not running:raise Refused('Broker service must be active before import.')
    command(['/usr/bin/systemctl','stop','supportflow-mail'])
    committed=False
    try:
        # Recheck identities after stopping the single-threaded broker.
        fresh=inspect_accounts(broker,args.domain,parts,info['rows'])
        old_ids={r['local_part']:r['id'] for r in records}
        # Existing UUIDs must not change; generated new UUIDs remain the reviewed IDs.
        for r in fresh:
            if (r['existing'] or not r['state_missing']) and r['id']!=old_ids[r['local_part']]:raise Refused('Identity changed during import.')
        for row in records:
            if row['state_missing']:
                path=broker.STATE/(row['id']+'.json')
                if os.path.lexists(path):raise Refused('State record appeared during import.')
                broker.atomic_json(path,row['record'])
            if row['alias_missing']:
                broker.add_alias(row['local_part']+'@'+args.domain,row['record']['username'],row['id'])

        # One transaction; expected snapshot protects against concurrent plan changes.
        command(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-v','ON_ERROR_STOP=1','-d',DB],data=sql,timeout=60)
        committed=True
    finally:
        if not committed:
            print('Database import not confirmed. Verified system records/routes are retained; review backup and rerun dry-run before retrying: '+str(backup))
        command(['/usr/bin/systemctl','start','supportflow-mail'])
    print('IMPORT OK. Database/map/broker backups: '+str(backup))
    print('Passwords, Linux accounts, messages, wallet and subscription expiry preserved.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('IMPORT STOPPED: '+str(error) if isinstance(error,Refused) else 'IMPORT STOPPED: verification or system operation failed.')
        raise SystemExit(1)
