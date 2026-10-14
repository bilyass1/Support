import { localMailAvailable, localMailRequest, provisionLocalMailbox } from './local-mail-provider';
import { DomainError } from './domain';
import type { MailDomain, Mailbox } from './mail-validation';

function configuration() {
  try {
    const url = new URL(process.env.MAILCOW_API_URL ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const key = process.env.MAILCOW_API_KEY;
    return key ? {origin: url.origin, key} : null;
  } catch { return null; }
}
export function mailProviderAvailable(provider?: string) {
  return provider === 'postfix' ? localMailAvailable() : provider === 'mailcow' ? configuration() !== null : configuration() !== null || localMailAvailable();
}

async function request(path: string, body?: unknown): Promise<unknown> {
  const config = configuration();
  if (!config) throw new DomainError('Le connecteur de messagerie doit être configuré par l’administrateur.', 503);
  const response = await fetch(config.origin + '/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
    headers: {'X-API-Key': config.key, 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('MailProviderUnavailable');
  const result: unknown = await response.json();
  if (body !== undefined && (!Array.isArray(result) || !result.length ||
      !result.every(item => item && typeof item === 'object' && item.type === 'success'))) {
    // Provider responses can contain request logs. Never forward or persist them.
    throw new Error('MailProviderRejected');
  }
  return result;
}
export async function verifyMailDomain(domain: string, provider = 'mailcow') {
  if (provider === 'postfix') { await localMailRequest({operation: 'verify_domain', domain}); return; }
  const result = await request('get/domain/' + encodeURIComponent(domain));
  const entry = Array.isArray(result) ? result.find(item => item?.domain_name === domain) : result;
  if (!entry || typeof entry !== 'object' || !('domain_name' in entry) || entry.domain_name !== domain ||
      !('active' in entry) || ![1, '1', true].includes(entry.active as string | number | boolean)) {
    throw new DomainError('Créez et activez d’abord ce domaine chez le fournisseur de messagerie.', 409);
  }
}
export async function provisionMailbox(domain: MailDomain, mailbox: Mailbox, password?: string) {
  if (domain.provider === 'postfix') return provisionLocalMailbox(domain, mailbox, password);
  const address = mailbox.local_part + '@' + domain.domain;
  if (mailbox.operation === 'create') {
    const existing = await request('get/mailbox/' + encodeURIComponent(address));
    if (existing && typeof existing === 'object' && 'username' in existing) {
      throw new Error('MailProviderAddressAlreadyExists');
    }
    if (existing && (typeof existing !== 'object' || Object.keys(existing).length > 0)) {
      throw new Error('MailProviderLookupUncertain');
    }
    await request('add/mailbox', {
      active: '1', domain: domain.domain, local_part: mailbox.local_part, name: mailbox.display_name,
      quota: String(mailbox.quota_mb), password, password2: password, force_pw_update: '0',
      imap_access: '1', smtp_access: '1'
    });
  } else {
    const attr = mailbox.operation === 'reset_password'
      ? {password, password2: password}
      : {active: mailbox.operation === 'resume' ? '1' : '0'};
    await request('edit/mailbox', {items: [address], attr});
  }
}

