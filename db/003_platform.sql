-- Modules par client, coordonnées de facturation
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT ARRAY['tickets','credits','mail','billing','usage'];
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address text;
CREATE INDEX IF NOT EXISTS memberships_org ON memberships(organization_id);

-- Suivi d'utilisation des applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ingest_key_hash text UNIQUE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_version text;
CREATE TABLE IF NOT EXISTS app_usage_daily (
  application_id uuid NOT NULL REFERENCES applications(id), day date NOT NULL,
  events integer NOT NULL DEFAULT 0, sessions integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (application_id, day)
);
CREATE TABLE IF NOT EXISTS app_usage_users (
  application_id uuid NOT NULL REFERENCES applications(id), day date NOT NULL, user_hash text NOT NULL,
  PRIMARY KEY (application_id, day, user_hash)
);

-- Tickets : priorité, assignation, SLA, satisfaction, notes internes, pièces jointes
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignee_id text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating integer CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating_comment text;
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments(ticket_id, created_at);
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES tickets(id),
  uploaded_by text NOT NULL, name text NOT NULL, mime text NOT NULL, size integer NOT NULL CHECK (size > 0),
  data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket ON ticket_attachments(ticket_id);

-- Notifications ciblées, lecture, envoi e-mail et push
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'client' CHECK (audience IN ('client','staff'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'SupportFlow';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tab text NOT NULL DEFAULT 'notifications';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ticket_id uuid;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text UNIQUE;
CREATE INDEX IF NOT EXISTS notifications_org ON notifications(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_seen (user_id text PRIMARY KEY, seen_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL REFERENCES notifications(id),
  user_id text NOT NULL, channel text NOT NULL CHECK (channel IN ('email','push')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0, error text, claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries(created_at) WHERE status IN ('pending','sending');
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL, auth text NOT NULL, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);

-- Facturation
CREATE SEQUENCE IF NOT EXISTS invoice_number;
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint NOT NULL DEFAULT nextval('invoice_number'),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','cancelled')),
  currency text NOT NULL DEFAULT 'TND', items jsonb NOT NULL,
  subtotal_minor integer NOT NULL CHECK (subtotal_minor >= 0), tax_rate_bp integer NOT NULL DEFAULT 1900 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_minor integer NOT NULL CHECK (tax_minor >= 0), stamp_minor integer NOT NULL DEFAULT 0 CHECK (stamp_minor >= 0),
  total_minor integer NOT NULL CHECK (total_minor >= 0), note text,
  due_at date NOT NULL, issued_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_org ON invoices(organization_id, created_at DESC);

-- Utilisation réelle des boîtes mail (relevée chez le fournisseur)
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS used_mb integer;
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS messages integer;
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS usage_synced_at timestamptz;

-- Annonces aux clients
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
  title text NOT NULL, body text NOT NULL, author_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created ON audit_events(created_at DESC);
