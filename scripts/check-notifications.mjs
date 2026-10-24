import { configuredPushKey } from '../src/lib/push-config.mjs';
let valid = true;
const check = (name, ok) => {console.log(name + ' : ' + (ok ? 'OK' : 'À CONFIGURER')); valid &&= ok;};
let secure = false;
try {secure = new URL(process.env.BETTER_AUTH_URL).protocol === 'https:';} catch {}
check('URL publique HTTPS', secure);
check('Paire de clés Web Push', !!configuredPushKey());
check('SMTP chiffré pour les emails', !!process.env.SMTP_HOST && [465, 587].includes(Number(process.env.SMTP_PORT ?? 587)));
check('Identifiants SMTP présents', !!process.env.SMTP_USER && !!process.env.SMTP_PASSWORD);
console.log('Récupération de mot de passe : expéditeur administration@solumove.net');
console.log('Vérifier aussi supportflow-notifications.timer et les permissions du navigateur/appareil.');
// No credentials, keys, reset tokens or message contents are printed.
process.exitCode = valid ? 0 : 1;
