# Solumove Support

Plateforme Next.js / React / PostgreSQL auto-hébergée sur le VPS Solumove, accessible via support.solumove.net.

Cette version ajoute les packs mail partagés par client, la réservation et consommation des tokens, les achats validés par l’admin, les factures, le support, l’Authenticator obligatoire, la récupération par email, le Web Push et les thèmes clair / bleu nuit avec le logo Solumove.

Le guide de configuration, de migration, de sauvegarde et de retour arrière est dans [deploy/advanced/README.md](deploy/advanced/README.md). Le broker Postfix/Dovecot est décrit dans [deploy/local-mail/README.md](deploy/local-mail/README.md).

## Comptes clients et factures

L’admin crée désormais le compte client avec matricule fiscal et mot de passe temporaire. Le client doit choisir son mot de passe personnel puis activer Authenticator avant tout accès. L’inscription publique est fermée. Le centre de pilotage admin regroupe comptes, packs, achats, factures, support et audit ; les PDFs sont privés et accessibles uniquement au client concerné et à l’admin.

Voir [deploy/advanced/CLIENT-UPDATE.md](deploy/advanced/CLIENT-UPDATE.md) pour cette mise à jour, les limites et le déploiement depuis la version déjà en production.

## Développement

Node.js >=22.12 et PostgreSQL 16. Copier .env.example vers .env.local et saisir les secrets localement. Aucun fichier .env.local ne doit être commité.

```bash
npm ci --include=optional
npm run db:migrate
npm run typecheck
npm test
npm run build
npm start
```

Sur l’installation existante, le compte admin est conservé. Les nouveaux comptes clients se créent depuis son interface. L’attribution du rôle admin à un compte préexistant se fait exclusivement depuis la console via scripts/grant-admin.mjs. Conserver les codes de secours.

62 tests applicatifs et 10 tests broker passent. Le build, les migrations PostgreSQL 16 et le parcours navigateur MFA / clair / sombre ont également réussi dans GitHub Actions sur une base CI isolée. La disponibilité en production dépend de la migration et des contrôles décrits dans le guide VPS.

Les quotas mail applicatifs mesurent le stockage alloué ; ils ne limitent pas encore physiquement le disque Dovecot. Les paiements sont confirmés manuellement. Les emails et push nécessitent leurs secrets serveur ; la PWA demande le consentement de chaque appareil.
