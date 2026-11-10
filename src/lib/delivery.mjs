import nodemailer from 'nodemailer';
import webpush from 'web-push';
import { createHash, createDecipheriv } from 'node:crypto';
import { allowedPushEndpoint } from './push-endpoint.mjs';

/** True when the process has what it needs to send; the web process stays silent otherwise and the timer reports it. */
export function deliveryConfigured(env = process.env) {
  return Boolean(env.DATABASE_URL && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL);
}
let transport = null;
function mailer(env) {
  const port = Number(env.SMTP_PORT ?? 587);
  if (![465, 587].includes(port)) throw Error('Use TLS SMTP on 465 or STARTTLS on 587');
  transport ??= nodemailer.createTransport({host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port === 587,
    auth: {user: env.SMTP_USER, pass: env.SMTP_PASSWORD}, tls: {minVersion: 'TLSv1.2', rejectUnauthorized: true}, connectionTimeout: 10000, socketTimeout: 15000});
  return transport;
}
export function closeDelivery() { transport?.close(); transport = null; }
/** One line, no control characters, short enough for a subject or a lock-screen notification. */
export function summary(message, length = 90) {
  const line = String(message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return line.length > length ? line.slice(0, length - 1).trimEnd() + '…' : line;
}

/**
 * Sends queued password-recovery e-mails and activity notifications (e-mail + push).
 * Shared by the minute timer and by the web process, which calls it right after an action commits.
 * Jobs are claimed with SKIP LOCKED and pushed five minutes ahead, so two runners never send the same job.
 */
export async function deliverPending(pool, env = process.env, housekeeping = true) {
  if (!deliveryConfigured(env)) throw Error('Configure database and SMTP credentials before starting delivery');
  const origin = new URL(env.BETTER_AUTH_URL).origin, smtp = mailer(env);
  const pushEnabled = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  if (pushEnabled) webpush.setVapidDetails('mailto:contact@solumove.net', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const send = (to, subject, text, from = 'contact@solumove.net') => smtp.sendMail({from: {name: 'Solumove', address: from}, to, subject, text, disableFileAccess: true, disableUrlAccess: true});
  const claim = async table => (await pool.query(`UPDATE ${table} SET attempts=attempts+1,available_at=now()+interval '5 minutes' WHERE id=(SELECT id FROM ${table} WHERE delivered_at IS NULL AND available_at<=now() AND attempts<5 ${table === 'auth_email_jobs' ? 'AND expires_at>now()' : ''} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];
  const result = {auth: 0, notifications: 0, failed: 0};
  if (housekeeping) {
    await pool.query('DELETE FROM app_rate_limits WHERE bucket<$1', [Math.floor(Date.now() / 60000) - 1440]);
    await pool.query("DELETE FROM session_assurance WHERE verified_at<now()-interval '2 days'");
    await pool.query("DELETE FROM auth_email_jobs WHERE expires_at<now() OR delivered_at<now()-interval '1 day'");
  }
  for (let i = 0; i < 20; i++) {
    const job = await claim('auth_email_jobs'); if (!job) break;
    try {
      const b = Buffer.from(job.payload, 'base64'), cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(env.BETTER_AUTH_SECRET).digest(), b.subarray(0, 12));
      cipher.setAuthTag(b.subarray(12, 28));
      const mail = JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString());
      await send(mail.to, mail.subject, mail.text, 'administration@solumove.net');
      await pool.query('UPDATE auth_email_jobs SET delivered_at=now(),payload=$2 WHERE id=$1', [job.id, '']);
      result.auth++;
    } catch { result.failed++; console.error('Auth email delivery failed; retry scheduled.'); }
  }
  for (let i = 0; i < 20; i++) {
    const job = await claim('notification_outbox'); if (!job) break;
    try {
      const notification = (await pool.query('SELECT * FROM notifications WHERE id=$1', [job.notification_id])).rows[0];
      const users = (await pool.query(`SELECT DISTINCT u.id,u.email FROM "user" u WHERE u.id IN(SELECT user_id FROM memberships WHERE organization_id=$1 UNION SELECT user_id FROM app_roles WHERE role='admin')`, [notification.organization_id])).rows;
      for (const user of users) {
        await send(user.email, 'Solumove — ' + summary(notification.message), notification.message + '\n\nOuvrir votre espace : ' + origin);
        if (pushEnabled) {
          const subscriptions = (await pool.query('SELECT endpoint,subscription FROM push_subscriptions WHERE user_id=$1', [user.id])).rows;
          for (const row of subscriptions) {
            if (!allowedPushEndpoint(row.endpoint)) continue;
            try { await webpush.sendNotification(row.subscription, JSON.stringify({activity: true, body: summary(notification.message, 160)}), {TTL: 3600, urgency: 'high', timeout: 10000}); }
            catch (e) { if ([404, 410].includes(e.statusCode)) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [row.endpoint, user.id]); else throw e; }
          }
        }
      }
      await pool.query('UPDATE notification_outbox SET delivered_at=now() WHERE id=$1', [job.id]);
      result.notifications++;
    } catch { result.failed++; console.error('Activity notification delivery failed; retry scheduled.'); }
  }
  return result;
}
