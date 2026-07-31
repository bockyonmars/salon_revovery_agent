CREATE TABLE IF NOT EXISTS model_usage_records (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider text NOT NULL CHECK (provider = 'openai'),
  provider_response_id text NOT NULL,
  agent_run_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('conversation_route','booking_specialist')),
  model text NOT NULL,
  usage_status text NOT NULL CHECK (usage_status IN ('reported','missing')),
  record jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (provider, provider_response_id)
);

CREATE INDEX IF NOT EXISTS model_usage_tenant_period_idx
  ON model_usage_records (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS model_usage_agent_run_idx
  ON model_usage_records (tenant_id, location_id, agent_run_id, occurred_at);

CREATE TABLE IF NOT EXISTS model_price_versions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL CHECK (provider = 'openai'),
  model text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz NOT NULL,
  evidence text NOT NULL CHECK (evidence = 'owner_attested'),
  record jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, provider, model, version),
  UNIQUE (tenant_id, provider, model, effective_from)
);

CREATE INDEX IF NOT EXISTS model_price_effective_idx
  ON model_price_versions (tenant_id, provider, model, effective_from DESC);

COMMENT ON TABLE model_usage_records IS
  'Immutable provider response usage evidence. Records contain response identifiers and token counts only, never prompts or model output.';

COMMENT ON TABLE model_price_versions IS
  'Append-only owner-attested price evidence. Cost reports resolve the latest effective version at each provider response timestamp.';
