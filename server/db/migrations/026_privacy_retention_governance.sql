CREATE TABLE IF NOT EXISTS privacy_retention_policies (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  record jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id)
);

CREATE TABLE IF NOT EXISTS privacy_legal_holds (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','released')),
  expires_at timestamptz,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS privacy_legal_holds_client_idx
  ON privacy_legal_holds (tenant_id,location_id,client_id,created_at DESC);

CREATE INDEX IF NOT EXISTS privacy_legal_holds_active_idx
  ON privacy_legal_holds (tenant_id,location_id,client_id,expires_at)
  WHERE status='active';

COMMENT ON TABLE privacy_retention_policies IS 'Owner-attested, jurisdiction-specific retention configuration. No destructive task runs without an effective enabled policy.';
COMMENT ON TABLE privacy_legal_holds IS 'Client-scoped preservation holds that override retention eligibility until released or expired.';
