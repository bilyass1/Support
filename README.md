# SupportFlow — première base de l’application

Projet Next.js / React / PostgreSQL pour gérer des clients, leurs applications, des demandes de développement et un portefeuille de crédits commerciaux (« tokens »). Ces crédits représentent votre service ; ils ne représentent pas les tokens facturés par un modèle d’IA.

## Stack

| Usage | Technologie |
| --- | --- |
| Application et API | Next.js 16.4.6, App Router, Node.js 22+ |
| Interface | React 19, CSS responsive (barre d’onglets sur mobile), Lucide |
| Authentification | Better Auth 1.7.7 : mot de passe, 2FA TOTP obligatoire, passkeys (Face ID / empreinte) |
| Base de données | PostgreSQL, pilote `pg`, SQL paramétré |
| E-mails / push | Nodemailer (SMTP), Web Push (VAPID) |
| Tests | Vitest + PostgreSQL embarqué PGlite |

## Fonctionnalités

**Sécurité**
- Double authentification obligatoire : à la première connexion, l’utilisateur scanne un QR code avec une application d’authentification, puis reçoit dix codes de secours. Aucune donnée n’est servie par l’API tant que la 2FA n’est pas active.
- Après cette première connexion, l’appareil s’enregistre comme passkey : les connexions suivantes se font par Face ID, empreinte ou Windows Hello, sans mot de passe ni code.
- Verrouillage après cinq minutes d’inactivité, déverrouillage biométrique. Ce verrou protège l’écran ; la session reste gérée par le serveur.
- Sessions actives et appareils consultables et révocables, changement de mot de passe, mot de passe oublié par e-mail.

**Notifications et e-mails**
- Chaque événement (nouvelle demande, estimation, acceptation, changement de statut, message, recharge, facture, paiement, annonce) crée une notification dans l’application, un e-mail et une notification push pour chaque destinataire, envoyés dès la validation de l’action.
- Les notifications push sont obligatoires : l’espace ne s’ouvre pas tant que l’appareil ne les a pas autorisées (`FORCE_NOTIFICATIONS=false` pour désactiver). Sur iPhone/iPad, l’application doit d’abord être ajoutée à l’écran d’accueil.
- File d’envoi en base avec cinq tentatives, journal consultable dans Administration → Envois.

**Modules par client**
- L’admin choisit, client par client, les modules visibles : Demandes, Crédits, Messagerie, Facturation, Applications. Le menu et l’API appliquent ce choix : un module désactivé ne renvoie aucune donnée et refuse toute action.

**Vue 360° pour l’équipe**
- Fiche client : formule et échéance, crédits, demandes et satisfaction, factures, messagerie, applications, utilisateurs du portail et leur dernière activité, coordonnées de facturation.
- Points d’attention calculés : formule absente, expirée ou proche de l’échéance, crédits bas, facture en retard, première réponse hors délai, boîte mail presque pleine, application silencieuse depuis sept jours.
- Utilisation des applications : chaque application reçoit une clé et envoie ses événements à `POST /api/ingest` ; sessions, utilisateurs distincts par jour, erreurs, version et dernière activité sur 30 jours.
- Utilisation de la messagerie : stockage réellement utilisé, nombre de messages et dernière connexion par boîte, relevés depuis Mailcow. Les domaines en mode manuel n’ont pas de mesure réelle.
- Journal d’audit consultable et filtrable.

**Support et facturation**
- Tickets : priorité, responsable, délai de première réponse (4 h urgente, 8 h haute, 24 h normale, 72 h basse), notes internes invisibles du client, pièces jointes (5 Mo, 10 par ticket), note de satisfaction.
- Factures : lignes, TVA, timbre fiscal, brouillon → envoyée → payée / annulée, page imprimable en PDF, rappel automatique de retard. Aucun paiement en ligne n’est encaissé.
- Formules, renouvellement annuel en un clic, recharges, rôles admin / manager, plusieurs utilisateurs par client, annonces, exports CSV.

## Démarrer localement

```bash
export POSTGRES_PASSWORD='choose-a-local-development-password'
docker compose up -d
npm ci
cp .env.example .env.local        # puis renseigner les valeurs
npx web-push generate-vapid-keys  # clés VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
npm run db:migrate
npm run dev
```

