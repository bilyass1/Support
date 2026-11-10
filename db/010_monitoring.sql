-- Sites surveillés par client : disponibilité, certificat SSL, échéance du nom de domaine.
CREATE TABLE IF NOT EXISTS monitored_sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 label text NOT NULL, url text NOT NULL, domain_expires_at date, enabled boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown','up','down')), status_since timestamptz,
 fail_streak integer NOT NULL DEFAULT 0, last_checked_at timestamptz, last_latency_ms integer, last_error text,
 ssl_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, url)
);
CREATE TABLE IF NOT EXISTS site_checks_daily (
 site_id uuid NOT NULL REFERENCES monitored_sites(id) ON DELETE CASCADE, day date NOT NULL,
 checks integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0, latency_total_ms bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (site_id, day)
);
-- Une ligne par rappel déjà envoyé : la tâche planifiée peut tourner autant de fois qu'elle veut.
CREATE TABLE IF NOT EXISTS reminders_sent (key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
