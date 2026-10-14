# Mise à niveau sur le VPS Solumove

Cette version reste sur CentOS Stream 9, Apache, PostgreSQL 16 et Node.js 22.12 minimum. Aucune migration vers Vercel. Le code livré ne modifie pas le serveur à distance.

## Fonctionnalités

- Packs : tokens annuels, nombre de boîtes, stockage total alloué, plafond par boîte et coût de création en tokens. Tous les domaines d’un client partagent le même plafond.
- Création et changement de mot de passe via le broker Postfix/Dovecot existant, avec domaine autorisé et identité Unix vérifiée. Les mots de passe mail ne sont pas conservés par l’application.
- Courbe de consommation, demandes d’achat avec prix figé côté serveur, crédit uniquement après confirmation administrative du paiement, une seule fois.
- Factures imprimables et notifications, tickets de support gratuits et demandes de modification facturées en tokens. Seul l’admin ajoute les sites et applications.
- Authenticator obligatoire pour tous, QR local, codes de secours et vérification à chaque nouvelle connexion. Les anciennes sessions sans preuve MFA sont refusées. L’admin peut réinitialiser le MFA d’un client après vérification d’identité, motif et confirmation de son mot de passe ; les sessions du client sont révoquées.
- Mot de passe oublié, lien valable 30 minutes et révocation des sessions après changement. Messages envoyés par contact@solumove.net via une file chiffrée.
- Logo Solumove, mode clair et bleu nuit, PWA avec installation proposée et Web Push sur les appareils compatibles. L’utilisateur et le navigateur doivent autoriser installation et notifications ; elles ne peuvent pas être forcées.

## Préparer une release séparée

Ne pas reconstruire dans le répertoire en cours de service. Depuis la console root du VPS :

```bash
runuser -u supportflow -- git clone --branch feature/advanced-support-platform --single-branch https://github.com/bilyass1/Support.git /opt/supportflow/advanced-release
runuser -u supportflow -- cp -p /opt/supportflow/mail-staging/.env.local /opt/supportflow/advanced-release/.env.local
chmod 600 /opt/supportflow/advanced-release/.env.local
```

Conserver exactement DATABASE_URL et BETTER_AUTH_SECRET de production. BETTER_AUTH_URL doit être https://support.solumove.net. LOCAL_MAIL_SOCKET reste /run/supportflow-mail/broker.sock. Ne pas utiliser la base supportflow_test pour cette release.

Entrer les paramètres SMTP dans le fichier local avec un éditeur sur le VPS, sans publier le fichier : SMTP_HOST=mail.solumove.net, SMTP_PORT=587, SMTP_USER=contact@solumove.net, SMTP_PASSWORD=<mot de passe de cette boîte>. Cette boîte doit déjà exister. Le worker exige STARTTLS avec vérification du certificat. Ne pas réutiliser le mot de passe admin.

Installer les dépendances avec les mêmes limites temporaires utilisées pour les builds précédents :

```bash
systemd-run --unit=supportflow-advanced-install --wait --pipe --collect -p User=supportflow -p WorkingDirectory=/opt/supportflow/advanced-release -p MemoryMax=1024M -p MemorySwapMax=256M -p CPUQuota=50% -p Nice=10 --setenv=HOME=/opt/supportflow --setenv=PATH=/opt/supportflow/node22/node_modules/node/bin:/opt/supportflow/runtime/bin:/usr/bin:/bin /opt/supportflow/runtime/bin/npm ci --include=optional
```

Dans ce répertoire, avec ce PATH : exécuter npm run typecheck, npm test puis npm run build sous les mêmes limites. Les tests utilisent une base embarquée ; ne pas lancer les tests navigateur contre la production. Le build doit réussir avant toute bascule.

Générer les clés Web Push une fois après installation :

```bash
runuser -u supportflow -- sh -c 'cd /opt/supportflow/advanced-release && /opt/supportflow/node22/node_modules/node/bin/node -e "console.log(require(\"web-push\").generateVAPIDKeys())"'
```

Renseigner VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans .env.local. Garder la clé privée sur le serveur.

## Sauvegarde, migration et bascule

Prévoir une courte interruption de SupportFlow ; les autres sites et services mail ne nécessitent pas de redémarrage.

