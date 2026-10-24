import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createECDH } from 'node:crypto';
import { activatePush, pushKey, pushSupportError, withPushTimeout } from '../src/lib/push-client';

const curve = createECDH('prime256v1'); curve.generateKeys();
const key = new Uint8Array(curve.getPublicKey());
let permission: {permission: NotificationPermission; requestPermission: ReturnType<typeof vi.fn>};
const fetcher = vi.fn(), get = vi.fn(), subscribe = vi.fn(), unsubscribe = vi.fn();
const subscription = () => ({endpoint: 'https://fcm.googleapis.com/fcm/send/test', options: {applicationServerKey: key.buffer}, unsubscribe,
  toJSON: () => ({endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: {auth: 'auth-key', p256dh: 'public-key'}})});
const registration = {pushManager: {getSubscription: get, subscribe}} as unknown as ServiceWorkerRegistration;
beforeEach(() => {
  vi.clearAllMocks();
  permission = {permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted')};
  vi.stubGlobal('Notification', permission); vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValue(new Response('{}', {status: 200}));
  get.mockResolvedValue(null); subscribe.mockResolvedValue(subscription()); unsubscribe.mockResolvedValue(true);
});
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});

describe('notification activation from a user click', () => {
  it('requests permission immediately, before waiting for any network or worker operation', async () => {
    let grant!: (value: NotificationPermission) => void;
    permission.requestPermission.mockImplementation(() => new Promise(resolve => {grant = resolve;}));
    const activation = activatePush(registration, key);
    expect(permission.requestPermission).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    grant('granted'); await activation;
    expect(subscribe).toHaveBeenCalledWith({userVisibleOnly: true, applicationServerKey: key});
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({endpoint: 'https://fcm.googleapis.com/fcm/send/test'});
  });
  it.each(['denied', 'default'] as const)('does not subscribe or claim success when permission is %s', async result => {
    permission.requestPermission.mockResolvedValue(result);
    await expect(activatePush(registration, key)).rejects.toThrow(result === 'denied' ? 'bloquées' : 'non accordée');
    expect(subscribe).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('explains an existing browser block without repeatedly requesting permission', async () => {
    permission.permission = 'denied';
    await expect(activatePush(registration, key)).rejects.toThrow('paramètres du site');
    expect(permission.requestPermission).not.toHaveBeenCalled();
  });
  it('reuses a matching subscription and avoids a second browser prompt', async () => {
    permission.permission = 'granted'; get.mockResolvedValue(subscription());
    await activatePush(registration, key);
    expect(subscribe).not.toHaveBeenCalled(); expect(permission.requestPermission).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('replaces an obsolete subscription after VAPID key rotation', async () => {
    get.mockResolvedValue({...subscription(), options: {applicationServerKey: new Uint8Array(65).buffer}});
    await activatePush(registration, key);
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(subscribe).toHaveBeenCalledOnce();
  });
  it('reports a rejected server save instead of announcing activation', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({error: 'Cet appareil est associé à un autre compte.'}), {status: 409}));
    await expect(activatePush(registration, key)).rejects.toThrow('autre compte');
  });
  it('does not wait indefinitely for an inactive service worker', async () => {
    vi.useFakeTimers();
    const result = expect(withPushTimeout(new Promise(() => {}))).rejects.toThrow('ne répond pas');
    await vi.advanceTimersByTimeAsync(12000); await result;
  });
  it('handles unsupported mobile browsers and validates the application key before activation', () => {
    vi.stubGlobal('window', {isSecureContext: true}); vi.stubGlobal('navigator', {});
    expect(pushSupportError()).toContain('écran d’accueil');
    vi.stubGlobal('window', {isSecureContext: false});
    expect(pushSupportError()).toContain('HTTPS');
    expect(pushKey(curve.getPublicKey().toString('base64url'))).toEqual(key);
    expect(() => pushKey('invalid')).toThrow();
  });
});