1. Ouvrir `http://localhost:3000/login`, créer votre compte et suivre l’activation de la 2FA.
2. `npm run admin:grant -- votre-adresse@example.com`, puis actualiser.
3. Le client crée son compte ; dans Clients, créer l’organisation avec son e-mail, attribuer une formule, ajouter ses applications et choisir ses modules.

Les passkeys et les notifications push exigent HTTPS (ou `localhost`). `BETTER_AUTH_URL` doit être l’adresse exacte du portail : une passkey enregistrée sur un nom de domaine ne fonctionne pas sur un autre.

### Mise à jour d’une installation existante

`npm ci && npm run db:migrate` applique `003_platform.sql` et les tables 2FA / passkeys. Les comptes existants devront activer la 2FA à leur prochaine connexion.

### Tâche planifiée

Appeler `GET /api/cron` avec l’en-tête `Authorization: Bearer $CRON_SECRET` toutes les 10 à 15 minutes : relance des envois échoués, rappels d’échéance (30 et 7 jours) et de factures en retard, relevé de l’utilisation des boîtes Mailcow.

### Suivi d’utilisation depuis une application cliente

```js
fetch('https://support.votre-domaine.tn/api/ingest', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'X-App-Key': 'sf_…'},
  body: JSON.stringify({event: 'open', user: 'identifiant-utilisateur', version: '1.0.0'})
});
```

`open` / `session` comptent une session, `error` une erreur, tout autre nom un événement. `user` ne sert qu’à compter les utilisateurs distincts : seule une empreinte est conservée. La clé est affichée une fois à sa génération (Applications → Générer la clé) ; limite de 300 événements par minute et par clé.

## Vérification

```bash
npm run typecheck
npm test        # 57 tests
npm run build
```

Vérifié sur cette livraison avec PostgreSQL 16 et un navigateur Chrome piloté : inscription, activation 2FA, enregistrement et connexion par passkey (authentificateur simulé), verrouillage et déverrouillage, cycle complet d’un ticket, facture, isolation entre clients, modules désactivés, e-mails reçus par un serveur SMTP de test. Restent à vérifier en conditions réelles : la réception d’une notification push sur un vrai téléphone, Face ID / empreinte sur du matériel réel, l’envoi par votre SMTP et le relevé Mailcow.

## Limites connues

- Interface en français uniquement ; l’arabe (RTL) n’est pas encore traduit.
- Les délais de réponse sont fixes par priorité, pas encore réglables par formule.
- Les pièces jointes sont stockées dans PostgreSQL : adapté à des volumes modestes.
- La limite de débit de `/api/ingest` est tenue en mémoire par instance.

## Messagerie & Outlook

### Mise à jour d’une installation existante

Après récupération du code, exécuter `npm run db:migrate` avec le `.env.local` de cette installation. Le script applique les migrations `001_initial.sql`, `002_email.sql` puis `003_platform.sql`, une seule fois chacune, dans une transaction protégée par un verrou. Dans un environnement qui fournit déjà `DATABASE_URL`, on peut lancer `node scripts/migrate.mjs` directement. Le push du code n’exécute pas les migrations de production.

### Administration des domaines

1. Créer ou sélectionner le client dans « Clients & applications ».
2. Ouvrir « Messagerie & Outlook », puis « Ajouter un domaine ». L’admin saisit un nom de domaine réel, sans protocole ni chemin, et choisit le client propriétaire. Aucun domaine n’est codé en dur. Les noms internationalisés peuvent être saisis au format ASCII Punycode.
3. Définir le stockage total et le quota maximal par boîte, en Mo. Laisser le nombre maximal vide pour ne pas imposer de plafond de nombre dans SupportFlow. Les quotas réservés et les limites du fournisseur continuent de s’appliquer. Les quotas sont réservés dès la demande, y compris pour les boîtes suspendues ou les opérations non confirmées. Ce compteur n’est pas une mesure du stockage réellement utilisé.
4. Renseigner les hôtes IMAP/SMTP du fournisseur, si différents de `mail.<domaine>`. Réception : IMAP 993 SSL/TLS ; envoi : SMTP 587 STARTTLS ou 465 SSL/TLS. Les clients voient l’identifiant complet et les instructions Outlook pour chaque boîte.
5. Préparer le domaine chez le fournisseur, le DNS (MX, SPF, DKIM, DMARC), le certificat TLS et les services de réception/envoi. Vérifier la réception et la délivrabilité. Puis cocher « Autoriser les demandes ». Ajouter le domaine dans SupportFlow ne l’achète pas, ne change pas ses DNS et n’installe pas de serveur mail.

