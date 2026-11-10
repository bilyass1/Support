import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { pool } from './db';
import { appUrl, companyName, mailerAvailable, renderEmail, sendEmail } from './mailer';

const origin = appUrl();
export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true, minPasswordLength: 12, revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({user, url}) => {
      if (!mailerAvailable()) { console.error('Password reset requested but SMTP is not configured'); return; }
      await sendEmail(user.email, 'Réinitialisation de votre mot de passe',
        renderEmail('Réinitialisation de votre mot de passe', 'Vous avez demandé un nouveau mot de passe. Ce lien est valable une heure. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.', url, 'Choisir un nouveau mot de passe'));
    }
  },
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [
    // TOTP codes from an authenticator app; mandatory for every account (enforced in request.ts).
    twoFactor({ issuer: companyName() }),
    // Passkeys: Face ID, Touch ID, fingerprint or Windows Hello once the device is registered.
    passkey({ rpID: new URL(origin).hostname, rpName: companyName(), origin }),
    nextCookies()
  ]
});
export const twoFactorRequired = () => process.env.REQUIRE_TWO_FACTOR !== 'false';
