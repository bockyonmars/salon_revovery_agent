CREATE TABLE IF NOT EXISTS messaging_reliability_evaluations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'voice-prerequisite-v1'),
  channel text NOT NULL CHECK (channel = 'sms'),
  status text NOT NULL CHECK (status IN ('passed','failed')),
  voice_build_allowed boolean NOT NULL,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS messaging_reliability_location_idx
  ON messaging_reliability_evaluations (tenant_id, location_id, created_at DESC);

COMMENT ON TABLE messaging_reliability_evaluations IS
  'Immutable evidence for deciding whether voice engineering may begin. A passing record does not enable voice or authorize voice contact.';
