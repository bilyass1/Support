ALTER TABLE email_domains DROP CONSTRAINT IF EXISTS email_domains_provider_check;
ALTER TABLE email_domains ADD CONSTRAINT email_domains_provider_check CHECK (provider IN ('manual','mailcow','postfix'));
