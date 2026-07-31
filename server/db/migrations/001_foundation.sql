CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  timezone text NOT NULL,
  source text NOT NULL DEFAULT 'internal',
  external_id text,
  source_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES tenants(id),
  location_id text NOT NULL REFERENCES locations(id),
  provider text NOT NULL,
  encrypted_credentials bytea NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL,
  external_id text NOT NULL,
  source_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id)
);

CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'voice')),
  purpose text NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  status text NOT NULL CHECK (status IN ('unknown', 'opted_in', 'opted_out')),
  record jsonb NOT NULL,
  captured_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_id, channel, purpose)
);

CREATE TABLE IF NOT EXISTS domain_events (
  event_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  schema_version integer NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  event_id uuid PRIMARY KEY REFERENCES domain_events(event_id),
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  record jsonb NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  user_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text NOT NULL,
  record jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_holds (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  hold_id uuid NOT NULL REFERENCES appointment_holds(id),
  booking_reference text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id text NOT NULL,
  idempotency_key text NOT NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS consents_scope_idx ON consents (tenant_id, location_id, client_id);
CREATE INDEX IF NOT EXISTS events_scope_time_idx ON domain_events (tenant_id, location_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_scope_time_idx ON audit_log (tenant_id, location_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS holds_scope_idx ON appointment_holds (tenant_id, location_id, client_id, status);

COMMENT ON TABLE outbox_events IS 'Inserted in the same transaction as domain_events. A separate publisher marks published_at.';
COMMENT ON COLUMN integration_accounts.encrypted_credentials IS 'Application-encrypted provider credentials. Production encryption key must come from AWS KMS.';
