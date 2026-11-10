import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

/** Addresses a monitored URL may never resolve to: the check runs on the server, inside its network. */
export function privateAddress(address) {
  if (net.isIPv6(address)) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return privateAddress(a.slice(7));
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb');
  }
  if (!net.isIPv4(address)) return true;
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
export function monitorUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  url.hash = '';
  return url.toString();
}
// Resolution and connection use the same answer, so a name cannot pass the check and then point elsewhere.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const allowed = addresses.filter(entry => !privateAddress(entry.address));
    if (!allowed.length) return callback(Object.assign(new Error('PrivateAddress'), { code: 'EPRIVATE' }));
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}
/** One availability check: any answer below 500 means the site is serving. Redirects are not followed. */
export function checkSite(target, timeoutMs = 10_000) {
  return new Promise(resolve => {
    const started = Date.now();
    const url = new URL(target), secure = url.protocol === 'https:';
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve({ latency_ms: Date.now() - started, ssl_expires_at: null, ...value }); } };
    const request = (secure ? https : http).request(url, { method: 'GET', lookup: guardedLookup, timeout: timeoutMs, headers: { 'User-Agent': 'SupportFlow-Monitor/1.0', Accept: '*/*' } }, response => {
      const certificate = secure && response.socket.getPeerCertificate ? response.socket.getPeerCertificate() : null;
      const expires = certificate && certificate.valid_to ? new Date(certificate.valid_to) : null;
      response.destroy();
      const ok = response.statusCode < 500;
      done({ ok, error: ok ? null : 'HTTP ' + response.statusCode, ssl_expires_at: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', error => done({ ok: false, error: String(error.code || error.name || 'Error').slice(0, 60) }));
    request.end();
  });
}
async function notify(db, organizationId, message) {
  await db.query('INSERT INTO notifications(organization_id,message) VALUES ($1,$2)', [organizationId, message]);
}
/** Checks every enabled site once. A site is declared down after two failed checks in a row, and up on the first success. */
export async function runMonitor(db, check = checkSite) {
  const sites = (await db.query('SELECT id,organization_id,label,url,status,fail_streak FROM monitored_sites WHERE enabled ORDER BY created_at')).rows;
  const summary = { checked: 0, down: 0, changed: 0 };
  for (let index = 0; index < sites.length; index += 5) {
    await Promise.all(sites.slice(index, index + 5).map(async site => {
      const result = await check(site.url);
      const streak = result.ok ? 0 : site.fail_streak + 1;
      const status = result.ok ? 'up' : streak >= 2 ? 'down' : site.status;
      const changed = status !== site.status;
      await db.query(`UPDATE monitored_sites SET status=$2,fail_streak=$3,last_checked_at=now(),last_latency_ms=$4,last_error=$5,
        ssl_expires_at=coalesce($6,ssl_expires_at),status_since=CASE WHEN $7 THEN now() ELSE status_since END WHERE id=$1`,
        [site.id, status, streak, result.latency_ms, result.error, result.ssl_expires_at, changed]);
      await db.query(`INSERT INTO site_checks_daily(site_id,day,checks,failures,latency_total_ms) VALUES ($1,current_date,1,$2,$3)
        ON CONFLICT (site_id,day) DO UPDATE SET checks=site_checks_daily.checks+1,failures=site_checks_daily.failures+$2,latency_total_ms=site_checks_daily.latency_total_ms+$3`,
        [site.id, result.ok ? 0 : 1, result.ok ? result.latency_ms : 0]);
      if (changed && status === 'down') await notify(db, site.organization_id, `Site indisponible : ${site.label} ne répond plus (${result.error}). Notre équipe est prévenue.`);
      if (changed && status === 'up' && site.status === 'down') await notify(db, site.organization_id, `Site rétabli : ${site.label} répond de nouveau.`);
      summary.checked++; if (status === 'down') summary.down++; if (changed) summary.changed++;
    }));
  }
  return summary;
}
/** Renewal and expiry reminders. Each one is recorded in reminders_sent, so it is sent exactly once. */
export async function runReminders(db) {
  let sent = 0;
  const once = async (key, organizationId, message) => {
    const inserted = await db.query('INSERT INTO reminders_sent(key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key', [key]);
    if (inserted.rows.length) { await notify(db, organizationId, message); sent++; }
  };
  const day = value => new Date(value).toLocaleDateString('fr-TN');
  const step = (days, steps) => steps.find(limit => days <= limit);
  const plans = (await db.query(`SELECT organization_id,ends_at::date::text AS day,(ends_at::date-current_date) AS left,snapshot->>'name' AS name FROM subscriptions WHERE ends_at::date-current_date BETWEEN 0 AND 30`)).rows;
  for (const p of plans) await once(`plan:${p.organization_id}:${p.day}:${step(p.left, [7, 30])}`, p.organization_id, `Rappel : votre formule ${p.name} arrive à échéance le ${day(p.day)} (dans ${p.left} jour(s)). Contactez-nous pour la renouveler.`);
  const domains = (await db.query(`SELECT id,organization_id,label,domain_expires_at::text AS day,(domain_expires_at-current_date) AS left FROM monitored_sites WHERE domain_expires_at-current_date BETWEEN 0 AND 30`)).rows;
  for (const d of domains) await once(`domain:${d.id}:${d.day}:${step(d.left, [7, 30])}`, d.organization_id, `Rappel : le nom de domaine de ${d.label} expire le ${day(d.day)} (dans ${d.left} jour(s)).`);
  const certificates = (await db.query(`SELECT id,organization_id,label,ssl_expires_at::date::text AS day,(ssl_expires_at::date-current_date) AS left FROM monitored_sites WHERE enabled AND ssl_expires_at::date-current_date BETWEEN 0 AND 14`)).rows;
  for (const c of certificates) await once(`ssl:${c.id}:${c.day}:${step(c.left, [3, 14])}`, c.organization_id, `Certificat SSL : celui de ${c.label} expire le ${day(c.day)} (dans ${c.left} jour(s)).`);
  const invoices = (await db.query(`SELECT id,organization_id,number,due_at::text AS day FROM invoices WHERE status='issued' AND due_at<current_date`)).rows;
  for (const i of invoices) await once(`invoice:${i.id}:overdue`, i.organization_id, `Rappel : la facture ${i.number} a dépassé son échéance du ${day(i.day)}. Merci de procéder au règlement.`);
  return { sent };
}
