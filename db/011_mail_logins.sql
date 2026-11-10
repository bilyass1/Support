-- Dernière connexion IMAP/POP3 relevée dans le journal Dovecot pour chaque boîte gérée.
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
-- Renseigné seulement quand le broker sait lire les connexions : distingue « aucune connexion » de « non mesuré ».
ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS login_checked_at timestamptz;
