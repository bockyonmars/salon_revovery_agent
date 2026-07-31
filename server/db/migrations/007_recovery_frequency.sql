ALTER TABLE recovery_cases ADD COLUMN IF NOT EXISTS close_reason text;

CREATE TABLE IF NOT EXISTS recovery_contact_attempts (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  workflow_job_id uuid NOT NULL UNIQUE, client_id text NOT NULL, workflow_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','sent')),
  reserved_at timestamptz NOT NULL, sent_at timestamptz, provider_message_id text
);
CREATE INDEX IF NOT EXISTS recovery_contact_frequency_idx ON recovery_contact_attempts (tenant_id,location_id,client_id,sent_at DESC) WHERE status='sent';
