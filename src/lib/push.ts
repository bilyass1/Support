import webpush from 'web-push';

function configuration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'};
}
export function pushPublicKey() { return configuration()?.publicKey ?? null; }
export type PushTarget = {endpoint: string; p256dh: string; auth: string};
/** Returns 'gone' when the browser has revoked the subscription, so the caller can delete it. */
export async function sendPush(target: PushTarget, payload: {title: string; body: string; url: string; tag?: string}) {
  const config = configuration();
  if (!config) throw new Error('PushNotConfigured');
  try {
    await webpush.sendNotification({endpoint: target.endpoint, keys: {p256dh: target.p256dh, auth: target.auth}},
      JSON.stringify(payload), {vapidDetails: config, TTL: 86_400, urgency: 'high', timeout: 10_000});
    return 'sent' as const;
  } catch (error) {
    const status = (error as {statusCode?: number}).statusCode;
    if (status === 404 || status === 410) return 'gone' as const;
    throw error;
  }
}
