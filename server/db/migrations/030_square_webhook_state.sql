CREATE TABLE IF NOT EXISTS square_booking_webhook_state (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider_booking_id text NOT NULL,
  provider_event_id uuid NOT NULL,
  provider_occurred_at timestamptz NOT NULL,
  provider_status text NOT NULL,
  normalized_event_type text NOT NULL CHECK (normalized_event_type IN ('appointment.booked','appointment.cancelled','appointment.no_show')),
  record jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id,provider_booking_id)
);

CREATE INDEX IF NOT EXISTS square_booking_webhook_state_event_idx
  ON square_booking_webhook_state (provider_event_id);

COMMENT ON TABLE square_booking_webhook_state IS 'Latest accepted normalized Square booking transition per tenant/location/booking. Stale and terminal-state regressions remain in raw provider events but cannot emit business workflows.';
