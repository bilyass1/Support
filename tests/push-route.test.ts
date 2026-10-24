import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createECDH } from 'node:crypto';
const harness = vi.hoisted(() => ({authenticated: vi.fn(), query: vi.fn()}));
vi.mock('../src/lib/request', async importOriginal => ({...await importOriginal<typeof import('../src/lib/request')>(), authenticated: harness.authenticated}));
vi.mock('../src/lib/db', () => ({pool: {query: harness.query}}));
vi.mock('../src/lib/auth', () => ({auth: {api: {getSession: vi.fn()}}}));
import { GET, POST, DELETE } from '../src/app/api/push/route';
import { configuredPushKey } from '../src/lib/push-config.mjs';
import { allowedPushEndpoint } from '../src/lib/push-endpoint.mjs';
import { DomainError } from '../src/lib/domain';
const curve = createECDH('prime256v1'); curve.generateKeys();
const origin = 'https://support.example';
const body = {endpoint: 'https://wns2-test.notify.windows.com/w/?token=test', keys: {p256dh: 'p'.repeat(80), auth: 'a'.repeat(24)}};
const post = (data: unknown = body, from = origin) => new Request(origin + '/api/push', {method: 'POST', headers: {Origin: from}, body: JSON.stringify(data)});
beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('VAPID_PUBLIC_KEY', curve.getPublicKey().toString('base64url'));
  vi.stubEnv('VAPID_PRIVATE_KEY', curve.getPrivateKey().toString('base64url'));
  harness.authenticated.mockReset().mockResolvedValue({id: 'client', role: 'client'});
  harness.query.mockReset().mockResolvedValue({rows: [], rowCount: 1});
});
afterEach(() => vi.unstubAllEnvs());
describe('push configuration and tenant boundary', () => {
  it('exposes only a usable public key and refuses missing or mismatched key pairs', async () => {
    expect(await (await GET(new Request(origin + '/api/push'))).json()).toEqual({publicKey: process.env.VAPID_PUBLIC_KEY});
    vi.stubEnv('VAPID_PRIVATE_KEY', ''); expect(configuredPushKey()).toBeNull();
    expect(await (await GET(new Request(origin + '/api/push'))).json()).toEqual({publicKey: ''});
    expect((await POST(post())).status).toBe(503); expect(harness.query).not.toHaveBeenCalled();
    const other = createECDH('prime256v1'); other.generateKeys();
    vi.stubEnv('VAPID_PRIVATE_KEY', other.getPrivateKey().toString('base64url')); expect(configuredPushKey()).toBeNull();
  });
  it('authenticates and checks the origin before accepting a subscription', async () => {
    harness.authenticated.mockRejectedValueOnce(new DomainError('Connectez-vous.', 401));
    expect((await GET(new Request(origin + '/api/push'))).status).toBe(401);
    expect((await POST(post(body, 'https://attacker.example'))).status).toBe(403);
    expect(harness.query).not.toHaveBeenCalled();
  });
  it('accepts Edge subscriptions, saves for the authenticated user and refuses endpoint reassignment', async () => {
    expect((await POST(post())).status).toBe(200);
    expect(harness.query.mock.calls[0][1]).toEqual([body.endpoint, 'client', JSON.stringify(body)]);
    expect(harness.query.mock.calls[0][0]).toContain('push_subscriptions.user_id=excluded.user_id');
    harness.query.mockResolvedValueOnce({rowCount: 0}); expect((await POST(post())).status).toBe(409);
  });
  it('rejects unsafe endpoints, malformed and oversized subscriptions', async () => {
    for (const endpoint of ['https://127.0.0.1/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://user:secret@web.push.apple.com/x']) {
      expect(allowedPushEndpoint(endpoint)).toBe(false); expect((await POST(post({...body, endpoint}))).status).toBe(400);
    }
    expect((await POST(post({huge: 'x'.repeat(9000)}))).status).toBe(413);
    expect((await POST(new Request(origin + '/api/push', {method: 'POST', headers: {Origin: origin}, body: '{'}))).status).toBe(400);
    expect(harness.query).not.toHaveBeenCalled();
  });
  it('removes subscriptions only for their authenticated owner', async () => {
    expect((await DELETE(new Request(origin + '/api/push', {method: 'DELETE', headers: {Origin: origin}, body: JSON.stringify({endpoint: body.endpoint})}))).status).toBe(200);
    expect(harness.query).toHaveBeenCalledWith('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [body.endpoint, 'client']);
  });
});
