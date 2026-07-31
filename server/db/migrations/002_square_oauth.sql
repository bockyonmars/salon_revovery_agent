ALTER TABLE integration_accounts ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states (expires_at);
