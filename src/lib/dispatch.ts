import { pool } from './db';
import { appUrl, mailerAvailable, renderEmail, sendEmail } from './mailer';
import { pushPublicKey, sendPush, type PushTarget } from './push';

type Job = {id: string; user_id: string; channel: 'email' | 'push'; attempts: number; title: string; message: string; tab: string; ticket_id: string | null; email: string | null};
const MAX_ATTEMPTS = 5;

/**
 * Sends queued e-mails and push notifications. Called right after each action commits, and by the
 * scheduled job with retry=true to pick up earlier failures. Rows are claimed with SKIP LOCKED, so
 * concurrent runs never send the same delivery twice.
 */
export async function flushDeliveries(retry = false) {
  const claimed = await pool.query(`UPDATE deliveries d SET status='sending',claimed_at=now(),attempts=d.attempts+1
    FROM notifications n, "user" u
    WHERE d.id IN (SELECT id FROM deliveries WHERE (status='pending' AND (attempts=0 OR $1))
        OR (status='sending' AND claimed_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
      AND n.id=d.notification_id AND u.id=d.user_id
    RETURNING d.id,d.user_id,d.channel,d.attempts,n.title,n.message,n.tab,n.ticket_id,u.email`, [retry]);
  const summary = {sent: 0, skipped: 0, failed: 0};
  await Promise.all((claimed.rows as Job[]).map(async job => {
    const link = appUrl() + '/?tab=' + encodeURIComponent(job.tab) + (job.ticket_id ? '&ticket=' + job.ticket_id : '');
    let status: 'sent' | 'skipped' | 'pending' | 'failed' = 'sent', error: string | null = null;
    try {
      if (job.channel === 'email') {
        if (!mailerAvailable() || !job.email) status = 'skipped';
        else await sendEmail(job.email, job.title, renderEmail(job.title, job.message, link));
      } else if (!pushPublicKey()) status = 'skipped';
      else {
        const targets = await pool.query('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1', [job.user_id]);
        if (!targets.rowCount) status = 'skipped';
        const results = await Promise.allSettled((targets.rows as PushTarget[]).map(async target => {
          if (await sendPush(target, {title: job.title, body: job.message, url: link, tag: job.ticket_id ?? undefined}) === 'gone') {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [target.endpoint]);
          }
        }));
        if (results.length && results.every(result => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
      }
    } catch (failure) {
      // Keep only the error class: provider messages can echo addresses or payloads.
      error = failure instanceof Error ? (failure.name + ':' + ((failure as {code?: string}).code ?? '')).slice(0, 120) : 'UnknownError';
      status = job.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    }
    summary[status === 'pending' ? 'failed' : status]++;
    await pool.query(`UPDATE deliveries SET status=$2,error=$3,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1`, [job.id, status, error]);
  }));
  return summary;
}
