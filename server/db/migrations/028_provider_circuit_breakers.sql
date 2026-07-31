CREATE TABLE IF NOT EXISTS provider_circuit_breakers (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('square','twilio','openai','postmark')),
  state text NOT NULL CHECK (state IN ('closed','open','half_open')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_probe_at timestamptz,
  probe_lease_until timestamptz,
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id,provider)
);

CREATE INDEX IF NOT EXISTS provider_circuit_breakers_recovery_idx
  ON provider_circuit_breakers (state,next_probe_at)
  WHERE state <> 'closed';

COMMENT ON TABLE provider_circuit_breakers IS 'Tenant-scoped distributed circuit state. Advisory locks serialize half-open probe permits across API and worker replicas.';
