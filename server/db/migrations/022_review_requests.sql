CREATE TABLE IF NOT EXISTS review_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_job_id uuid NOT NULL REFERENCES workflow_jobs(id),
  appointment_id text NOT NULL,
  client_id text NOT NULL,
  public_review_url text,
  status text NOT NULL CHECK (status IN ('reserved','sent','closed')),
  provider_message_id text,
  close_reason text,
  feedback_status text CHECK (feedback_status IS NULL OR feedback_status='negative'),
  feedback_message_id uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  recovery_approval_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  closed_at timestamptz,
  UNIQUE (workflow_job_id),
  UNIQUE (tenant_id,location_id,appointment_id)
);

CREATE INDEX IF NOT EXISTS review_requests_client_sent_idx
  ON review_requests (tenant_id,location_id,client_id,sent_at DESC)
  WHERE status='sent';
