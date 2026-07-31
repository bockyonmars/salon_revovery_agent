CREATE TABLE IF NOT EXISTS location_settings (
  tenant_id text NOT NULL, location_id text NOT NULL, record jsonb NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id)
);
CREATE TABLE IF NOT EXISTS client_profiles (
  tenant_id text NOT NULL, location_id text NOT NULL, client_id text NOT NULL, contact_to text NOT NULL,
  timezone text NOT NULL, provider_customer_id text, record jsonb NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id,client_id)
);
CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL, request_type text NOT NULL,
  reason text NOT NULL, status text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL, decided_at timestamptz,
  decided_by text, decision_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS approval_pending_entity_idx ON approval_requests (tenant_id,location_id,request_type,entity_type,entity_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS approval_scope_idx ON approval_requests (tenant_id,location_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS weekly_report_snapshots (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  period_from timestamptz NOT NULL, period_to timestamptz NOT NULL, report jsonb NOT NULL,
  status text NOT NULL, recipient_email text, created_at timestamptz NOT NULL, delivered_at timestamptz,
  UNIQUE (tenant_id,location_id,period_from,period_to)
);
