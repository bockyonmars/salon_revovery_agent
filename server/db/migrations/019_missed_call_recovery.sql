CREATE TABLE IF NOT EXISTS missed_call_recovery_attempts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_job_id uuid NOT NULL REFERENCES workflow_jobs(id),
  provider_call_sid text NOT NULL,
  caller_address text NOT NULL,
  client_id text,
  status text NOT NULL CHECK (status IN ('reserved','sent','closed')),
  provider_message_id text,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  conversation_message_id uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  close_reason text,
  record jsonb NOT NULL,
  reserved_at timestamptz NOT NULL,
  sent_at timestamptz,
  closed_at timestamptz,
  UNIQUE (workflow_job_id),
  UNIQUE (tenant_id,location_id,provider_call_sid)
);

CREATE INDEX IF NOT EXISTS missed_call_recovery_caller_idx
  ON missed_call_recovery_attempts (tenant_id,location_id,caller_address,sent_at DESC);
