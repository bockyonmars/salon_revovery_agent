CREATE TABLE IF NOT EXISTS tenant_rate_limit_buckets (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('read','write')),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  max_requests integer NOT NULL CHECK (max_requests > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id,kind,window_start)
);

CREATE INDEX IF NOT EXISTS tenant_rate_limit_recent_idx
  ON tenant_rate_limit_buckets (tenant_id,location_id,updated_at DESC);
