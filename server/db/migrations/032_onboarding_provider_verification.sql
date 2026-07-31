CREATE TABLE IF NOT EXISTS onboarding_provider_verification_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  location_id text NOT NULL REFERENCES locations(id),
  status text NOT NULL CHECK (status IN ('passed', 'failed')),
  checks jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_provider_verification_scope_time_idx
  ON onboarding_provider_verification_runs (tenant_id, location_id, completed_at DESC);

COMMENT ON TABLE onboarding_provider_verification_runs IS
  'Tenant activation evidence emitted only by the executable sandbox verifier; contains bounded statuses and hashed provider references, never credentials or customer content.';
