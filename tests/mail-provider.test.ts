import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mailProviderAvailable, provisionMailbox, verifyMailDomain } from '../src/lib/mail-provider';
import { mailActionSchema, type MailDomain, type Mailbox } from '../src/lib/mail-validation';
const domain = {domain: 'client.example'} as MailDomain;
const mailbox = {local_part: 'contact', display_name: 'Contact', quota_mb: 1024, operation: 'create'} as Mailbox;
const fetcher = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
beforeEach(() => {
  vi.stubEnv('MAILCOW_API_URL', 'https://mail.provider.example'); vi.stubEnv('MAILCOW_API_KEY', 'test-api-key');
  vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
});
afterEach(() => {vi.unstubAllGlobals(); vi.unstubAllEnvs();});
describe('mail provider boundary and validation', () => {
  it('requires a configured HTTPS origin without paths, credentials or query strings', () => {
    expect(mailProviderAvailable()).toBe(true);
    for (const url of ['http://mail.example', 'https://mail.example/api/v1', 'https://user:pass@mail.example', 'https://mail.example/?token=bad']) {
      vi.stubEnv('MAILCOW_API_URL', url); expect(mailProviderAvailable()).toBe(false);
    }
  });
  it('verifies the exact active domain and refuses unrelated provider results', async () => {
    fetcher.mockResolvedValueOnce(json({domain_name: 'client.example', active: '1'}));
    await expect(verifyMailDomain('client.example')).resolves.toBeUndefined();
    fetcher.mockResolvedValueOnce(json({domain_name: 'other.example', active: 1}));
    await expect(verifyMailDomain('client.example')).rejects.toThrow('activez');
  });
  it('creates via the documented API with authenticated HTTPS and no redirects', async () => {
    fetcher.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([{type: 'success'}]));
    await provisionMailbox(domain, mailbox, 'PasswordForTest12!');
    expect(fetcher.mock.calls[1][0]).toBe('https://mail.provider.example/api/v1/add/mailbox');
    const options = fetcher.mock.calls[1][1];
    expect(options.headers['X-API-Key']).toBe('test-api-key'); expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toMatchObject({domain: 'client.example', local_part: 'contact', quota: '1024', password2: 'PasswordForTest12!'});
  });
  it('never adopts an existing provider mailbox or writes after an uncertain lookup', async () => {
    fetcher.mockResolvedValueOnce(json({username: 'contact@client.example'}));
    await expect(provisionMailbox(domain, mailbox, 'PasswordForTest12!')).rejects.toThrow('AlreadyExists');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset().mockResolvedValueOnce(json({type: 'danger', log: ['secret']}));
    await expect(provisionMailbox(domain, mailbox, 'PasswordForTest12!')).rejects.toThrow('Uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([['suspend', {active: '0'}], ['resume', {active: '1'}], ['reset_password', {password: 'NewPassword12!', password2: 'NewPassword12!'}]] as const)(
    'sends a scoped %s operation', async (operation, attr) => {
      fetcher.mockResolvedValueOnce(json([{type: 'success'}]));
      await provisionMailbox(domain, {...mailbox, operation}, 'NewPassword12!');
      expect(fetcher.mock.calls[0][0]).toBe('https://mail.provider.example/api/v1/edit/mailbox');
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({items: ['contact@client.example'], attr});
    });
  it('rejects HTTP and application failures without including provider logs in errors', async () => {
    fetcher.mockResolvedValueOnce(json({error: 'secret'}, 401));
    await expect(verifyMailDomain('client.example')).rejects.toThrow('Unavailable');
    fetcher.mockResolvedValueOnce(json([{type: 'danger', log: ['secret']} ]));
    await expect(provisionMailbox(domain, {...mailbox, operation: 'suspend'})).rejects.toThrow(/^MailProviderRejected$/);
  });
  it('rejects unsafe domain/local-part input, weak passwords and missing manual-verification consent', () => {
    const create = {type: 'create_mailbox', domain_id: '11111111-1111-4111-8111-111111111111', local_part: 'contact', display_name: 'Contact', quota_mb: 1};
    for (const local_part of ['../user', 'user@other.example', 'a..b', '*', 'bad name']) expect(mailActionSchema.safeParse({...create, local_part}).success).toBe(false);
    expect(mailActionSchema.safeParse({...create, password: 'short'}).success).toBe(false);
    expect(mailActionSchema.safeParse({type: 'resolve_operation', mailbox_id: create.domain_id, completed: true, note: 'No confirmation'}).success).toBe(false);
  });
});
