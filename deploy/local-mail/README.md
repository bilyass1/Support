# Connecteur Postfix/Dovecot local — installation pilote

Ce connecteur ajoute la création de boîtes et le changement de leur mot de passe
sur le système Linux/PAM existant. Ne pas installer Mailcow ni remplacer Dovecot.
Il n'a pas encore été testé sur le VPS réel : commencer par une adresse jetable.

## Périmètre et limites

- Dovecot : `auth_username_format=%n-%d`, `maildir:~/Maildir:LAYOUT=fs`, PAM.
- Postfix : `virtual_alias_maps=hash:/etc/postfix/virtual`, domaines explicites.
- Compte `local-domaine`, longueur totale maximale de 32 octets, shell nologin.
- Le domaine doit être explicitement autorisé dans un fichier root et déjà configuré
  dans Postfix. Le client ne peut agir que sur son organisation (contrôle serveur).
- Le broker n'accepte que le UID supportflow via SO_PEERCRED sur un socket Unix.
  Il ne reçoit pas de commandes, chemins ou UID venant du client.
- Aucun compte/alias préexistant n'est adopté. Seuls les comptes créés par le broker,
  identifiés par un UUID et leur UID, peuvent changer de mot de passe.
- Les mots de passe passent via le socket local protégé puis stdin de chpasswd;
  ils ne figurent pas dans argv, PostgreSQL, fichiers d'état ou logs du broker.
- **Les quotas affichés sont des allocations, pas des limites disque physiques.**
  Ne pas présenter ce pilote comme un stockage plafonné. Ne pas activer les quotas
  XFS sur la racine en production dans le cadre de cette installation.
- Suspension/réactivation et suppression automatiques non disponibles. Les boutons
  de suspension sont désactivés et le serveur refuse ces opérations.
- Un plafond root `max_accounts` protège contre les créations excessives. Il inclut
  les opérations incomplètes; le plafond de l'application reste applicable aussi.
- Cela ne résout pas les traces de compromission relevées sur le VPS.

## Préparer sans changer l'application active

Récupérer cette branche dans une **copie séparée**, sans copier `.env.local` dans Git.
Vérifier le diff et exécuter typecheck, tests JS et tests Python. Ne pas lancer
deux builds dans `/opt/supportflow/app` pendant que son serveur utilise `.next`.
Faire un snapshot fournisseur et sauvegarder les données PostgreSQL avant migration.

Installation des fichiers du broker en root depuis la copie revue :

```bash
install -d -o root -g root -m 755 /usr/local/libexec/supportflow-mail
install -o root -g root -m 644 deploy/local-mail/broker.py /usr/local/libexec/supportflow-mail/broker.py
install -o root -g root -m 644 deploy/local-mail/supportflow-mail.service /etc/systemd/system/supportflow-mail.service
(umask 077; printf '%s\n' '{"domains":["cimeevents.com"],"max_accounts":20}' > /etc/supportflow-mail.json)
systemctl daemon-reload
systemctl start supportflow-mail
systemctl status supportflow-mail --no-pager
```

Cela démarre seulement le broker. Il ne crée aucun compte au démarrage. Ne pas
activer le démarrage automatique avant validation. Les chemins des outils sont
spécifiques à EL9; vérifier notamment `/usr/bin/doveconf` et `/usr/sbin/chpasswd`.

Dans l'environnement **de la copie de test uniquement**, ajouter :

```dotenv
LOCAL_MAIL_SOCKET=/run/supportflow-mail/broker.sock
```

La copie de test utilise sa propre base PostgreSQL migrée et son propre port,
avec une origine HTTPS de test correctement configurée pour Better Auth.
Ne pas activer le domaine sur l'application production à ce stade.

## Validation réelle nécessaire

1. Ajouter le domaine cimeevents.com à l'organisation cliente, fournisseur
   Postfix/Dovecot. La vérification refuse un domaine hors allowlist ou une
   configuration Postfix/Dovecot différente de celle attendue.
2. Si des boîtes sont déjà associées au domaine dans Support, le changement de
   fournisseur reste interdit. Ne pas contourner ce contrôle avec du SQL.
3. Créer une adresse jetable inexistante avec un mot de passe privé de 12+ caractères.
4. Confirmer l'état actif, le compte nologin et l'alias, puis tester IMAP 993 TLS,
   SMTP 587 STARTTLS, réception depuis un domaine externe et réponse depuis Outlook.
5. Tester une nouvelle adresse depuis une autre organisation : refus.
6. Tester une boîte préexistante : aucun changement de compte/alias/mot de passe.
7. Changer le mot de passe de la boîte pilote et vérifier le refus de l'ancien.
8. Vérifier que les sites et boîtes existants fonctionnent et que les journaux
   ne contiennent aucun mot de passe. Ne pas activer le logging des corps HTTP.

Le hostname Outlook attendu est mail.solumove.net, identifiant adresse complète,
IMAP 993 SSL/TLS, SMTP 587 STARTTLS avec authentification. Vérifier réellement le
certificat, DNS et les ports, pas uniquement l'affichage dans Support.

## Erreurs et retour arrière

Toute réponse incertaine laisse une opération « à vérifier » dans Support. Pas de
nouvelle tentative automatique. Le broker conserve un état creating avant les
mutations et une sauvegarde du fichier virtual; un crash peut laisser un compte
verrouillé, un alias ou une boîte non utilisable. Faire vérifier l'état par l'admin
avant confirmation ou annulation. Ne pas supprimer des fichiers d'état pour
forcer une nouvelle tentative; ne pas publier leurs contenus ou hashes de passwords.

Durant le pilote, ne pas modifier manuellement les maps en parallèle : le broker
sérialise ses propres opérations, pas celles d'autres outils root. Le remplacement
de la source et de sa base hash n'est pas une transaction distribuée.

Pour désactiver le connecteur, stopper uniquement supportflow-mail, retirer
LOCAL_MAIL_SOCKET de la copie de test et désactiver les demandes du domaine. Les
comptes et messages déjà créés sont conservés. Ne pas restaurer globalement les
maps si elles ont reçu d'autres modifications; retirer uniquement l'entrée pilote
après sauvegarde et recompiler la map sous contrôle de l'administrateur.

Après tests réussis, planifier un déploiement de Support avec une copie de build
séparée, migration additive 003 et redémarrage de Support uniquement. L'installation
ne requiert pas de restart Dovecot/Postfix mais modifie des comptes Linux et aliases
partagés; elle ne peut pas garantir zéro effet sur toute la production.
