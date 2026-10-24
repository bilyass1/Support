# Associer les deux boîtes IMF existantes

Sur le VPS mail **Oxahost 102.211.210.97**, les comptes déjà créés sont :

| Adresse | Identifiant Unix | Répertoire conservé |
| --- | --- | --- |
| contact@imf-immobiliere.tn | contact-imf-immobiliere.tn | /home/imf_contact |
| info@imf-immobiliere.tn | info-imf-immobiliere.tn | /home/imf_info |

Leurs alias existants visent ces utilisateurs à `mail.solumove.net`. L’import standard attendait des homes portant les nouveaux identifiants et des alias `@localhost`. Le nouveau paramètre root `--allow-existing-layout` permet de conserver ces homes et routes, après vérification des UID, du shell nologin, de chaque répertoire Maildir sans lien symbolique, du hostname local et des maps source/compilée. Il enregistre ces identités exactes dans l’état root du broker pour autoriser les futurs changements de mot de passe. Aucun mot de passe existant n’est lu ou remplacé par l’import.

Le site `imf-immobiliere.tn` reste sur le VPS OVH. Les données de messagerie et le broker restent sur le VPS mail. Le connecteur Unix local exige que l’application SupportFlow et le broker résident sur le même VPS, conformément à l’installation Solumove décrite dans ce dépôt.

## Installer le broker et l’importeur mis à jour

Utiliser une copie revue du dépôt, appartenant à root et non modifiable par le compte web. Depuis son répertoire :

```bash
install -o root -g root -m 700 deploy/local-mail/broker.py /usr/local/libexec/supportflow-mail/broker.py
install -o root -g root -m 700 deploy/local-mail/import_existing.py /usr/local/libexec/supportflow-mail/import_existing.py
```

Conserver `/etc/supportflow-mail.json` et ses domaines existants. Y ajouter uniquement `imf-immobiliere.tn` à l’allowlist root. Contrôler `max_accounts` en comptant les boîtes déjà gérées, puis les deux imports et les futures places réservées au client ; l’import refuse une capacité insuffisante. Ne pas effacer les états des autres clients pour libérer de la place. Redémarrer uniquement `supportflow-mail` après cette mise à jour.

Le domaine doit déjà figurer dans `virtual_alias_domains`, comme dans les sorties serveur communiquées. MX, SPF, DKIM et DMARC ne sont pas modifiés. Aucun redémarrage Postfix ou Dovecot n’est nécessaire pour cet import.

## Sélectionner le client existant et l’admin

La base distante n’a pas été modifiée depuis cet environnement. Obtenir les identifiants dans la console du VPS, puis sélectionner **le client IMF existant**, jamais une organisation créée arbitrairement :

```bash
runuser -u postgres -- psql -X -P pager=off -d supportflow -c 'SELECT o.id,o.name,u.email FROM organizations o JOIN memberships m ON m.organization_id=o.id JOIN "user" u ON u.id=m.user_id ORDER BY o.name;'
runuser -u postgres -- psql -X -P pager=off -d supportflow -c 'SELECT r.user_id,u.email FROM app_roles r JOIN "user" u ON u.id=r.user_id WHERE r.role=$$admin$$;'
```

Renseigner `IMF_ORG_ID` et `IMF_ADMIN_ID` dans la console avec ces identifiants. Un abonnement actif du client est requis. Fixer les plafonds du pack conformément à l’offre du client ; l’exemple suivant réserve 10 boîtes et 10000 Mo, dont 1000 Mo par boîte. L’import conserve le prix, les tokens, les règles, le coût de création et l’échéance de l’abonnement actuel. Il ne facture pas les deux boîtes déjà existantes.

```bash
python3 /usr/local/libexec/supportflow-mail/import_existing.py \
  --organization "$IMF_ORG_ID" --actor "$IMF_ADMIN_ID" \
  --domain imf-immobiliere.tn --mailboxes contact,info \
  --max-mailboxes 10 --total-mb 10000 --per-box-mb 1000 \
  --allow-existing-layout
```

Vérifier le nom du client, les deux adresses, les homes affichés et `DRY RUN OK`. Relancer cette même commande avec `--apply` pour réaliser l’import. Elle sauvegarde la base et les états/maps, revérifie les comptes et applique l’association dans une transaction. Les protections, les reprises et les limites sont décrites dans [IMPORT-EXISTING.md](IMPORT-EXISTING.md).

Après `IMPORT OK`, le client voit les deux adresses dans « Messagerie & Outlook », peut créer de nouvelles boîtes dans les limites de son pack, et changer le mot de passe de ses propres boîtes. Connexion Outlook : identifiant email complet, `mail.solumove.net`, IMAP 993 TLS et SMTP 587 STARTTLS. Les Mo affichés restent des allocations commerciales ; aucun quota physique Dovecot n’est créé.

Ce guide et les tests locaux préparent l’import. Ils ne prouvent pas que l’association est déjà appliquée à votre base de production, ni que l’envoi/réception réels ont été testés après la mise à jour.

## Conserver exactement la formule du client

Si le client possède déjà les plafonds nécessaires, passer `--preserve-subscription` à l’importeur avec **les mêmes valeurs** que son snapshot actif. Il refuse une différence et ne crée ni formule dédiée ni mise à jour d’abonnement. `--expected-email` vérifie également l’identité de connexion sélectionnée. Les crédits et mots de passe restent conservés.

Le contrôleur root `import-client.py` automatise la préparation et cet import sans modification de formule. Il reçoit les identifiants du client et de l’admin uniquement en paramètres sur le VPS. Il vérifie le client, les comptes Unix et les routes existantes avant d’installer le connecteur dans son répertoire root protégé. Il conserve les domaines déjà autorisés et leur capacité, ajoute uniquement le domaine demandé et réserve sa capacité actuelle. L’importeur conserve son fonctionnement en transaction avec sauvegardes. Le socket local est configuré dans la release active seulement si nécessaire.

L’aperçu est le comportement par défaut ; `--apply` réalise l’action autorisée. Utiliser une révision GitHub complète et immuable pour `--source-ref`, identique à celle du contrôleur téléchargé. Le contrôleur ne reconstruit pas Next.js et ne change pas les mots de passe. Après `IMPORT_TERMINE` et `CONNECTEUR_OK`, le client retrouve ses adresses et les actions existantes « Changer le mot de passe » et « Paramètres Outlook ».
