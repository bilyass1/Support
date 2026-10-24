#!/usr/bin/python3
"""Root console import: verified existing mailboxes, unchanged client subscription.

All customer identities are supplied on the VPS, never embedded in this source.
Dependencies are downloaded to root-only storage from an explicit immutable ref.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

APP=Path('/opt/supportflow/notifications-release')
NODE='/opt/supportflow/node22/node_modules/node/bin/node'
CONFIG=Path('/etc/supportflow-mail.json')
INSTALLED=Path('/usr/local/libexec/supportflow-mail')


def command(argv):
    result=subprocess.run(argv,text=True,capture_output=True,timeout=60,check=False)
    if result.returncode:
        raise RuntimeError('Commande non confirmée : '+Path(argv[0]).name)
    return result.stdout.strip()


def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


def atomic(path,data,mode):
    fd,name=tempfile.mkstemp(prefix='.import-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno());os.fchmod(stream.fileno(),mode)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)


def import_configuration(original,states,domain,maximum):
    config=dict(original);config['domains']=list(original['domains'])
    is_new=domain not in config['domains']
    other=sum(record.get('domain')!=domain for record in states)
    # Preserve the previous global headroom when authorizing another domain.
    capacity=max(config['max_accounts']+(maximum if is_new else 0),other+maximum)
    if capacity>1000:raise RuntimeError('Capacité root supérieure à la limite autorisée.')
    if is_new:config['domains'].append(domain)
    config['max_accounts']=capacity
    return config


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('organization','actor','domain','mailboxes','expected-email','source-ref'):
        parser.add_argument('--'+name,required=True)
    for name in ('max-mailboxes','total-mb','per-box-mb'):
        parser.add_argument('--'+name,type=int,required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0:raise RuntimeError('Exécuter depuis la console root autorisée.')
    if not re.fullmatch('[0-9a-f]{40}',args.source_ref):raise RuntimeError('Révision source invalide.')
    os.umask(0o077)
    args.preserve_subscription=True;args.allow_existing_layout=True
    tools=Path(tempfile.mkdtemp(prefix='supportflow-import-',dir='/root'))
    for name in ('broker.py','import_existing.py'):
        url='https://raw.githubusercontent.com/bilyass1/Support/'+args.source_ref+'/deploy/local-mail/'+name
        with urllib.request.urlopen(url,timeout=30) as response:
            data=response.read(150001)
        if len(data)>150000 or not data.startswith(b'#!/usr/bin/python3'):
            raise RuntimeError('Source import invalide.')
        atomic(tools/name,data,0o700)
    helper=module('client_import',tools/'import_existing.py')
    broker=module('client_broker',tools/'broker.py')
    parts=helper.validated_args(args)
    info=helper.inspect_database(args)
    # Reject unsuitable plans before touching root configuration or server files.
    helper.sql_for_import(args,info,[])
    broker.secure_file(CONFIG)
    config=broker.settings()
    if command(['systemctl','is-active','supportflow-mail'])!='active':
        raise RuntimeError('Le connecteur mail doit être actif avant import.')
    current=command(['systemctl','show','supportflow.service','-p','WorkingDirectory','--value'])
    if current!=str(APP):raise RuntimeError('Version applicative différente : vérifier le chemin.')
    env_file=APP/'.env.local'
    if env_file.is_symlink():raise RuntimeError('Fichier environnement symbolique non accepté.')
    app_config=json.loads(command(['runuser','-u','supportflow','--',NODE,'--env-file='+str(env_file),'-e',
        'process.stdout.write(JSON.stringify({socket:process.env.LOCAL_MAIL_SOCKET||""}))']))
    states=[]
    for path in broker.STATE.glob('*.json'):
        broker.secure_file(path);states.append(json.loads(path.read_text()))
    config=import_configuration(config,states,args.domain,args.max_mailboxes)
    candidate=tools/'candidate-config.json'
    atomic(candidate,(json.dumps(config,indent=2)+'\n').encode(),0o600)
    broker.CONFIG=candidate
    broker.verify_domain(args.domain)
    records=helper.inspect_accounts(broker,args.domain,parts,info['rows'],True)
    helper.sql_for_import(args,info,records)
    print('CLIENT : '+info['organization']['name']+' / '+info['email'],flush=True)
    print('BOÎTES : '+', '.join(part+'@'+args.domain for part in parts),flush=True)
    print('FORMULE CONSERVÉE : '+str(args.max_mailboxes)+' boîtes, '+str(args.total_mb)+' Mo au total.',flush=True)
    print('CAPACITÉ ROOT : '+str(config['max_accounts'])+' comptes, domaines existants conservés.',flush=True)
    if not args.apply:
        print('APERÇU_OK — aucune configuration, boîte ou donnée applicative modifiée.');return
    backup=tools/'before';backup.mkdir(mode=0o700)
    shutil.copy2(CONFIG,backup/'supportflow-mail.json')
    shutil.copy2(env_file,backup/'app.env')
    INSTALLED.mkdir(parents=True,exist_ok=True,mode=0o750)
    directory=INSTALLED.lstat()
    if INSTALLED.is_symlink() or directory.st_uid!=0 or directory.st_mode & 0o022:
        raise RuntimeError('Répertoire du connecteur non protégé.')
    for name in ('broker.py','import_existing.py'):
        target=INSTALLED/name
        if target.exists() or target.is_symlink():
            if target.is_symlink():raise RuntimeError('Fichier du connecteur symbolique non accepté.')
            shutil.copy2(target,backup/name)
        atomic(target,(tools/name).read_bytes(),0o700)
    atomic(CONFIG,candidate.read_bytes(),0o600)
    command(['restorecon','-R',str(INSTALLED)])
    command(['restorecon',str(CONFIG)])
    command(['systemctl','restart','supportflow-mail'])
    # The importer makes a database/map/state backup, rechecks identities and
    # records exactly the UUIDs used by the client-scoped password endpoint.
    argv=[sys.executable,str(INSTALLED/'import_existing.py'),
        '--organization',args.organization,'--actor',args.actor,'--domain',args.domain,
        '--mailboxes',args.mailboxes,'--expected-email',args.expected_email,
        '--max-mailboxes',str(args.max_mailboxes),'--total-mb',str(args.total_mb),
        '--per-box-mb',str(args.per_box_mb),'--allow-existing-layout','--preserve-subscription','--apply']
    result=subprocess.run(argv,check=False)
    if result.returncode:
        raise RuntimeError('Import non confirmé. Consulter les sauvegardes avant toute reprise : '+str(tools))
    if app_config['socket']!='/run/supportflow-mail/broker.sock':
        with env_file.open('a') as stream:stream.write('\nLOCAL_MAIL_SOCKET=/run/supportflow-mail/broker.sock\n')
        env_file.chmod(0o600)
        command(['systemctl','restart','supportflow.service'])
        import time
        for attempt in range(20):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3101/login',timeout=5) as response:
                    if response.status==200:break
            except OSError:pass
            time.sleep(1)
        else:raise RuntimeError('Association créée ; vérifier le redémarrage de supportflow.service.')
    probe='''import socket,json,sys
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(15);s.connect('/run/supportflow-mail/broker.sock')
b=json.dumps({'operation':'verify_domain','domain':sys.argv[1]}).encode()
s.sendall(b'POST / HTTP/1.0\\r\\nContent-Type: application/json\\r\\nContent-Length: '+str(len(b)).encode()+b'\\r\\n\\r\\n'+b)
chunks=[]
while True:
 chunk=s.recv(4096)
 if not chunk:break
 chunks.append(chunk)
s.close();head,body=b''.join(chunks).split(b'\\r\\n\\r\\n',1)
assert b' 200 ' in head.split(b'\\r\\n')[0] and json.loads(body).get('ok') is True
'''
    command(['runuser','-u','supportflow','--','/usr/bin/python3','-c',probe,args.domain])
    final=helper.inspect_database(args)
    for key in ('plan_id','snapshot','ends_at'):
        if final['subscription'][key]!=info['subscription'][key]:
            raise RuntimeError('Abonnement modifié simultanément ; vérifier son état.')
    actual={row['local_part']:row for row in final['rows']}
    if set(actual)!=set(parts) or any(row['status']!='active' or row['operation'] for row in actual.values()):
        raise RuntimeError('État des boîtes à vérifier.')
    print('IMPORT_TERMINE — boîtes actives associées au client, abonnement conservé.',flush=True)
    print('CONNECTEUR_OK — accessible au compte applicatif.',flush=True)
    print('OUTLOOK : mail.solumove.net | IMAP 993 SSL/TLS | SMTP 587 STARTTLS | adresse complète comme identifiant.',flush=True)
    print('Sauvegarde de préparation : '+str(backup),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('IMPORT_INTERROMPU : '+str(error),file=sys.stderr)
        raise SystemExit(1)
