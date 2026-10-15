# Mise à jour clients, première connexion et factures privées

Cette release se superpose à feature/advanced-support-platform déjà en production. Elle garde Apache, PostgreSQL, le broker mail, les comptes existants, leurs mots de passe et leurs authenticators.

## Utilisation

L’admin ouvre Clients & applications et crée une raison sociale, contact, email de connexion, matricule fiscal, adresse, téléphone et domaine principal facultatif. Le mot de passe temporaire (12 caractères minimum) peut être généré dans le navigateur. Le noter avant validation et le transmettre par un canal privé : il n’est jamais conservé en clair, ni renvoyé ensuite, ni journalisé. La création du compte Better Auth, de l’organisation, du portefeuille, de l’appartenance et de l’obligation de changement est une seule transaction. Un email déjà inscrit est refusé sans récupération de ce compte.

Le client se connecte, remplace le mot de passe temporaire, puis configure Authenticator et conserve ses codes de secours. Les API de données restent bloquées jusqu’à la fin de ces étapes. Un mot de passe personnel identique au temporaire est refusé dans ce parcours. Les anciens comptes actifs gardent leur accès : leur authenticator n’est pas réinitialisé. L’inscription publique est fermée ; les anciennes associations restent possibles via le panneau dédié. Les comptes ayant un ancien rôle manager ne reçoivent plus le back-office global : leur accès se limite à leur éventuelle organisation. Les rôles admin existants gardent leurs droits.

Dans Sécurité, l’admin peut aussi réémettre un mot de passe temporaire après vérification d’identité, motif et confirmation de son propre mot de passe. Cela révoque les sessions, impose un nouveau changement de mot de passe et conserve le MFA existant. La réinitialisation du MFA est une action séparée. Chaque utilisateur peut changer son mot de passe personnel depuis le même onglet.

Le domaine principal est une coordonnée du client. Pour créer des emails, configurer aussi le domaine dans Messagerie & Outlook et dans l’allowlist du broker root ; aucun DNS ni compte mail serveur n’est créé par le formulaire client.

La vue générale admin regroupe les clients, activation des comptes, achats à valider, factures ouvertes, support, packs, boîtes gérées et derniers événements. Les clients voient uniquement leur organisation et leurs coordonnées fiscales. Compléter les coordonnées des clients existants avant d’émettre de nouvelles factures ou d’approuver un achat, puisque la facture en conserve un instantané. Les anciennes factures ne sont pas modifiées rétroactivement.

Dans Factures, émettre la fiche de facturation avec client/montant/échéance, puis déposer le PDF dans cette fiche (10 Mo maximum). Le fichier est privé, téléchargé comme pièce jointe, jamais servi dans public et non écrasable. Le client propriétaire et l’admin seuls peuvent le télécharger ; une notification est créée. La validation vérifie taille et signature PDF, sans analyse antivirus ou validation fiscale du contenu. Faire valider les documents avant leur usage comptable.

Le logo original transparent remplace les anciens pictogrammes du navigateur, de la PWA et de l’écran d’accueil. Les variantes PNG proviennent du rendu de l’icône SVG qui embarque le logo original. Une PWA déjà installée peut conserver son ancienne icône jusqu’à rafraîchissement de son manifeste ou réinstallation par l’utilisateur. Le navigateur ne permet pas à un site de forcer une mise à jour d’icône du système.

## Déployer dans une release séparée

```bash
runuser -u supportflow -- git clone --branch feature/admin-client-onboarding --single-branch https://github.com/bilyass1/Support.git /opt/supportflow/client-release
runuser -u supportflow -- cp -p /opt/supportflow/advanced-release/.env.local /opt/supportflow/client-release/.env.local
chmod 600 /opt/supportflow/client-release/.env.local
install -d -o supportflow -g supportflow -m 700 /opt/supportflow/private-invoices
```

INVOICE_STORAGE_DIR peut rester absent : le chemin par défaut est /opt/supportflow/private-invoices. Si configuré, utiliser un dossier privé persistant hors des répertoires de release et public. Le sauvegarder avec la base, les fichiers et leur correspondance en base sont nécessaires ensemble. Le répertoire courant ne contient aucun document client dans Git.

Installer et construire la copie, sans toucher au service actuel :

```bash
systemd-run --unit=supportflow-client-build --wait --pipe --collect -p User=supportflow -p WorkingDirectory=/opt/supportflow/client-release -p MemoryMax=1024M -p MemorySwapMax=256M -p CPUQuota=50% -p Nice=10 --setenv=HOME=/opt/supportflow --setenv=PATH=/opt/supportflow/node22/node_modules/node/bin:/opt/supportflow/runtime/bin:/usr/bin:/bin /bin/bash -c 'npm ci --include=optional && npm run typecheck && npm test && npm run build'
```

Après succès : nouveau dump horodaté vérifié, copie du service et de .env.local, puis arrêt uniquement de supportflow. Lancer npm run db:migrate dans client-release avec le même PATH ; la migration 007 ajoute les coordonnées, suivi d’onboarding et fichiers privés. Si elle échoue, ne pas modifier le service et redémarrer l’ancienne application. Si elle réussit, remplacer /opt/supportflow/advanced-release par /opt/supportflow/client-release dans WorkingDirectory et ExecStart, daemon-reload puis start. Vérifier les deux HTTP 200, compte admin, création d’un client pilote, changement obligatoire de mot de passe, MFA, fiche fiscale et téléchargement de son PDF. Garder la console ouverte.

Si le worker notifications est déjà installé, ajuster également son WorkingDirectory vers client-release et recharger systemd après validation. Ne pas lancer un second timer. Le port 3101 et la configuration Apache ne changent pas.

Retour arrière : arrêter supportflow et le timer s’il est installé, rétablir la copie du service précédente, daemon-reload puis start. Les changements SQL sont additifs. Un retour à l’ancienne application retire la nouvelle obligation de première connexion côté API : ne pas rouvrir les nouveaux comptes temporaires au public avant correction. Aucun dump ne doit écraser silencieusement les écritures postérieures. Les PDF restent dans leur dossier persistant.
