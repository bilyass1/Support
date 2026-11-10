import { request as httpRequest } from 'node:http';
import { DomainError } from './domain';
import type { MailDomain, Mailbox } from './mail-validation';

export function localMailAvailable() {
  return process.env.LOCAL_MAIL_SOCKET === '/run/supportflow-mail/broker.sock';
}

export function localMailRequest(body: Record<string, unknown>): Promise<void> {
  return localMailCall(body).then(() => undefined);
}

function localMailCall(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!localMailAvailable()) throw new DomainError('Connecteur Postfix/Dovecot non configuré.', 503);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({socketPath: process.env.LOCAL_MAIL_SOCKET, path: '/', method: 'POST',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)}}, res => {
      let response = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        response += chunk;
        if (response.length > 4096) req.destroy(new Error('LocalMailInvalidResponse'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const answer = JSON.parse(response);
          if (res.statusCode !== 200 || !answer || answer.ok !== true) throw new Error('LocalMailRejected');
          resolve(answer);
        } catch { reject(new Error('LocalMailRejected')); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('LocalMailTimeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function provisionLocalMailbox(domain: MailDomain, mailbox: Mailbox, password?: string) {
  if (!['create', 'reset_password'].includes(mailbox.operation ?? '')) {
    throw new DomainError('Suspension automatique non disponible pour ce connecteur.', 409);
  }
  await localMailRequest({operation: mailbox.operation, domain: domain.domain, local_part: mailbox.local_part,
    mailbox_id: mailbox.id, password});
}

/** Real size of a managed mailbox, read by the broker from its Maildir. Null when the broker predates this operation or refuses. */
export async function localMailboxUsage(domain: MailDomain, mailbox: Mailbox) {
  try {
    const answer = await localMailCall({operation: 'usage', domain: domain.domain, local_part: mailbox.local_part, mailbox_id: mailbox.id});
    const bytes = Number(answer.used_bytes), messages = Number(answer.messages), last = Number(answer.last_activity);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(messages) || messages < 0) return null;
    return {used_mb: Math.min(2_000_000_000, Math.ceil(bytes / 1_048_576)), messages: Math.min(2_000_000_000, messages),
      last_activity_at: Number.isFinite(last) && last > 0 ? new Date(last * 1000).toISOString() : null};
  } catch { return null; }
}
