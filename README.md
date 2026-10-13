# SupportFlow — première base de l’application

Projet Next.js / React / PostgreSQL pour gérer des clients, leurs applications, des demandes de développement et un portefeuille de crédits commerciaux (« tokens »). Ces crédits représentent votre service ; ils ne représentent pas les tokens facturés par un modèle d’IA.

## Stack installée et verrouillée

| Usage | Technologie |
| --- | --- |
| Application et API | Next.js 16.4.0, App Router, Node.js |
| Interface | React 19.3.0, CSS responsive, Lucide React |
| Authentification | Better Auth 1.7.7, e-mail et mot de passe, sessions en base |
| Base de données | PostgreSQL, pilote `pg` 8.23.1, SQL paramétré |
| Validation | Zod 4.6.7 |
| Typage | TypeScript 5.9.3 |
| Tests | Vitest 5.0.4 et PostgreSQL embarqué PGlite 0.5.9 |

Le fichier `package-lock.json` fixe les versions installées. Node.js 22 ou supérieur est requis pour ce projet.

## Ce qui est implémenté

- Inscription et connexion ; un nouveau compte n’a aucun accès client tant que l’admin ne l’associe pas à une organisation. Le rôle administrateur s’attribue par une commande exécutée sur le serveur.
- Espaces admin et client avec contrôle des accès côté serveur. Le rôle manager existe côté serveur ; sa gestion dans l’interface reste à ajouter.
- Création de clients à partir d’un compte déjà inscrit et association de plusieurs applications web, mobile ou logiciel.
- Création et modification de formules : quota annuel, prix, devise, niveau de support et règles. L’admin choisit si les règles modifiées sont appliquées aux abonnements existants.
- Règles sans code disponibles dans cette version : coût indicatif par catégorie et nombre maximum de tickets ouverts. Ajouter un nouveau type de règle métier nécessitera d’étendre les types, la validation, l’éditeur et son interpréteur. On peut créer de nouvelles instances des types existants depuis l’admin.
- Première attribution d’une formule : abonnement d’un an et allocation du quota. Un changement de formule ne verse pas une deuxième allocation et ne prolonge pas l’échéance.
- Recharges manuelles par l’admin avec un motif et un historique. Aucun paiement n’est encaissé par cette action.
- Tickets avec numéro, catégorie, description, estimation versionnée, acceptation par le client, statut et commentaires.
- Acceptation : réservation atomique des crédits. Clôture : consommation. Annulation par l’équipe : libération des crédits réservés. Le client peut annuler ses demandes avant acceptation et clôturer une livraison prête à tester.
- Une estimation acceptée ne peut plus être modifiée. Une ancienne version de devis ne peut pas être acceptée. Les demandes et les acceptations exigent un abonnement actif.
- Historique des mouvements, journal d’audit en base et notifications dans l’application.
- Interface française responsive et mode clair/sombre. Manifest PWA, icônes et service worker initial ; aucune donnée client n’est mise en cache hors ligne.

Les noms, quotas et tarifs de vos formules ne sont pas imposés. La base est vide au démarrage.

## Démarrer localement

1. Installer Node.js 22+ et PostgreSQL. Docker Compose peut fournir PostgreSQL :

   ```bash
   export POSTGRES_PASSWORD='choose-a-local-development-password'
   docker compose up -d
   ```

2. Installer les dépendances et préparer la configuration :

   ```bash
   npm ci
   cp .env.example .env.local
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Remplacer `BETTER_AUTH_SECRET` par le secret généré et ajuster `DATABASE_URL` avec votre mot de passe PostgreSQL. `BETTER_AUTH_URL` doit correspondre à l’origine de l’application (`http://localhost:3000` en local). Ne pas enregistrer `.env.local` dans Git.

3. Créer les tables d’authentification et de l’application :

   ```bash
   npm run db:migrate
   npm run dev
   ```

   Ouvrir `http://localhost:3000/login` et créer votre compte.

4. Attribuer le rôle admin à ce compte, puis actualiser la page :

   ```bash
   npm run admin:grant -- votre-adresse@example.com
   ```

5. Créer un deuxième compte pour le client. Dans l’espace admin, créer une formule, associer ce compte à une organisation, attribuer la formule et ajouter une application.

6. Depuis le compte client, créer une demande. Depuis l’admin, sélectionner le ticket et proposer un coût. Le client accepte, l’équipe réalise et marque prêt à tester, puis la livraison est validée et le ticket clôturé. L’historique permet de vérifier la réservation et la consommation.

## Commandes de vérification

```bash
npm run typecheck
npm test
npm run build
npm start
```

Résultats de cette livraison : contrôle TypeScript réussi ; 14 tests réussis. Les tests d’intégration exécutent le SQL et les transactions métier dans PGlite, avec une adaptation de l’interface du pilote `pg`. Ils couvrent le cycle du ticket, les devis périmés, les doubles validations, les crédits insuffisants, l’isolation entre clients, les recharges, les annulations, les changements de formule et l’échéance annuelle.

Le build de production a été essayé avec Turbopack et webpack. Les deux s’arrêtent sur une erreur du runtime de cet environnement : `ENOENT ... uv_resident_set_memory`. Le build complet et les tests navigateur restent donc à exécuter dans un environnement Node.js standard. L’inscription, la connexion et les migrations d’authentification n’ont pas été vérifiées avec une instance PostgreSQL externe. Aucune URL publique ni base de production n’a été créée.

## Arborescence

```text
src/app/                 Pages Next.js et routes API
src/components/          Interface, formulaires, connexion, PWA
src/lib/auth.ts          Configuration Better Auth
src/lib/db.ts            Connexions et transactions PostgreSQL
src/lib/domain.ts        Invariants du portefeuille et transitions
src/lib/service.ts       Opérations métier et accès par client
src/lib/validation.ts    Validation des actions et des règles
db/001_initial.sql       Schéma métier
scripts/migrate.mjs      Migrations Better Auth et application
scripts/grant-admin.mjs  Attribution administrative d’un rôle
tests/                   Tests métier et SQL
public/                  Manifest et ressources PWA
```

## Suite prévue à partir des besoins exprimés

- Renouvellement annuel, distinction des lots de crédits annuels et achetés, validité et report des crédits restants. Le renouvellement n’est pas automatique dans cette première version.
- Recharges mensuelles automatiques et moteur de règles étendu, avec exécution planifiée et protection contre une double attribution.
- Paiements, factures, références externes et traitement idempotent des webhooks. Le prestataire de paiement reste à choisir.
- Pièces jointes sécurisées, exports, pagination au-delà des limites initiales et recherche complète. L’interface actuelle affiche les 100 derniers tickets et mouvements.
- Notifications push PWA : abonnement par appareil, clés Web Push, expédition côté serveur et préférences utilisateur. Les notifications actuelles sont internes à l’application.
- Traductions anglaises et arabes, RTL, récupération de mot de passe et e-mails transactionnels.
- Gestion des managers et membres, journal d’audit consultable, tests de concurrence sur PostgreSQL et vérification navigateur complète.
- Hébergement compatible avec Next.js Node.js et PostgreSQL, configuration de production et sauvegardes. App Store et Play Store constituent des livraisons séparées.

Cette livraison est un socle de développement, pas une plateforme finalisée pour encaisser des paiements ou servir des clients en production.
