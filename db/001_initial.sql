CREATE TABLE IF NOT EXISTS app_roles (
  user_id text PRIMARY KEY, role text NOT NULL CHECK (role IN ('admin','manager'))
);
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id text PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  annual_tokens integer NOT NULL CHECK (annual_tokens >= 0),
  price_minor integer NOT NULL CHECK (price_minor >= 0), currency text NOT NULL DEFAULT 'TND',
  support_level text NOT NULL, rules jsonb NOT NULL DEFAULT '[]', revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), plan_id uuid NOT NULL REFERENCES plans(id),
  snapshot jsonb NOT NULL, starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL DEFAULT (now() + interval '1 year')
);
CREATE TABLE IF NOT EXISTS wallets (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  balance integer NOT NULL DEFAULT 0, reserved integer NOT NULL DEFAULT 0,
  CHECK (balance >= 0 AND reserved >= 0 AND balance >= reserved)
);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL, kind text NOT NULL CHECK (kind IN ('web','mobile','software'))
);
CREATE SEQUENCE IF NOT EXISTS ticket_number;
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint NOT NULL DEFAULT nextval('ticket_number'),
  organization_id uuid NOT NULL REFERENCES organizations(id), application_id uuid NOT NULL REFERENCES applications(id),
  created_by text NOT NULL, title text NOT NULL, description text NOT NULL,
  category text NOT NULL CHECK (category IN ('design','development','bug')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','quoted','accepted','in_progress','ready','closed','cancelled')),
  estimated_tokens integer CHECK (estimated_tokens >= 0), estimate_revision integer NOT NULL DEFAULT 0,
  estimate_note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_org ON tickets(organization_id,created_at DESC);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  ticket_id uuid REFERENCES tickets(id), kind text NOT NULL,
  balance_delta integer NOT NULL, reserved_delta integer NOT NULL,
  note text NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES tickets(id),
  author_id text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL,
  action text NOT NULL, entity_id text NOT NULL, detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
