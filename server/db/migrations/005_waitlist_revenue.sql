CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL, client_id text NOT NULL,
  contact_to text NOT NULL, service_id text NOT NULL, staff_ids text[] NOT NULL DEFAULT '{}',
  window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, timezone text NOT NULL,
  status text NOT NULL, offer_count integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL,
  last_offered_at timestamptz, record jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS waitlist_eligible_idx ON waitlist_entries (tenant_id,location_id,service_id,status,window_start,window_end);

CREATE TABLE IF NOT EXISTS waitlist_offers (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  entry_id uuid NOT NULL REFERENCES waitlist_entries(id), correlation_id text NOT NULL,
  workflow_job_id uuid NOT NULL, service_id text NOT NULL, staff_id text NOT NULL,
  starts_at timestamptz NOT NULL, price_minor integer NOT NULL, currency text NOT NULL,
  expires_at timestamptz NOT NULL, status text NOT NULL, record jsonb NOT NULL,
  created_at timestamptz NOT NULL, responded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_offer_idx ON waitlist_offers (tenant_id,location_id,correlation_id) WHERE status='offered';
CREATE INDEX IF NOT EXISTS waitlist_offer_entry_idx ON waitlist_offers (entry_id,correlation_id);

CREATE TABLE IF NOT EXISTS revenue_attribution (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, location_id text NOT NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id), waitlist_offer_id uuid NOT NULL REFERENCES waitlist_offers(id),
  workflow_job_id uuid NOT NULL, amount_minor integer NOT NULL, currency text NOT NULL,
  attribution_type text NOT NULL, verified_at timestamptz NOT NULL,
  UNIQUE (booking_id, attribution_type)
);
CREATE INDEX IF NOT EXISTS revenue_attribution_scope_idx ON revenue_attribution (tenant_id,location_id,verified_at DESC);
