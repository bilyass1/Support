ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_address text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_domain text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS client_onboarding (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 needs_password boolean NOT NULL DEFAULT true,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE OR REPLACE FUNCTION complete_client_password() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."providerId"='credential' AND NEW.password IS DISTINCT FROM OLD.password THEN
  UPDATE client_onboarding SET needs_password=false,completed_at=coalesce(completed_at,now()) WHERE user_id=NEW."userId";
  DELETE FROM session_assurance WHERE user_id=NEW."userId";
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS client_password_changed ON "account";
CREATE TRIGGER client_password_changed AFTER UPDATE OF password ON "account" FOR EACH ROW EXECUTE FUNCTION complete_client_password();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_tax_id text NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_address text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS invoice_files (
 invoice_id uuid PRIMARY KEY REFERENCES invoices(id),storage_key text NOT NULL UNIQUE,
 size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=10485760),
 sha256 text NOT NULL,uploaded_by text NOT NULL,uploaded_at timestamptz NOT NULL DEFAULT now()
);
