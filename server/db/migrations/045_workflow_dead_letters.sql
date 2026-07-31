CREATE TABLE IF NOT EXISTS workflow_dead_letters (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_job_id uuid NOT NULL REFERENCES workflow_jobs(id),
  workflow_type text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  failure_detail text NOT NULL CHECK (char_length(failure_detail) BETWEEN 1 AND 240),
  approval_id uuid NOT NULL UNIQUE REFERENCES approval_requests(id),
  record jsonb NOT NULL,
  failed_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_dead_letters_scope_idx
  ON workflow_dead_letters (tenant_id, location_id, failed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS workflow_dead_letters_job_idx
  ON workflow_dead_letters (tenant_id, location_id, workflow_job_id, failed_at DESC);

COMMENT ON TABLE workflow_dead_letters IS
  'Immutable tenant-scoped terminal workflow failure evidence. Replays retain prior dead letters and require the linked approval.';
