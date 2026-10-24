// Prepare the worker/key before a click. Permission must be requested directly
// from that click, before any network or worker await.
export function pushKey(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const key = Uint8Array.from(decoded, c => c.charCodeAt(0));
  if (key.length !== 65 || key[0] !== 4) throw new Error('Clé de notifications invalide. Contactez l’administrateur.');
  return key;
}

export function pushSupportError(): string | null {
  if (!window.isSecureContext) return 'Les notifications nécessitent une connexion HTTPS.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'Sur iPhone ou iPad, ajoutez l’app à l’écran d’accueil depuis Safari, puis ouvrez cette app. Sinon, utilisez un navigateur compatible avec les notifications.';
  }
  return null;
}

export const blockedMessage = 'Notifications bloquées. Autorisez-les dans les paramètres du site et de votre appareil, puis réessayez.';

export async function activatePush(registration: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) {
  // No fetch or another await before requestPermission: Safari and Firefox
  // can discard transient user activation across asynchronous work.
  if (Notification.permission === 'denied') throw new Error(blockedMessage);
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? blockedMessage : 'Autorisation non accordée. Cliquez de nouveau sur « Activer les notifications » pour réessayer.');
  let subscription = await withPushTimeout(registration.pushManager.getSubscription());
  const previousKey = subscription?.options.applicationServerKey;
  if (subscription && (!previousKey || !sameKey(new Uint8Array(previousKey), key))) {
    if (!await withPushTimeout(subscription.unsubscribe())) throw new Error('Impossible de renouveler l’abonnement de cet appareil. Réessayez.');
    subscription = null;
  }
  subscription ??= await withPushTimeout(registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key}), 30000);
  const response = await fetch('/api/push', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(subscription), signal: AbortSignal.timeout(12000)});
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Abonnement non enregistré. Reconnectez-vous puis réessayez.');
  }
}

function sameKey(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

export function withPushTimeout<T>(promise: Promise<T>, milliseconds = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le service de notifications ne répond pas. Rechargez la page puis réessayez.')), milliseconds);
    promise.then(value => {clearTimeout(timer); resolve(value);}, error => {clearTimeout(timer); reject(error);});
  });
}
