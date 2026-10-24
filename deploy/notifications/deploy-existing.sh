#!/bin/bash
set -Eeuo pipefail
umask 077

[[ "$EUID" -eq 0 ]] || { echo 'Exécuter depuis la console root du VPS.'; exit 1; }
imf_old=/opt/supportflow/client-release
imf_new=/opt/supportflow/notifications-release
imf_node=/opt/supportflow/node22/node_modules/node/bin/node
imf_unit=/etc/systemd/system/supportflow.service

[[ "$(systemctl show supportflow.service -p WorkingDirectory --value)" == "$imf_old" ]]
[[ "$(systemctl show supportflow.service -p User --value)" == supportflow ]]
[[ "$(systemctl show supportflow.service -p FragmentPath --value)" == "$imf_unit" ]]
[[ -f "$imf_unit" && ! -L "$imf_unit" && -s "$imf_new/.next/BUILD_ID" ]]
[[ "$(runuser -u supportflow -- git -C "$imf_new" rev-parse HEAD)" == e8f5a6560c871e1ab7fc2bab837c96afea9c27be ]]
curl --noproxy '*' --fail --silent --show-error --max-time 15 \
  --output /dev/null http://127.0.0.1:3101/login

cd "$imf_new"
runuser -u supportflow -- "$imf_node" --env-file=.env.local scripts/check-notifications.mjs
imf_public_url="$(runuser -u supportflow -- "$imf_node" --env-file=.env.local -e '
  const url=new URL(process.env.BETTER_AUTH_URL);
  if(url.protocol!=="https:"||url.username||url.password)process.exit(1);
  process.stdout.write(url.origin);
')"
runuser -u supportflow -- "$imf_node" --env-file=.env.local --input-type=module <<'NODE'
import nodemailer from 'nodemailer';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const old=parseEnv(readFileSync('/opt/supportflow/client-release/.env.local','utf8'));
const url=new URL(process.env.DATABASE_URL);
if(old.DATABASE_URL!==process.env.DATABASE_URL||old.BETTER_AUTH_SECRET!==process.env.BETTER_AUTH_SECRET)
  throw Error('Conserver DATABASE_URL et BETTER_AUTH_SECRET de la version actuelle.');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))
  throw Error('La sauvegarde automatique exige la base locale prévue pour cette installation.');
const port=Number(process.env.SMTP_PORT??587);
const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port===587,
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},
  tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
let pool;
try{
  await transport.verify(); console.log('SMTP_AUTH_OK — connexion chiffrée et identifiants vérifiés.');
  pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});
  const {rows:[db]}=await pool.query('SELECT current_database() AS name,inet_server_port() AS port');
  if(db.name!=='supportflow'||db.port!==5432)throw Error('DATABASE_BACKUP_TARGET');
  const required=['005_auth_email.sql','006_session_assurance.sql','007_client_onboarding.sql'];
  const applied=await pool.query('SELECT name FROM schema_migrations WHERE name=ANY($1::text[])',[required]);
  if(applied.rowCount!==required.length)throw Error('MIGRATIONS_REQUIRED');
  console.log('DATABASE_OK — schéma existant vérifié, aucune migration nécessaire.');
}catch(error){
  const code=typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:
    ['DATABASE_BACKUP_TARGET','MIGRATIONS_REQUIRED'].includes(error.message)?error.message:'CHECK_FAILED';
  console.error('Prévalidation refusée : '+code+'. Aucun changement de service appliqué.');
  process.exitCode=1;
}finally{transport.close();if(pool)await pool.end();}
NODE

imf_dump="$(command -v pg_dump || true)"
if [[ -z "$imf_dump" && -x /usr/pgsql-16/bin/pg_dump ]]; then imf_dump=/usr/pgsql-16/bin/pg_dump; fi
[[ -n "$imf_dump" && -x "$imf_dump" ]]
imf_restore="$(dirname "$imf_dump")/pg_restore"
[[ -x "$imf_restore" ]]
imf_backup="$(mktemp -d /root/supportflow-backups-deploy-XXXXXXXX)"
chmod 700 "$imf_backup"
cp -a "$imf_unit" "$imf_backup/supportflow.service"
cp -p "$imf_old/.env.local" "$imf_backup/previous.env"
cp -p "$imf_new/.env.local" "$imf_backup/release.env"
chmod 600 "$imf_backup/previous.env" "$imf_backup/release.env"
for imf_name in supportflow-notifications.service supportflow-notifications.timer; do
  if [[ -e "/etc/systemd/system/$imf_name" || -L "/etc/systemd/system/$imf_name" ]]; then
    cp -a "/etc/systemd/system/$imf_name" "$imf_backup/"
  fi
done
(
  cd /tmp
  runuser -u postgres -- "$imf_dump" --no-password --format=custom --port=5432 --dbname=supportflow
) > "$imf_backup/database.dump"
"$imf_restore" --list "$imf_backup/database.dump" > "$imf_backup/archive-index.txt"
echo "SAUVEGARDE_OK : $imf_backup"

