CREATE TABLE IF NOT EXISTS auth_email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payload text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
