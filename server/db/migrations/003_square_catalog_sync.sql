CREATE TABLE IF NOT EXISTS synced_services (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  record jsonb NOT NULL,
  synced_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, location_id, provider, external_id)
);

CREATE TABLE IF NOT EXISTS synced_staff (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  record jsonb NOT NULL,
  synced_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, location_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS synced_services_scope_idx ON synced_services (tenant_id, location_id, provider);
CREATE INDEX IF NOT EXISTS synced_staff_scope_idx ON synced_staff (tenant_id, location_id, provider);
