CREATE TABLE IF NOT EXISTS email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  domain text NOT NULL UNIQUE CHECK (domain = lower(domain)),
  provider text NOT NULL CHECK (provider IN ('manual','mailcow')),
  enabled boolean NOT NULL DEFAULT false,
  max_mailboxes integer CHECK (max_mailboxes > 0),
  total_quota_mb integer NOT NULL CHECK (total_quota_mb > 0),
  mailbox_quota_mb integer NOT NULL CHECK (mailbox_quota_mb > 0 AND mailbox_quota_mb <= total_quota_mb),
  imap_host text NOT NULL, smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 587 CHECK (smtp_port IN (465,587)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_domains_org ON email_domains(organization_id);
CREATE TABLE IF NOT EXISTS email_mailboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES email_domains(id),
  local_part text NOT NULL, display_name text NOT NULL,
  quota_mb integer NOT NULL CHECK (quota_mb > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','cancelled')),
  operation text CHECK (operation IN ('create','suspend','resume','reset_password')),
  operation_state text CHECK (operation_state IN ('pending','processing','failed')),
  operation_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation IS NULL) = (operation_state IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS email_mailboxes_address ON email_mailboxes(domain_id,local_part) WHERE status <> 'cancelled';
