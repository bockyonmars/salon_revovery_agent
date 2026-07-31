CREATE TABLE IF NOT EXISTS recovery_cases (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  recovery_type text NOT NULL, correlation_id text NOT NULL, workflow_job_id uuid NOT NULL,
  status text NOT NULL, potential_revenue_minor integer, currency text,
  opened_at timestamptz NOT NULL, resolved_at timestamptz, result_booking_id uuid,
  record jsonb NOT NULL,
  UNIQUE (tenant_id,location_id,recovery_type,correlation_id)
);
CREATE INDEX IF NOT EXISTS recovery_cases_scope_idx ON recovery_cases (tenant_id,location_id,status,opened_at DESC);
