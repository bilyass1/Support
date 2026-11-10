-- Suivi des demandes : priorité, délai de première réponse, notes internes, satisfaction, pièces jointes.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating integer CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating_comment text;
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS ticket_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES tickets(id),
 uploaded_by text NOT NULL, name text NOT NULL, size integer NOT NULL CHECK (size > 0 AND size <= 5242880),
 data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket ON ticket_attachments(ticket_id);

-- Annonces publiées par l'admin (organization_id vide : tous les clients).
CREATE TABLE IF NOT EXISTS announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 title text NOT NULL, body text NOT NULL, author_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
