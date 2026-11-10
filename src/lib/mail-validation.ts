import { z } from 'zod';

export const hostname = z.string().trim().toLowerCase().min(3).max(253).regex(
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  'Indiquez un nom de domaine, sans https:// ni chemin.'
);
const id = z.uuid();
const quota = z.number().int().min(1).max(100_000_000);
const password = z.string().min(12).max(128).refine(value => !/[\r\n\u0000]/.test(value));
export const mailActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('save_domain'), id: id.optional(), organization_id: id, domain: hostname,
    provider: z.enum(['manual', 'mailcow']), enabled: z.boolean(),
    max_mailboxes: z.number().int().min(1).max(1_000_000).nullable(),
    total_quota_mb: quota, mailbox_quota_mb: quota, imap_host: hostname, smtp_host: hostname,
    smtp_port: z.union([z.literal(465), z.literal(587)])
  }).refine(value => value.mailbox_quota_mb <= value.total_quota_mb, {message: 'Quota par boîte supérieur au quota total.'}),
  z.object({
    type: z.literal('create_mailbox'), domain_id: id,
    local_part: z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    display_name: z.string().trim().min(1).max(120), quota_mb: quota, password: password.optional()
  }),
  z.object({type: z.literal('mailbox_operation'), mailbox_id: id,
    operation: z.enum(['suspend', 'resume', 'reset_password']), password: password.optional()}),
  z.object({type: z.literal('resolve_operation'), mailbox_id: id, completed: z.boolean(),
    verified: z.literal(true), note: z.string().trim().min(10).max(1000)})
]);
export type MailAction = z.infer<typeof mailActionSchema>;
export type MailDomain = {
  id: string; organization_id: string; domain: string; provider: 'manual' | 'mailcow'; enabled: boolean;
  max_mailboxes: number | null; total_quota_mb: number; mailbox_quota_mb: number;
  imap_host: string; smtp_host: string; smtp_port: 465 | 587;
  mailbox_count: number; allocated_quota_mb: number;
};
export type Mailbox = {
  id: string; domain_id: string; local_part: string; display_name: string; quota_mb: number;
  status: 'pending' | 'active' | 'suspended' | 'cancelled';
  operation: 'create' | 'suspend' | 'resume' | 'reset_password' | null;
  operation_state: 'pending' | 'processing' | 'failed' | null;
  operation_started_at: string | null;
};
export type MailWorkspace = {domains: MailDomain[]; mailboxes: Mailbox[]; automatic_available: boolean; page: number; total_mailboxes: number};
