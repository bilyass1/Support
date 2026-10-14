ALTER TABLE plans ADD COLUMN IF NOT EXISTS mail_max_mailboxes integer NOT NULL DEFAULT 0 CHECK (mail_max_mailboxes >= 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS mail_total_mb integer NOT NULL DEFAULT 0 CHECK (mail_total_mb >= 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS mail_per_box_mb integer NOT NULL DEFAULT 0 CHECK (mail_per_box_mb >= 0);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS mail_create_tokens integer NOT NULL DEFAULT 0 CHECK (mail_create_tokens >= 0);
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS reserved_tokens integer NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0);
CREATE TABLE IF NOT EXISTS token_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, tokens integer NOT NULL CHECK(tokens>0),
 price_minor integer NOT NULL CHECK(price_minor>=0), currency text NOT NULL CHECK(currency IN ('TND','EUR','USD')),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS purchase_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 requested_by text NOT NULL, offer_id uuid NOT NULL REFERENCES token_offers(id), snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note text NOT NULL DEFAULT '', reviewed_by text, reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 created_by text NOT NULL, title text NOT NULL, body text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES support_cases(id),
 author_id text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS invoice_number;
CREATE TABLE IF NOT EXISTS invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL UNIQUE,
 organization_id uuid NOT NULL REFERENCES organizations(id), purchase_id uuid UNIQUE REFERENCES purchase_requests(id),
 description text NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor>=0),
 currency text NOT NULL CHECK(currency IN ('TND','EUR','USD')),
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','void')),
 issuer jsonb NOT NULL, client_name text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), due_at date NOT NULL,
 created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_settings (key text PRIMARY KEY, value jsonb NOT NULL);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE TABLE IF NOT EXISTS notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notification_id uuid NOT NULL UNIQUE REFERENCES notifications(id),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
 endpoint text PRIMARY KEY, user_id text NOT NULL, subscription jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS low_balance_state (organization_id uuid PRIMARY KEY REFERENCES organizations(id));
CREATE INDEX IF NOT EXISTS requests_org ON purchase_requests(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS cases_org ON support_cases(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_org ON invoices(organization_id,issued_at DESC);
CREATE OR REPLACE FUNCTION enqueue_supportflow_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO notification_outbox(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notify_outbox ON notifications;
CREATE TRIGGER notify_outbox AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_supportflow_notification();
CREATE OR REPLACE FUNCTION supportflow_low_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocation integer; claimed uuid;
BEGIN
 SELECT greatest(coalesce((snapshot->>'annual_tokens')::integer,0),1) INTO allocation FROM subscriptions WHERE organization_id=NEW.organization_id;
 IF allocation IS NULL THEN RETURN NEW; END IF;
 IF NEW.balance-NEW.reserved <= greatest(1,ceil(allocation*0.2)::integer) THEN
   INSERT INTO low_balance_state VALUES(NEW.organization_id) ON CONFLICT DO NOTHING RETURNING organization_id INTO claimed;
   IF claimed IS NOT NULL THEN INSERT INTO notifications(organization_id,message) VALUES(NEW.organization_id,'Votre réserve de tokens est basse. Vous pouvez demander une recharge, soumise à validation de l’admin.'); END IF;
 ELSE DELETE FROM low_balance_state WHERE organization_id=NEW.organization_id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS low_balance ON wallets;
CREATE TRIGGER low_balance AFTER UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION supportflow_low_balance();
