CREATE TABLE IF NOT EXISTS billing_accounts (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  provider text NOT NULL, customer_id text NOT NULL, subscription_id text NOT NULL,
  price_id text, status text NOT NULL, trial_ends_at timestamptz,
  current_period_ends_at timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider_event_created bigint NOT NULL, source_event_id text NOT NULL,
  record jsonb NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,location_id,provider), UNIQUE (provider,subscription_id)
);
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id text PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  event_type text NOT NULL, provider_created bigint NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_scope_idx ON billing_accounts (tenant_id,location_id,status);