Le nom du domaine et son organisation ne peuvent pas être réaffectés. Les managers peuvent consulter les données de messagerie, mais seuls les admins configurent les domaines ; les admins et le client propriétaire peuvent demander des opérations sur les boîtes.

### Deux modes de traitement

- **Intervention de l’équipe** (par défaut) : le client demande une boîte, une suspension/réactivation ou une réinitialisation. La demande est enregistrée et son quota réservé. L’équipe réalise l’opération dans son serveur/panneau de messagerie, puis confirme ou annule la demande dans SupportFlow avec une note et une attestation de vérification. Une demande n’est jamais présentée comme une boîte active avant confirmation. Les mots de passe se définissent chez le fournisseur et ne sont pas saisis dans ce mode.
- **Automatique via Mailcow API** : connecter une installation Mailcow opérationnelle avec `MAILCOW_API_URL=https://mail.votre-fournisseur.tn` (origine HTTPS uniquement, sans `/api/v1`) et `MAILCOW_API_KEY`, côté serveur. Sur Vercel, utiliser des variables serveur, jamais `NEXT_PUBLIC_*`. Configurer les accès API chez Mailcow et ses restrictions réseau pour le serveur d’application. Le domaine doit déjà exister et être actif chez Mailcow ; SupportFlow le vérifie lors de son activation. Les limites configurées ici doivent être compatibles avec celles du domaine Mailcow. Cette intégration ne suppose pas que Mailcow soit installé sur le VPS existant.

En mode automatique, le client choisit le mot de passe de sa nouvelle boîte ou de sa réinitialisation. Il transite uniquement dans la requête HTTPS et l’appel serveur au fournisseur ; SupportFlow ne le conserve ni dans PostgreSQL, ni dans le journal d’audit, ni dans les notifications. Ne pas activer de journalisation des corps de requêtes sur ces routes. Les réponses brutes et journaux du fournisseur ne sont jamais renvoyés au client. Les redirections HTTP ne sont pas suivies avec la clé API.

Une opération est persistée avant tout appel réseau. Un refus, timeout ou réponse incertaine conserve une opération « à vérifier » et sa réservation. Aucune tentative aveugle ne réinitialise ou ne récupère une boîte préexistante chez le fournisseur. L’admin vérifie l’état réel avant de confirmer, ou d’annuler si aucun changement demandé n’a été appliqué. Une opération restée « en cours » après une interruption peut être résolue après deux minutes. La suspension conserve les messages ; cette version ne propose pas leur suppression définitive.

La liste des boîtes est paginée par 50. Les compteurs et contrôles de quota incluent l’ensemble des boîtes, pas uniquement la page affichée. Ce module est indépendant du portefeuille de crédits de développement.

### Validation de la messagerie

`npm run typecheck` et `npm test` vérifient notamment la saisie de domaines arbitraires, l’isolation des clients, les quotas, doublons, opérations manuelles et automatiques, l’absence de mots de passe dans les données conservées, les échecs fournisseur et les protections HTTP. Les tests d’intégration SQL utilisent PGlite ; les tests du connecteur simulent les réponses de l’API Mailcow officielle. Ils n’envoient aucun vrai e-mail et ne modifient aucun serveur externe. Un test avec une vraie instance Mailcow et un compte Outlook reste nécessaire lors de son raccordement.

Références : [API officielle Mailcow](https://github.com/mailcow/mailcow-dockerized/blob/master/data/web/api/openapi.yaml), [ajouter un compte IMAP dans Outlook](https://support.microsoft.com/fr-fr/outlook/getstarted/add-an-email-account-to-outlook-for-windows).
