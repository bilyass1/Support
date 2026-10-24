'use client';
import { useCallback, useEffect, useState } from 'react';
import { activatePush, blockedMessage, pushKey, pushSupportError, withPushTimeout } from '@/lib/push-client';
type InstallEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: string}>};
type ReadyPush = {registration: ServiceWorkerRegistration; key: Uint8Array<ArrayBuffer>};

export function Pwa() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [ready, setReady] = useState<ReadyPush | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [preparing, setPreparing] = useState(true);
  const [active, setActive] = useState(false), [prepareError, setPrepareError] = useState('');

  const prepare = useCallback(async (signal?: AbortSignal) => {
    setPreparing(true); setPrepareError(''); setReady(null);
    try {
      const unavailable = pushSupportError();
      if (unavailable) throw new Error(unavailable);
      const registrationPromise = withPushTimeout(navigator.serviceWorker.register('/sw.js')
        .then(() => navigator.serviceWorker.ready));
      const configPromise = (async () => {
        const response = await fetch('/api/push', {cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)});
        const config = await response.json();
        if (!response.ok) throw new Error(response.status === 401 ? 'Connectez-vous pour activer les notifications.' : config.error ?? 'Terminez votre connexion et votre authentification.');
        if (!config.publicKey) throw new Error('Les notifications ne sont pas configurées sur le serveur. Contactez l’administrateur.');
        return pushKey(config.publicKey);
      })();
      const [registration, key] = await Promise.all([registrationPromise, configPromise]);
      const subscription = await withPushTimeout(registration.pushManager.getSubscription());
      if (signal?.aborted) return;
      // A browser subscription alone does not prove that it was saved for this
      // account. Confirm via activation before claiming success.
      setActive(false); setReady({registration, key});
      if (Notification.permission === 'denied') setMessage(blockedMessage);
      else if (subscription) setMessage('Cet appareil possède un abonnement. Cliquez sur « Activer les notifications » pour le confirmer pour votre compte.');
    } catch (error) {
      if (!signal?.aborted) setPrepareError(error instanceof Error ? error.message : 'Préparation des notifications impossible.');
    } finally {if (!signal?.aborted) setPreparing(false);}
  }, []);

  useEffect(() => {
    // Installation still works on browsers without Push support.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    const controller = new AbortController(); void prepare(controller.signal);
    const handler = (event: Event) => {event.preventDefault(); setInstall(event as InstallEvent);};
    window.addEventListener('beforeinstallprompt', handler);
    return () => {controller.abort(); window.removeEventListener('beforeinstallprompt', handler);};
  }, [prepare]);

  async function push() {
    if (!ready) return;
    setBusy(true); setMessage('');
    try {
      await activatePush(ready.registration, ready.key);
      setActive(true); setMessage('Notifications activées sur cet appareil.');
    } catch (error) {
      setActive(false);
      setMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? blockedMessage : error instanceof Error ? error.message : 'Activation indisponible.');
    } finally {setBusy(false);}
  }

  async function unsubscribe() {
    if (!ready) return;
    setBusy(true); setMessage('');
    try {
      const sub = await withPushTimeout(ready.registration.pushManager.getSubscription());
      if (sub) {
        const response = await fetch('/api/push', {method: 'DELETE', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({endpoint: sub.endpoint}), signal: AbortSignal.timeout(12000)});
        if (!response.ok) throw new Error('Reconnectez-vous pour retirer cet abonnement.');
        if (!await withPushTimeout(sub.unsubscribe())) throw new Error('Retrait de l’abonnement non confirmé par le navigateur. Réessayez.');
      }
      setActive(false); setMessage('Notifications désactivées sur cet appareil.');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Retrait impossible.');}
    finally {setBusy(false);}
  }

  return <aside className="pwa-tools"><details><summary>Installer l’app & notifications</summary>
    <p>Android / Chrome : Installer. Sur iPhone / iPad : Safari → Partager → Sur l’écran d’accueil, puis ouvrez l’app installée.</p>
    {install ? <button onClick={async () => {try {await install.prompt(); await install.userChoice; setInstall(null);} catch {setMessage('Installation indisponible. Utilisez le menu de votre navigateur.');}}}>Installer Solumove</button> : null}
    <div className="actions">
      <button disabled={busy || preparing || !ready || active} onClick={push}>{active ? 'Notifications activées' : 'Activer les notifications'}</button>
      <button disabled={busy || preparing || !ready} onClick={unsubscribe}>Désactiver</button>
      {prepareError ? <button disabled={preparing} onClick={() => {setMessage(''); void prepare();}}>Réessayer</button> : null}
    </div>
    {preparing ? <p role="status">Préparation des notifications…</p> : null}
    {prepareError ? <p role="alert">{prepareError}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <p>Chaque appareil doit donner son accord. Aucun document client n’est conservé hors ligne.</p>
  </details></aside>;
}
