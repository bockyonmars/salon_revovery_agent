CREATE TABLE IF NOT EXISTS onboarding_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','failed')),
  configuration_fingerprint text NOT NULL,
  checks jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  record jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS onboarding_runs_scope_idx
  ON onboarding_runs (tenant_id,location_id,created_at DESC);

CREATE TABLE IF NOT EXISTS location_activations (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active')),
  onboarding_run_id uuid REFERENCES onboarding_runs(id),
  activated_at timestamptz,
  activated_by text,
  updated_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (tenant_id,location_id)
);
