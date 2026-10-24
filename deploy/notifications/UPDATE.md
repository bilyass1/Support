# Correction de l’activation des notifications

Cette mise à jour part de `feature/import-existing-mailboxes` et conserve ses fonctions de comptes clients, factures, MFA et messagerie. La branche livrée est `fix/client-notifications`.

Le service worker et la clé publique sont préparés avant le clic. La demande d’autorisation part directement du clic, sans attendre la requête serveur ; ce geste utilisateur est notamment exigé par Safari. Les attentes du worker sont bornées, les anciens abonnements sont renouvelés si la clé a changé, et un enregistrement refusé n’affiche pas de succès. Les endpoints Edge/WNS sont acceptés à la réception et à l’expédition, en conservant l’allowlist contre les requêtes vers des serveurs arbitraires.

L’API vérifie la présence et la correspondance des deux clés VAPID, sans jamais renvoyer la clé privée. Un compte connecté et une session MFA validée restent nécessaires. Les emails de récupération partent maintenant de **administration@solumove.net** ; le compte SMTP configuré doit être autorisé à utiliser cette adresse. Les emails d’activité gardent leur expéditeur habituel.

## Mise à jour du code

Appliquer la procédure de release séparée de [CLIENT-UPDATE.md](../advanced/CLIENT-UPDATE.md), avec la branche `fix/client-notifications`. Conserver les vrais `.env.local`, DATABASE_URL, BETTER_AUTH_SECRET, LOCAL_MAIL_SOCKET, les fichiers de factures et les clés VAPID existantes. Installer les dépendances, vérifier les tests, construire la nouvelle release, puis basculer uniquement le service SupportFlow après validation. Le correctif ajoute aussi Next.js 16.4.3, version corrigée des vulnérabilités détectées dans 16.4.0.

La branche est commitée localement ; le push GitHub n’a pas pu aboutir sans authentification. Utiliser l’archive **Support-corrige.zip** fournie avec le correctif si la branche n’a pas encore été publiée sur le dépôt. L’archive contient les sources dans `Support/`, sans secrets ni `node_modules`. Depuis Windows, une fois l’archive téléchargée :

```powershell
scp "$env:USERPROFILE\Downloads\Support-corrige.zip" root@102.211.210.97:/root/
```

Sur le VPS, extraire dans **un nouveau dossier de release**, donner ce dossier au compte applicatif `supportflow`, puis y copier le `.env.local` de l’installation courante avec permissions 600. Cela remplace uniquement l’étape `git clone` du guide existant ; la construction, la sauvegarde, la vérification du chemin du service et la bascule restent nécessaires. Ne pas décompresser sur le répertoire de l’application en service. Pour identifier ses chemins avant de préparer la release :

```bash
systemctl cat supportflow.service
systemctl cat supportflow-notifications.service
```

Ce correctif n’ajoute pas de migration SQL. Une installation plus ancienne doit toutefois appliquer les migrations requises par la branche de plateforme, décrites dans le guide existant. Ne pas reconstruire dans le dossier utilisé par le service en cours.

Dans le répertoire de la release, avec le Node utilisé par le service :

```bash
npm run notifications:check
```

Si les clés sont absentes, générer une paire **une seule fois**, puis la saisir dans `.env.local` (permissions 600). Ne pas remplacer une paire déjà valide : les appareils abonnés en dépendent.

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Configurer `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`, puis redémarrer le service applicatif pour qu’il recharge l’environnement. Garder la clé privée sur le VPS. Ne pas la copier dans un ticket ou dans GitHub.

Le timer d’expédition doit viser **la même nouvelle release**, afin d’utiliser le nouveau validateur des endpoints et l’expéditeur de récupération. Vérifier son `WorkingDirectory` et son `ExecStart` avant de le relancer :

```bash
systemctl cat supportflow-notifications.service
systemctl is-active supportflow-notifications.timer
systemctl list-timers supportflow-notifications.timer --no-pager
journalctl -u supportflow-notifications.service -n 30 --no-pager
```

Un service d’expédition `oneshot` peut être `inactive` entre deux exécutions ; vérifier le timer et le résultat de la dernière exécution. Les messages sont expédiés toutes les minutes. Les erreurs SMTP peuvent retarder l’expédition ; l’autorisation du navigateur ne suffit pas à prouver une livraison effective.

## Vérification sur l’appareil

1. Se connecter à `https://support.solumove.net` et terminer l’Authenticator. Ouvrir « Installer l’app & notifications ».
2. Attendre la fin de la préparation, cliquer « Activer les notifications », puis autoriser dans le navigateur. L’app n’annonce l’activation qu’après enregistrement du serveur.
3. Si une autorisation a été refusée, l’autoriser dans les paramètres du site et du système. Sur iPhone/iPad, installer depuis Safari avec « Sur l’écran d’accueil », puis ouvrir l’app installée.
4. Vérifier la réception sur un appareil autorisé lors d’une activité normale du client. Vérifier aussi le lien « Mot de passe oublié » et le champ De de l’email reçu, qui doit être administration@solumove.net.

Le navigateur et le système gardent le contrôle de leur autorisation ; l’application ne peut pas contourner un refus. Aucun message réel ni push de test n’a été expédié depuis l’environnement de développement.

Références : [Web Push sur iOS/iPadOS](https://webkit.org/blog/13878/) et [notifications Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push).
