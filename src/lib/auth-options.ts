import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';
const origin=()=>{try{return new URL(process.env.BETTER_AUTH_URL??'http://localhost:3000').origin;}catch{return 'http://localhost:3000';}};
export const authPlugins=()=>[
 twoFactor({issuer:'Solumove Support',accountLockout:{enabled:true,maxFailedAttempts:5,durationSeconds:900}}),
 // A registered device replaces the password and the code with Face ID, fingerprint or the device PIN.
 // The auth route only accepts assertions that carry user verification, and only lets a session that
 // already passed the authenticator register a device.
 passkey({rpID:new URL(origin()).hostname,rpName:'Solumove Support',origin:origin(),authenticatorSelection:{residentKey:'required',userVerification:'required'}})
] as const;
