CREATE TABLE IF NOT EXISTS privacy_data_export_receipts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  requested_by text NOT NULL,
  reason text NOT NULL,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  record_counts jsonb NOT NULL,
  generated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS privacy_data_export_scope_idx
  ON privacy_data_export_receipts (tenant_id,location_id,generated_at DESC);

COMMENT ON TABLE privacy_data_export_receipts IS 'Metadata-only receipts for client access exports. Exported personal data is never persisted here.';
