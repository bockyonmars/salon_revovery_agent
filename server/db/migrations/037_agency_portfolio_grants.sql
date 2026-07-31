CREATE TABLE IF NOT EXISTS agency_accounts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status = 'active'),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_invitations (
  id uuid PRIMARY KEY,
  agency_tenant_id text NOT NULL,
  client_tenant_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending','accepted','expired','revoked')),
  scopes text[] NOT NULL CHECK (scopes = ARRAY['portfolio_read']::text[]),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CHECK (agency_tenant_id <> client_tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS agency_invitation_pending_pair_idx
  ON agency_invitations (agency_tenant_id, client_tenant_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agency_invitation_client_idx
  ON agency_invitations (client_tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS agency_grants (
  id uuid PRIMARY KEY,
  agency_tenant_id text NOT NULL,
  client_tenant_id text NOT NULL,
  invitation_id uuid NOT NULL UNIQUE REFERENCES agency_invitations(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','revoked')),
  scopes text[] NOT NULL CHECK (scopes = ARRAY['portfolio_read']::text[]),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (agency_tenant_id <> client_tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS agency_grant_active_pair_idx
  ON agency_grants (agency_tenant_id, client_tenant_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS agency_grant_client_idx
  ON agency_grants (client_tenant_id, status, created_at DESC);

COMMENT ON TABLE agency_grants IS
  'Bilateral, revocable, read-only access grants. Initial scope is aggregate portfolio_read only.';

COMMENT ON COLUMN agency_invitations.token_hash IS
  'SHA-256 digest of a short-lived invitation secret. Raw tokens are returned once and never persisted.';
