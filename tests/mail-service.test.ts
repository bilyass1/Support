import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import type { Actor } from '../src/lib/service';
const harness = vi.hoisted(() => ({db: null as unknown as import('@electric-sql/pglite').PGlite,
  available: true, provision: vi.fn(async () => {}), verify: vi.fn(async () => {})}));
vi.mock('../src/lib/db', () => ({
  pool: {query: async (text: string, values?: unknown[]) => {
    const result = await harness.db.query(text, values); return {rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0};
  }},
  transaction: async (operation: (c: PoolClient) => Promise<unknown>) => harness.db.transaction(async db => operation({
    query: async (text: string, values?: unknown[]) => {const result = await db.query(text, values); return {rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0};}
  } as PoolClient))
}));
vi.mock('../src/lib/mail-provider', () => ({mailProviderAvailable: () => harness.available,
  provisionMailbox: (...args: unknown[]) => (harness.provision as (...args: unknown[]) => Promise<void>)(...args),
  verifyMailDomain: (...args: unknown[]) => (harness.verify as (...args: unknown[]) => Promise<void>)(...args)}));
import { mailAct, mailWorkspace } from '../src/lib/mail-service';
import { mailActionSchema, type MailDomain } from '../src/lib/mail-validation';
const admin: Actor = {id: 'admin', name: 'Admin', role: 'admin', organization_id: null};
let client: Actor, other: Actor;
const secret = 'RequestOnly-Password-8971';
const run = (actor: Actor, input: unknown) => mailAct(actor, mailActionSchema.parse(input));
const rows = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await harness.db.query<T>(sql, args)).rows;
beforeAll(async () => {
  harness.db = new PGlite();
  for (const name of ['001_initial.sql', '002_email.sql']) await harness.db.exec(await readFile(new URL('../db/' + name, import.meta.url), 'utf8'));
});
afterAll(async () => {await harness.db.close();});
beforeEach(async () => {
  await harness.db.exec('TRUNCATE organizations CASCADE; TRUNCATE audit_events;');
  const orgs = await rows<{id: string}>("INSERT INTO organizations(name) VALUES ('Client A'),('Client B') RETURNING id");
  client = {id: 'client', name: 'Client', role: 'client', organization_id: orgs[0].id};
  other = {id: 'other', name: 'Other', role: 'client', organization_id: orgs[1].id};
  harness.available = true; harness.provision.mockReset(); harness.verify.mockReset();
});
async function domain(overrides: Record<string, unknown> = {}) {
  await run(admin, {type: 'save_domain', organization_id: client.organization_id, domain: 'client.example', provider: 'manual',
    enabled: true, max_mailboxes: null, total_quota_mb: 20480, mailbox_quota_mb: 1024,
    imap_host: 'mail.client.example', smtp_host: 'smtp.client.example', smtp_port: 587, ...overrides});
  return (await mailWorkspace(admin)).domains.find(d => d.domain === String(overrides.domain ?? 'client.example').trim().toLowerCase()) as MailDomain;
}
async function create(d: MailDomain, local = 'contact', quota = 1024, actor = client) {
  await run(actor, {type: 'create_mailbox', domain_id: d.id, local_part: local, display_name: 'Contact', quota_mb: quota, password: secret});
  return (await mailWorkspace(actor)).mailboxes.find(b => b.local_part === local)!;
}
async function resolve(id: string, completed = true) {
  return run(admin, {type: 'resolve_operation', mailbox_id: id, completed, verified: true, note: 'État vérifié dans le panneau du fournisseur.'});
}
describe('email organizations and provisioning', () => {
  it('lets only the admin enter arbitrary normalized domain names and assign their clients', async () => {
    const d = await domain({domain: '  Entreprise.TN  '});
    expect((await mailWorkspace(client)).domains[0].domain).toBe('entreprise.tn');
    await domain({domain: 'other.example', organization_id: other.organization_id});
    expect((await mailWorkspace(client)).domains).toHaveLength(1);
    expect((await mailWorkspace(other)).domains[0].domain).toBe('other.example');
    await expect(run(client, {type: 'save_domain', ...d, domain: 'intrusion.example'})).rejects.toThrow('admin');
  });
  it('isolates mailboxes, requests and quotas across clients and denies unassigned accounts', async () => {
    const d = await domain();
    const box = await create(d);
    expect(box.status).toBe('pending'); expect(box.operation_state).toBe('pending');
    expect((await mailWorkspace(other)).mailboxes).toHaveLength(0);
    await expect(create(d, 'intrusion', 1, other)).rejects.toThrow('refusé');
    await expect(run(other, {type: 'mailbox_operation', mailbox_id: box.id, operation: 'suspend'})).rejects.toThrow('refusé');
    await expect(create(d, 'none', 1, {...client, organization_id: null})).rejects.toThrow('refusé');
    expect(harness.provision).not.toHaveBeenCalled();
  });
  it('reserves pending quotas and finite counts, rejects duplicate addresses and frees cancelled requests', async () => {
    const d = await domain({max_mailboxes: 1});
    const box = await create(d);
    await expect(create(d, 'second')).rejects.toThrow('maximal');
    await resolve(box.id, false);
    const replacement = await create(d);
    expect(replacement.id).not.toBe(box.id);
    const view = await mailWorkspace(client);
    expect(view.domains[0].mailbox_count).toBe(1); expect(view.domains[0].allocated_quota_mb).toBe(1024);
  });
  it('enforces per-mailbox and total storage even with no mailbox count cap', async () => {
    const d = await domain({total_quota_mb: 1500, mailbox_quota_mb: 1000});
    await create(d, 'first', 1000);
    await expect(create(d, 'large', 1001)).rejects.toThrow('Quota');
    await expect(create(d, 'second', 501)).rejects.toThrow('Quota');
    await create(d, 'second', 500);
    expect((await mailWorkspace(client)).domains[0].allocated_quota_mb).toBe(1500);
  });
  it('requires admin confirmation after real manual work, then permits suspend and resume requests', async () => {
    const d = await domain(); const box = await create(d);
    await expect(run(client, {type: 'resolve_operation', mailbox_id: box.id, completed: true, verified: true, note: 'Fake activation attempt'})).rejects.toThrow('admin');
    await resolve(box.id);
    await run(client, {type: 'mailbox_operation', mailbox_id: box.id, operation: 'suspend'});
    expect((await mailWorkspace(client)).mailboxes[0].status).toBe('active');
    await expect(run(client, {type: 'mailbox_operation', mailbox_id: box.id, operation: 'suspend'})).rejects.toThrow('déjà');
    await resolve(box.id); expect((await mailWorkspace(client)).mailboxes[0].status).toBe('suspended');
    await run(client, {type: 'mailbox_operation', mailbox_id: box.id, operation: 'resume'});
    await resolve(box.id); expect((await mailWorkspace(client)).mailboxes[0].status).toBe('active');
  });
  it('rejects duplicate canonical addresses, reassignment, provider changes and lowering allocated limits', async () => {
    const d = await domain(); await create(d);
    await expect(create(d, 'CONTACT')).rejects.toThrow('existe déjà');
    await expect(run(admin, {type: 'save_domain', ...d, organization_id: other.organization_id})).rejects.toThrow('réaffectés');
    await expect(run(admin, {type: 'save_domain', ...d, provider: 'mailcow'})).rejects.toThrow('fournisseur');
    await expect(run(admin, {type: 'save_domain', ...d, total_quota_mb: 500, mailbox_quota_mb: 500})).rejects.toThrow('inférieures');
  });
  it('requires an enabled domain, a ready automatic connector and a password before reservation', async () => {
    const d = await domain({enabled: false});
    await expect(create(d)).rejects.toThrow('configuration');
    const automatic = await domain({domain: 'automatic.example', provider: 'mailcow'});
    await expect(run(client, {type: 'create_mailbox', domain_id: automatic.id, local_part: 'test', display_name: 'Test', quota_mb: 1})).rejects.toThrow('mot de passe');
    harness.available = false;
    await expect(create(automatic)).rejects.toThrow('indisponible');
    expect((await mailWorkspace(client)).mailboxes).toHaveLength(0);
  });
  it('confirms automatic creation and password changes without persisting their secrets', async () => {
    const d = await domain({provider: 'mailcow'}); const box = await create(d);
    expect(box.status).toBe('active'); expect(box.operation).toBeNull();
    expect(harness.verify).toHaveBeenCalledWith('client.example');
    await run(client, {type: 'mailbox_operation', mailbox_id: box.id, operation: 'reset_password', password: secret});
    expect(harness.provision).toHaveBeenCalledTimes(2);
    const stored = JSON.stringify(await rows('SELECT * FROM email_mailboxes')) + JSON.stringify(await rows('SELECT * FROM audit_events'));
    expect(stored).not.toContain(secret); expect(stored).not.toContain('password2');
  });
  it('retains a failed provider operation for verification without faking activation or allowing retries', async () => {
    harness.provision.mockRejectedValueOnce(new Error('Provider response with ' + secret));
    const d = await domain({provider: 'mailcow'}); const box = await create(d);
    expect(box.status).toBe('pending'); expect(box.operation_state).toBe('failed');
    await expect(create(d)).rejects.toThrow('existe déjà');
    expect(JSON.stringify(await mailWorkspace(client))).not.toContain(secret);
    await resolve(box.id, false); expect((await mailWorkspace(client)).domains[0].allocated_quota_mb).toBe(0);
  });
  it('persists processing before contacting the provider and prevents early manual resolution', async () => {
    let finish!: () => void;
    harness.provision.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
    const d = await domain({provider: 'mailcow'});
    const operation = create(d);
    await vi.waitFor(() => expect(harness.provision).toHaveBeenCalled());
    const box = (await mailWorkspace(client)).mailboxes[0];
    expect(box.operation_state).toBe('processing');
    await expect(resolve(box.id)).rejects.toThrow('en cours');
    finish(); await operation;
    expect((await mailWorkspace(client)).mailboxes[0].status).toBe('active');
  });
  it('paginates mailbox lists while aggregating all reservations and limits manager mutations', async () => {
    const d = await domain();
    await harness.db.query(`INSERT INTO email_mailboxes(domain_id,local_part,display_name,quota_mb,status)
      SELECT $1,'user'||n,'User',1,'active' FROM generate_series(1,51) AS n`, [d.id]);
    expect((await mailWorkspace(client)).mailboxes).toHaveLength(50);
    expect((await mailWorkspace(client, 1)).mailboxes).toHaveLength(1);
    expect((await mailWorkspace(client)).domains[0].mailbox_count).toBe(51);
    expect((await mailWorkspace(other)).total_mailboxes).toBe(0);
    await expect(create(d, 'manager', 1, {...admin, role: 'manager'})).rejects.toThrow('refusé');
  });
  it('applies the additive email migration idempotently without removing original records', async () => {
    const d = await domain(); await create(d);
    await harness.db.exec(await readFile(new URL('../db/002_email.sql', import.meta.url), 'utf8'));
    expect((await mailWorkspace(client)).domains[0].domain).toBe('client.example');
    expect((await mailWorkspace(client)).mailboxes).toHaveLength(1);
  });
});
