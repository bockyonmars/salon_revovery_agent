CREATE TABLE IF NOT EXISTS agent_evaluation_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  location_id text NOT NULL REFERENCES locations(id),
  dataset_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('deterministic', 'model')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed', 'failed')),
  total_cases integer NOT NULL CHECK (total_cases >= 150),
  passed_cases integer NOT NULL CHECK (passed_cases >= 0),
  failed_cases integer NOT NULL CHECK (failed_cases >= 0),
  metrics jsonb NOT NULL,
  record jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (passed_cases + failed_cases = total_cases)
);

CREATE INDEX IF NOT EXISTS agent_evaluation_runs_scope_time_idx
  ON agent_evaluation_runs (tenant_id, location_id, completed_at DESC);

COMMENT ON TABLE agent_evaluation_runs IS
  'Synthetic golden-set release evidence. Records contain metrics and failure identifiers, never customer messages or model traces.';
