CREATE TABLE IF NOT EXISTS channel_routes (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  provider text NOT NULL CHECK (provider = 'twilio'),
  address text NOT NULL CHECK (address ~ '^(whatsapp:)?\+[1-9][0-9]{7,14}$'),
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (provider,address), UNIQUE (tenant_id,location_id,provider)
);
CREATE INDEX IF NOT EXISTS channel_routes_scope_idx ON channel_routes (tenant_id,location_id,provider,status);
CREATE INDEX IF NOT EXISTS integration_external_route_idx ON integration_accounts (provider,external_id,status);
