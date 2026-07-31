CREATE TABLE IF NOT EXISTS provider_reconciliation_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','partial')),
  providers text[] NOT NULL CHECK (cardinality(providers) BETWEEN 1 AND 2 AND providers <@ ARRAY['square','twilio']::text[]),
  finding_count integer NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
  critical_count integer NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  record jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS provider_reconciliation_runs_scope_idx
  ON provider_reconciliation_runs (tenant_id,location_id,started_at DESC);

COMMENT ON TABLE provider_reconciliation_runs IS 'Read-only comparisons of local booking/message ledgers with provider state. Findings never directly mutate or replay customer operations.';
