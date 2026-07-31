CREATE TABLE IF NOT EXISTS workflow_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_type text NOT NULL,
  correlation_id text NOT NULL,
  causation_event_id uuid NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  run_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  payload jsonb NOT NULL,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (causation_event_id, workflow_type)
);
CREATE INDEX IF NOT EXISTS workflow_jobs_due_idx ON workflow_jobs (run_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS workflow_jobs_scope_idx ON workflow_jobs (tenant_id, location_id, status);
