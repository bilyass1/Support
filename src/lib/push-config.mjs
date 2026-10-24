import { createECDH } from 'node:crypto';

// A public key alone permits subscriptions the server can never use.
export function configuredPushKey() {
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY ?? '', privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
    if (!/^[A-Za-z0-9_-]+$/.test(publicKey) || !/^[A-Za-z0-9_-]+$/.test(privateKey)) return null;
    const publicBytes = Buffer.from(publicKey, 'base64url'), privateBytes = Buffer.from(privateKey, 'base64url');
    if (publicBytes.length !== 65 || privateBytes.length !== 32) return null;
    const curve = createECDH('prime256v1'); curve.setPrivateKey(privateBytes);
    return curve.getPublicKey().equals(publicBytes) ? publicKey : null;
  } catch {return null;}
}
