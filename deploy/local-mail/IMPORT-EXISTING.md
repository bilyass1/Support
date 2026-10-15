# Import administrateur des boîtes Postfix existantes

`import_existing.py` est une commande **root uniquement**, non exposée au socket ou à l’application. Le broker web continue de refuser l’adoption de comptes existants. La commande vérifie les comptes Linux nologin, UID, home et répertoires Maildir sans lien symbolique, le routage source et compilé, l’allowlist et les identités existantes du broker. Aucun mot de passe n’est lu ou changé, aucun compte Unix ni message n’est créé/supprimé. Le mode par défaut ne modifie rien.

Pour Cime Events : importer uniquement contact, director, events, editor, acc, designer, it, cm. Le compte sf-test01 reste sur le VPS, hors de cette liste et hors du pack applicatif. Les deux alias absents it/cm sont ajoutés seulement s’ils ne remplacent aucune route existante ; les autres routes restent intactes.

La commande attribue au client une formule dédiée de 10 boîtes, 10000 Mo au total et 1000 Mo par boîte, à partir des valeurs de son abonnement actuel. Prix, devise, tokens, règles et coût de création des futures boîtes sont conservés. L’échéance, le portefeuille, le journal des tokens et les autres formules ne changent pas. Les huit imports ne sont pas facturés en tokens ; les deux places suivantes suivent le coût de création configuré dans la formule et l’abonnement doit rester actif. Les quotas sont des allocations commerciales : aucun quota physique Dovecot n’est ajouté par ce script.

Les UUID des boîtes déjà connues du broker sont réutilisés après vérification de l’UID et de la phase active. Les identités nouvelles sont enregistrées dans /var/lib/supportflow-mail pour permettre au propriétaire de réinitialiser son mot de passe depuis SupportFlow. Une boîte déjà gérée par une autre organisation, un autre fournisseur, un UID différent ou une opération inachevée bloque l’import.

## Installation et aperçu

Installer **à côté du broker root existant**, jamais exécuter un fichier modifiable par le compte web en tant que root :

```bash
install -o root -g root -m 700 /opt/supportflow/mail-import/deploy/local-mail/import_existing.py /usr/local/libexec/supportflow-mail/import_existing.py
python3 /usr/local/libexec/supportflow-mail/import_existing.py --organization "$CLIENT_ORG_ID" --actor "$ADMIN_USER_ID" --domain cimeevents.com --mailboxes contact,director,events,editor,acc,designer,it,cm --max-mailboxes 10 --total-mb 10000 --per-box-mb 1000
```

Vérifier le client, les huit adresses et `DRY RUN OK`. Si un compte manque de Maildir ou a une identité inattendue, ne pas remplacer ces protections : examiner son état avant correction.

## Application

Relancer la même commande avec `--apply`. Le script crée et vérifie un dump de la base, conserve source/compilé Postfix, états broker et SQL dans un nouveau dossier privé /root/supportflow-backups/mail-import-*. Seul le broker de provisionnement est brièvement arrêté ; Postfix, Dovecot et les sites ne sont pas arrêtés. Les identités sont revérifiées. Les alias sont reconstruits dans des fichiers temporaires et installés avec leurs labels SELinux. Une transaction verrouille l’organisation et contrôle la stabilité de son abonnement et de ses boîtes avant d’ajouter pack, domaine et fiches actives. Les paramètres Outlook sont mail.solumove.net, IMAP 993 TLS et SMTP 587 STARTTLS ; identifiant complet, mot de passe existant.

Il n’existe pas de transaction unique entre PostgreSQL et les fichiers système. Si une étape échoue, le broker est redémarré et les éléments système déjà vérifiés sont conservés comme preuve pour éviter une annulation aveugle après un résultat SQL incertain. Consulter le dossier de sauvegarde et refaire **l’aperçu** avant toute reprise. Une relance après réussite ne multiplie ni les comptes ni la formule dédiée. Aucun mot de passe ni contenu de message ne figure dans les sauvegardes propres au script (le dump normal de la base contient les hashes des comptes applicatifs, comme toute sauvegarde d’authentification).

## Vérification de réception et d’envoi

Après `IMPORT OK`, vérifier le broker actif, les huit alias avec postmap -q, les huit fiches actives du domaine appartenant à Aref et la limite 10. Le client doit voir les paramètres Outlook et pouvoir gérer ses propres boîtes.

Effectuer un test réel depuis une adresse externe vers les boîtes, puis une réponse via Outlook et soumission authentifiée. Vérifier MX, A du serveur, PTR, SPF, DKIM et DMARC, et les logs Postfix/Dovecot. SPF et DKIM PASS ne garantissent pas le placement en inbox : vérifier l’authentification dans les en-têtes reçus et surveiller réputation/retours, sans envoyer de vagues de messages de test. Les recommandations Gmail exigent notamment DNS direct/inverse et TLS : https://support.google.com/mail/answer/81126.

Le script ne change pas MX, SPF, DKIM, DMARC, PTR, pare-feu ni configuration globale des services SMTP/IMAP. Un PTR se règle chez l’hébergeur. Ne pas déduire de `IMPORT OK` qu’un test externe d’envoi/réception a déjà été réalisé.
