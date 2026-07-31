CREATE TABLE IF NOT EXISTS outbound_message_deliveries (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp')),
  purpose text NOT NULL CHECK (purpose IN ('transactional','marketing')),
  destination text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved','accepted','queued','sending','sent','delivered','failed','undelivered')),
  provider_message_id text,
  provider_status text,
  error_code text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,location_id,idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS outbound_message_provider_idx
  ON outbound_message_deliveries (tenant_id,location_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbound_message_status_idx
  ON outbound_message_deliveries (tenant_id,location_id,status,updated_at DESC);
