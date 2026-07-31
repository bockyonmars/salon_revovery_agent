CREATE TABLE IF NOT EXISTS public_rate_limit_buckets (
  route_key text NOT NULL CHECK (route_key IN ('recovery_review')),
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  max_requests integer NOT NULL CHECK (max_requests > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (route_key,identity_hash,window_start)
);

CREATE INDEX IF NOT EXISTS public_rate_limit_recent_idx
  ON public_rate_limit_buckets (updated_at DESC);
