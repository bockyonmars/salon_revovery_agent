CREATE TABLE IF NOT EXISTS client_cohort_snapshots (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'active-client-180d-v1'),
  activity_window_days integer NOT NULL CHECK (activity_window_days = 180),
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (period_to > period_from),
  CHECK (period_to - period_from <= interval '31 days')
);

CREATE INDEX IF NOT EXISTS client_cohort_tenant_period_idx
  ON client_cohort_snapshots (tenant_id, period_from, period_to, created_at DESC);

CREATE INDEX IF NOT EXISTS cohort_completed_bookings_idx
  ON bookings (tenant_id, created_at DESC)
  WHERE provider = 'square' AND record->>'providerStatus' = 'COMPLETED';

COMMENT ON TABLE client_cohort_snapshots IS
  'Immutable aggregate active-client cohort evidence derived only from authoritative completed Square bookings. Records contain no client or booking identifiers.';
