import { twoFactor } from 'better-auth/plugins/two-factor';
export const authPlugins=()=>[twoFactor({issuer:'Solumove Support',accountLockout:{enabled:true,maxFailedAttempts:5,durationSeconds:900}})] as const;
