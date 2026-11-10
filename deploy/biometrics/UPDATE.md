# Face ID / empreinte, notifications obligatoires, modules par client et vue 360°

Cette mise à jour part de `fix/client-notifications` et conserve toutes ses fonctions (comptes clients, MFA, factures, packs, messagerie Postfix/Dovecot). La branche livrée est `claude/prod-biometrie-modules-360`.

## Ce qui change

- **Face ID / empreinte.** Après une première connexion avec mot de passe et authenticator, l’utilisateur enregistre son appareil (passkey). Les connexions suivantes se font par Face ID, empreinte ou code de l’appareil. Le serveur refuse toute connexion par appareil qui n’a pas vérifié son propriétaire, et n’autorise l’enregistrement d’un appareil que depuis une session déjà vérifiée par l’authenticator. La réinitialisation MFA et la réémission d’accès suppriment les appareils du compte.
- **Verrouillage.** Après cinq minutes d’inactivité, l’écran se verrouille et se rouvre par l’appareil enregistré. C’est une protection d’écran ; la session reste contrôlée par le serveur.
- **Notifications obligatoires.** L’espace ne s’ouvre pas tant que l’appareil n’est pas abonné aux notifications. `FORCE_NOTIFICATIONS=false` désactive cette obligation. Sans clés VAPID valides, l’obligation ne s’applique pas.
- **Envoi immédiat.** Les e-mails et notifications partent dès la validation de l’action, sans attendre la minute du timer. Le timer reste nécessaire : il relance les échecs et fait le nettoyage.
- **Modules par client.** L’admin choisit, dans la fiche du client, les rubriques visibles : Tokens & achats, Factures, Support, Demandes, Messagerie, Applications. Le serveur refuse les lectures et actions des rubriques désactivées.
- **Vue 360°.** Dans « Clients & applications », chaque client affiche ses demandes, factures à encaisser, utilisation des mails et des applications, ses utilisateurs (activation, appareils, notifications, dernière activité). La vue d’ensemble liste les points à traiter.
- **Utilisation des applications.** Chaque application reçoit une clé (onglet « Applications & utilisation ») et envoie ses événements à `POST /api/ingest`.
- **Utilisation réelle des mails.** Bouton « Relever l’utilisation réelle » dans Messagerie. Nécessite la mise à jour du broker (étape 6) ; sans elle, seuls les quotas réservés sont affichés.

## Migration

`008_modules_usage.sql` et les tables passkey de Better Auth. Elles ajoutent des colonnes et des tables ; aucune donnée existante n’est modifiée ni supprimée. Tous les modules sont actifs par défaut pour les clients existants.

## Procédure sur le VPS

À exécuter depuis la console root. Ne pas reconstruire dans le dossier utilisé par le service en cours.

### 1. Repérer la version en service

```bash
systemctl show supportflow.service -p WorkingDirectory --value
systemctl cat supportflow-notifications.service 2>/dev/null | grep WorkingDirectory
```

Dans la suite, `OLD` est ce dossier (au moment de la rédaction : `/opt/supportflow/notifications-release`).

### 2. Préparer la nouvelle release à côté

```bash
OLD=/opt/supportflow/notifications-release
NEW=/opt/supportflow/biometrics-release
NODE=/opt/supportflow/node22/node_modules/node/bin
runuser -u supportflow -- git clone --branch claude/prod-biometrie-modules-360 --depth 1 https://github.com/bilyass1/Support.git "$NEW"
install -o supportflow -g supportflow -m 600 "$OLD/.env.local" "$NEW/.env.local"
cd "$NEW"
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm ci
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm run notifications:check
```

`BETTER_AUTH_URL` doit être l’adresse HTTPS publique exacte du portail : les appareils enregistrés sont liés à ce nom de domaine.

### 3. Sauvegarder la base

```bash
BACKUP=$(mktemp -d /root/supportflow-backup-XXXXXXXX)
runuser -u postgres -- pg_dump --format=custom supportflow > "$BACKUP/supportflow.dump"
cp -p /etc/systemd/system/supportflow.service "$BACKUP/"
ls -l "$BACKUP"
```

Vérifier que `supportflow.dump` n’est pas vide avant de continuer.

### 4. Migrer et construire

Les migrations n’ajoutent que des colonnes et des tables : la version en service continue de fonctionner pendant et après cette étape.

```bash
cd "$NEW"
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm run db:migrate
runuser -u supportflow -- env PATH="$NODE:/usr/bin:/bin" npm run build
test -s .next/BUILD_ID && echo BUILD_OK
```

### 5. Basculer le service

```bash
sed -i "s#$OLD#$NEW#g" /etc/systemd/system/supportflow.service
for unit in /etc/systemd/system/supportflow-notifications.service; do [ -f "$unit" ] && sed -i "s#WorkingDirectory=.*#WorkingDirectory=$NEW#" "$unit"; done
systemctl daemon-reload
systemctl restart supportflow.service
sleep 5
curl --noproxy '*' --fail --silent --show-error --max-time 15 --output /dev/null http://127.0.0.1:3101/login && echo SERVICE_OK
```

Si `SERVICE_OK` n’apparaît pas, revenir en arrière :

```bash
cp -p "$BACKUP/supportflow.service" /etc/systemd/system/supportflow.service
systemctl daemon-reload && systemctl restart supportflow.service
```

La base n’a pas besoin d’être restaurée pour revenir à l’ancienne version : elle ignore les colonnes et tables ajoutées.

### 6. Facultatif : relevé de l’utilisation des boîtes mail

Le broker gagne une opération en lecture seule, `usage`, qui mesure le Maildir d’une boîte gérée (taille, nombre de messages, dernier message). Elle ne lance aucune commande, ne suit aucun lien symbolique et refuse toute boîte sans fiche d’état active.

```bash
cd "$NEW/deploy/local-mail" && python3 test_broker.py
cp -p /usr/local/libexec/supportflow-mail/broker.py "$BACKUP/broker.py"
install -o root -g root -m 700 "$NEW/deploy/local-mail/broker.py" /usr/local/libexec/supportflow-mail/broker.py
systemctl restart supportflow-mail.service && systemctl is-active supportflow-mail.service
```

Retour arrière : recopier `$BACKUP/broker.py` au même endroit et redémarrer `supportflow-mail.service`.

## Après la bascule

1. Se connecter avec mot de passe + code, accepter les notifications, puis « Enregistrer cet appareil ».
2. Se déconnecter et se reconnecter avec « Face ID / empreinte ».
3. Dans une fiche client, décocher un module et vérifier depuis le compte du client.
4. Créer une demande de test et vérifier la réception immédiate de l’e-mail et de la notification.

## Non vérifié avant livraison

Ces points n’ont pas pu être testés hors du VPS : Face ID et empreinte sur de vrais téléphones (testé avec un authentificateur simulé dans Chrome), réception d’une notification push réelle, envoi par le SMTP de production, opération `usage` du broker sur de vraies boîtes (testée sur des Maildir de test), et la migration sur une copie des données de production.

## Limites

- Sur iPhone et iPad, les notifications exigent l’ajout de l’application à l’écran d’accueil.
- Un appareil enregistré sur un nom de domaine ne fonctionne pas sur un autre.
- La limite de débit de `/api/ingest` (300 événements par minute et par clé) est tenue en mémoire par le processus.
