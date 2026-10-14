CREATE TABLE IF NOT EXISTS session_assurance (session_id text PRIMARY KEY,user_id text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_rate_limits (user_id text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL,PRIMARY KEY(user_id,bucket));
