# Mise à jour « Surveillance, rappels, chiffres et connexions mail »

## Ce que la mise à jour ajoute

- **Sites surveillés.** L’admin enregistre l’adresse du site d’un client. Le serveur la contrôle toutes les cinq minutes : un site est déclaré indisponible après deux échecs de suite, le client et l’équipe sont notifiés une fois, puis à son retour. Disponibilité sur 30 jours, temps de réponse, expiration du certificat SSL (lue automatiquement) et du nom de domaine (saisie à la main). Visible par le client dans « Applications & utilisation ».
- **Rappels automatiques.** Formule (30 et 7 jours avant l’échéance), nom de domaine (30 et 7 jours), certificat SSL (14 et 3 jours), facture échue. Chaque rappel part une seule fois.
- **Chiffres.** Onglet admin : encaissements par mois, montant à encaisser, demandes créées et clôturées, tokens consommés, délai moyen de première réponse, satisfaction.

- **Dernière connexion aux boîtes mail.** Le broker lit dans le journal Dovecot la dernière connexion IMAP ou POP3 de chaque boîte gérée (45 jours). Affichée par boîte et dans la fiche client ; alerte « aucune connexion depuis 30 jours ». Si le journal ne peut pas être lu, la valeur reste « non mesurée » au lieu d’annoncer une boîte inutilisée.

Seules des adresses publiques en http(s) sont acceptées ; une adresse IP, un nom interne ou un nom qui se résout vers un réseau privé est refusé au moment du contrôle. Un site qui répond avec un code inférieur à 500 est considéré en ligne : la surveillance mesure que le serveur répond, pas que la page est correcte. La date d’expiration d’un domaine n’est pas lue automatiquement.

## Migration

`010_monitoring.sql` crée trois tables et `011_mail_logins.sql` ajoute deux colonnes. Aucune donnée existante n’est modifiée.

## Procédure sur le VPS

```bash
OLD=$(systemctl show supportflow.service -p WorkingDirectory --value)
NEW=/opt/supportflow/monitoring-release
NODE=/opt/supportflow/node22/node_modules/node/bin
runuser -u supportflow -- git clone --branch claude/prod-biometrie-modules-360 --depth 1 https://github.com/bilyass1/Support.git "$NEW"
install -o supportflow -g supportflow -m 600 "$OLD/.env.local" "$NEW/.env.local"
cd "$NEW" && runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm ci
BACKUP=$(mktemp -d /root/supportflow-backup-XXXXXXXX)
runuser -u postgres -- pg_dump --format=custom supportflow > "$BACKUP/supportflow.dump"
cp -p /etc/systemd/system/supportflow.service "$BACKUP/"; ls -l "$BACKUP"
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm run db:migrate
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm run build
test -s .next/BUILD_ID && echo BUILD_OK
```

Bascule, une fois `BUILD_OK` affiché :

```bash
sed -i "s#$OLD#$NEW#g" /etc/systemd/system/supportflow.service
[ -f /etc/systemd/system/supportflow-notifications.service ] && sed -i "s#WorkingDirectory=.*#WorkingDirectory=$NEW#" /etc/systemd/system/supportflow-notifications.service
sed "s#WorkingDirectory=.*#WorkingDirectory=$NEW#" "$NEW/deploy/monitoring/supportflow-monitor.service" > /etc/systemd/system/supportflow-monitor.service
cp "$NEW/deploy/monitoring/supportflow-monitor.timer" /etc/systemd/system/
systemctl daemon-reload && systemctl restart supportflow.service && sleep 6
curl --noproxy '*' --fail --silent --show-error --max-time 15 --output /dev/null http://127.0.0.1:3101/login && echo SERVICE_OK
systemctl enable --now supportflow-monitor.timer
systemctl start supportflow-monitor.service; journalctl -u supportflow-monitor.service -n 3 --no-pager
```

Broker (connexions mail), après la bascule :

```bash
cd "$NEW/deploy/local-mail" && python3 test_broker.py 2>&1 | tail -3
cp -p /usr/local/libexec/supportflow-mail/broker.py "$BACKUP/broker.py"
install -o root -g root -m 700 "$NEW/deploy/local-mail/broker.py" /usr/local/libexec/supportflow-mail/broker.py
systemctl restart supportflow-mail.service && systemctl is-active supportflow-mail.service
```

Retour arrière : recopier `$BACKUP/supportflow.service`, `systemctl daemon-reload && systemctl restart supportflow.service`, puis `systemctl disable --now supportflow-monitor.timer`.

## Non vérifié avant livraison

Le contrôle réel d’un site depuis le VPS (réseau sortant, pare-feu, SELinux) et la lecture d’un vrai certificat : la logique a été testée avec des réponses simulées et le script a tourné sur PostgreSQL 16 hors du VPS. La lecture du journal Dovecot par le broker est testée avec des sorties simulées, pas sur le vrai journal.
