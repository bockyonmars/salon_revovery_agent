CREATE TABLE IF NOT EXISTS privacy_erasure_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','completed','superseded')),
  policy_version text NOT NULL,
  policy_updated_at timestamptz NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  record jsonb NOT NULL,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS privacy_erasure_one_pending_client_idx
  ON privacy_erasure_requests (tenant_id,location_id,client_id)
  WHERE status='pending';

CREATE TABLE IF NOT EXISTS privacy_erasure_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  request_id uuid NOT NULL UNIQUE REFERENCES privacy_erasure_requests(id),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  record jsonb NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS privacy_erasure_receipts_scope_idx
  ON privacy_erasure_receipts (tenant_id,location_id,completed_at DESC);

COMMENT ON TABLE privacy_erasure_requests IS 'ID-only, expiring plans prepared from an effective retention policy and revalidated before execution.';
COMMENT ON TABLE privacy_erasure_receipts IS 'Metadata-only results for completed policy cleanup. Consent and audit records are never included in deletion plans.';
