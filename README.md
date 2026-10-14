# Solumove Support

Plateforme Next.js / React / PostgreSQL auto-hébergée sur le VPS Solumove, accessible via support.solumove.net.

Cette version ajoute les packs mail partagés par client, la réservation et consommation des tokens, les achats validés par l’admin, les factures, le support, l’Authenticator obligatoire, la récupération par email, le Web Push et les thèmes clair / bleu nuit avec le logo Solumove.

Le guide de configuration, de migration, de sauvegarde et de retour arrière est dans [deploy/advanced/README.md](deploy/advanced/README.md). Le broker Postfix/Dovecot est décrit dans [deploy/local-mail/README.md](deploy/local-mail/README.md).

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

Le premier compte doit être inscrit, associé à un client par l’admin, et activer son Authenticator. L’attribution du rôle admin se fait via npm run admin:grant avec l’email du compte selon scripts/grant-admin.mjs. Conserver les codes de secours.

56 tests applicatifs et 10 tests broker passent. Le workflow GitHub valide aussi le build et le parcours navigateur sur une base CI isolée. La disponibilité en production dépend de la migration et des contrôles décrits dans le guide VPS.

Les quotas mail applicatifs mesurent le stockage alloué ; ils ne limitent pas encore physiquement le disque Dovecot. Les paiements sont confirmés manuellement. Les emails et push nécessitent leurs secrets serveur ; la PWA demande le consentement de chaque appareil.
