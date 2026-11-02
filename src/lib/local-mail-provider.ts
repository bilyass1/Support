import { request as httpRequest } from 'node:http';
import { DomainError } from './domain';
import type { MailDomain, Mailbox } from './mail-validation';

export function localMailAvailable() {
  return process.env.LOCAL_MAIL_SOCKET === '/run/supportflow-mail/broker.sock';
}

export function localMailRequest(body: Record<string, unknown>): Promise<void> {
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
          if (res.statusCode !== 200 || JSON.parse(response).ok !== true) throw new Error('LocalMailRejected');
          resolve();
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