1. Sauvegarder avec un nom horodaté le dump PostgreSQL supportflow, le fichier .env.local et /etc/systemd/system/supportflow.service dans /root/supportflow-backups, permissions 700/600. Vérifier que le dump est lisible avec pg_restore --list. Conserver l’ancien répertoire.
2. Après build réussi, arrêter uniquement supportflow puis lancer npm run db:migrate dans advanced-release avec son environnement et Node 22. Cette migration ajoute les tables Better Auth MFA et les migrations SQL 004 à 006, sans recréer les données existantes.
3. Modifier uniquement WorkingDirectory et le chemin de l’application dans ExecStart de supportflow.service vers /opt/supportflow/advanced-release. Garder le port 3101 et l’adresse 127.0.0.1. systemctl daemon-reload puis systemctl start supportflow.
4. Vérifier HTTP 200 sur http://127.0.0.1:3101/login et https://support.solumove.net/login, puis inscription MFA de l’admin, connexion suivante, client et permissions. Conserver les codes de secours hors du VPS. Ne pas fermer la console avant cette vérification.
5. Dans les modèles deploy/notifications, remplacer /opt/supportflow/current par /opt/supportflow/advanced-release. Installer le service et le timer dans /etc/systemd/system, daemon-reload, lancer une fois supportflow-notifications.service et consulter son statut avant enable --now supportflow-notifications.timer. Le timer traite les messages toutes les minutes ; surveiller les échecs affichés dans Sécurité et journald.
6. Paramétrer l’émetteur des factures, les offres et les packs. Réattribuer les nouveaux packs aux clients existants : leurs anciens snapshots ne contiennent pas les nouveaux plafonds. Configurer le domaine cimeevents.com et les hôtes Outlook mail.solumove.net.
7. Tester un lien de récupération réellement reçu, une notification sur chaque type d’appareil et une boîte pilote avec Outlook. L’activation des achats doit suivre la vérification de l’émetteur des factures et du processus de paiement manuel.

En cas d’échec avant ouverture aux utilisateurs : arrêter le timer et supportflow, rétablir la copie du service et l’ancien répertoire, daemon-reload puis démarrer. Les migrations sont additives ; éviter une restauration de base qui écraserait des transactions nouvelles. Une restauration du dump nécessite une fenêtre contrôlée après vérification de toutes les écritures depuis la sauvegarde. Ne pas restaurer automatiquement.

## Limites à connaître

- Les Mo configurés sont des réservations commerciales, pas une limitation disque Dovecot. Le VPS actuel a XFS noquota et aucun plugin quota Dovecot : un plafond physique nécessite un chantier distinct et validé pour préserver les boîtes existantes. Ne pas annoncer aux clients que le disque est déjà bloqué au quota.
- Le broker root garde sa limite indépendante max_accounts=20 et son allowlist cimeevents.com. Ajuster sa configuration administrativement après vérification ; l’interface ne peut pas autoriser un autre domaine toute seule. Le connecteur local ne suspend ni ne supprime les boîtes existantes.
- Les factures sont des documents de montant total, sans ventilation fiscale complète. Faire valider les mentions, TVA et numérotation légale avant leur usage comptable. Aucun prestataire de paiement ni prélèvement automatique n’est raccordé.
- Les notifications ont des tentatives bornées et peuvent être dupliquées après interruption. Pas de données privées dans les notifications push et pas de cache hors ligne des comptes.
- Le service applicatif garde les limites actuelles 768M et CPUQuota=100% (un cœur, soit 50% des deux CPU). Cela n’est pas une limite à 10% du VPS. Le worker ajoute une limite 256M/25% d’un cœur. Les limites ne sont pas des réservations ; mesurer l’usage avant réduction.
- L’ancien service suspect defunct.service et le binaire sshd non empaqueté étaient des signes nécessitant une investigation. Les protections applicatives ne rétablissent pas la confiance dans un VPS compromis. Ce chantier ne conclut pas cet audit.

## Validation livrée

56 tests applicatifs réussis, contrôle TypeScript réussi et 10 tests du broker réussis. Tests de transactions PostgreSQL embarquées, MFA réel Better Auth, chiffrement de récupération, isolation client, achats idempotents et réservations mail. Le build de production, les migrations PostgreSQL 16 et le scénario navigateur MFA avec captures clair/sombre ont réussi dans GitHub Actions (run 38657129705). Le build local reste bloqué par le runtime de cet environnement (uv_resident_set_memory), ce qui ne se reproduit pas dans le runner CI. SMTP réel, push et déploiement production restent à valider sur le serveur.