imf_timer_active=0
if systemctl is-active --quiet supportflow-notifications.timer; then imf_timer_active=1; fi
imf_changed=0
imf_rollback(){
  local imf_status=$?
  trap - ERR
  if [[ "$imf_changed" == 1 ]]; then
    cp -a "$imf_backup/supportflow.service" "$imf_unit"
    systemctl daemon-reload || true
    systemctl restart supportflow.service || true
    echo 'Retour à la configuration précédente demandé. Vérifier supportflow.service.'
  fi
  if [[ "$imf_timer_active" == 1 ]]; then systemctl start supportflow-notifications.timer || true; fi
  echo "Déploiement interrompu. Sauvegarde : $imf_backup"
  exit "$imf_status"
}
trap imf_rollback ERR
if [[ "$imf_timer_active" == 1 ]]; then systemctl stop supportflow-notifications.timer; fi
imf_worker_state="$(systemctl show supportflow-notifications.service -p ActiveState --value)"
if [[ "$imf_worker_state" == active || "$imf_worker_state" == activating ]]; then
  echo 'Un envoi est en cours. Attendre sa fin puis relancer le script.'
  false
fi

imf_changed=1
python3 <<'PY'
from pathlib import Path
import os, tempfile
path=Path('/etc/systemd/system/supportflow.service')
old='/opt/supportflow/client-release'
new='/opt/supportflow/notifications-release'
text=path.read_text()
if old not in text:
    raise SystemExit('Configuration différente : vérifier les chemins du service.')
metadata=path.stat()
fd,name=tempfile.mkstemp(prefix='.supportflow-',dir=path.parent)
try:
    with os.fdopen(fd,'w') as stream:
        stream.write(text.replace(old,new));stream.flush();os.fsync(stream.fileno())
        os.fchmod(stream.fileno(),metadata.st_mode & 0o777)
        os.fchown(stream.fileno(),metadata.st_uid,metadata.st_gid)
    os.replace(name,path)
finally:
    if os.path.exists(name):os.unlink(name)
PY
restorecon "$imf_unit"
systemctl daemon-reload
[[ "$(systemctl show supportflow.service -p WorkingDirectory --value)" == "$imf_new" ]]
[[ "$(systemctl show supportflow.service -p ExecStart --value)" == *"$imf_new"* ]]
[[ "$(systemctl show supportflow.service -p EnvironmentFiles --value)" != *"$imf_old"* ]]
systemctl restart supportflow.service
curl --noproxy '*' --fail --silent --show-error \
  --retry 15 --retry-connrefused --retry-delay 1 --max-time 15 \
  --output /dev/null --write-out 'LOCAL : HTTP %{http_code}\n' http://127.0.0.1:3101/login
curl --fail --silent --show-error --retry 3 --retry-delay 1 --max-time 20 \
  --output /dev/null --write-out 'HTTPS : HTTP %{http_code}\n' "$imf_public_url/login"
systemctl is-active --quiet supportflow.service
trap - ERR
echo 'APPLICATION_EN_LIGNE — nouvelle version active.'

# From this point a delivery failure leaves the healthy application online.
# No database dump is ever automatically restored over new transactions.
cat > /etc/systemd/system/supportflow-notifications.service <<'UNIT'
[Unit]
Description=Deliver Solumove notifications and password recovery emails
After=network.target
[Service]
Type=oneshot
User=supportflow
Group=supportflow
WorkingDirectory=/opt/supportflow/notifications-release
ExecStart=/opt/supportflow/node22/node_modules/node/bin/node --env-file=.env.local scripts/deliver-notifications.mjs
TimeoutStartSec=5min
MemoryMax=256M
CPUQuota=25%
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
UNIT
cat > /etc/systemd/system/supportflow-notifications.timer <<'UNIT'
[Unit]
Description=Send pending Solumove notifications every minute
[Timer]
OnBootSec=1min
OnUnitInactiveSec=1min
Persistent=true
Unit=supportflow-notifications.service
[Install]
WantedBy=timers.target
UNIT
chmod 644 /etc/systemd/system/supportflow-notifications.service /etc/systemd/system/supportflow-notifications.timer
restorecon /etc/systemd/system/supportflow-notifications.service /etc/systemd/system/supportflow-notifications.timer
systemctl daemon-reload
systemctl start supportflow-notifications.service
systemctl enable --now supportflow-notifications.timer
systemctl show supportflow.service -p WorkingDirectory -p ActiveState
systemctl show supportflow-notifications.service -p Result -p ExecMainStatus
systemctl is-active supportflow-notifications.timer
journalctl -u supportflow-notifications.service -n 12 --no-pager
echo "DEPLOIEMENT_TERMINE — sauvegarde : $imf_backup"
