-- Modules visibles par client. Tous actifs par défaut : rien ne change pour les clients existants.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT ARRAY['tokens','billing','support','tickets','mail','usage'];

-- Suivi d'utilisation des applications des clients.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ingest_key_hash text UNIQUE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_version text;
CREATE TABLE IF NOT EXISTS app_usage_daily (
 application_id uuid NOT NULL REFERENCES applications(id), day date NOT NULL,
 events integer NOT NULL DEFAULT 0, sessions integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
 PRIMARY KEY(application_id,day)
);
CREATE TABLE IF NOT EXISTS app_usage_users (
 application_id uuid NOT NULL REFERENCES applications(id), day date NOT NULL, user_hash text NOT NULL,
 PRIMARY KEY(application_id,day,user_hash)
);

-- Utilisation réelle des boîtes mail, relevée auprès du serveur de messagerie.
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS used_mb integer CHECK (used_mb >= 0);
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS messages integer CHECK (messages >= 0);
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS usage_synced_at timestamptz;
CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments(ticket_id,created_at);
