CREATE TABLE IF NOT EXISTS conversation_followup_attempts (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_job_id uuid NOT NULL REFERENCES workflow_jobs(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  trigger_message_id uuid NOT NULL REFERENCES conversation_messages(id),
  status text NOT NULL CHECK (status IN ('reserved','sent','closed')),
  provider_message_id text,
  close_reason text,
  record jsonb NOT NULL,
  reserved_at timestamptz NOT NULL,
  sent_at timestamptz,
  closed_at timestamptz,
  UNIQUE (workflow_job_id)
);

CREATE INDEX IF NOT EXISTS conversation_followup_scope_idx
  ON conversation_followup_attempts (tenant_id,location_id,conversation_id,reserved_at DESC);

CREATE INDEX IF NOT EXISTS conversation_followup_sent_idx
  ON conversation_followup_attempts (tenant_id,location_id,conversation_id,sent_at DESC)
  WHERE status='sent';
