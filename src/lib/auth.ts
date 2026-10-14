import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { pool } from './db';
import { authPlugins } from './auth-options';
import { queueAuthEmail } from './auth-email';
export const auth = betterAuth({
  database: pool,
  appName: 'Solumove Support',
  emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength:128,
    resetPasswordTokenExpiresIn:1800,revokeSessionsOnPasswordReset:true,
    sendResetPassword: async ({user,url})=>queueAuthEmail(user.email,'Réinitialiser votre mot de passe Solumove',
      'Vous avez demandé un nouveau mot de passe. Ouvrez ce lien dans les 30 minutes :\n'+url+'\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.') },
  rateLimit: { enabled: true, storage: 'database' },
  session: {expiresIn:86400,updateAge:3600,cookieCache:{enabled:false}},
  plugins: [...authPlugins(),nextCookies()]
});

