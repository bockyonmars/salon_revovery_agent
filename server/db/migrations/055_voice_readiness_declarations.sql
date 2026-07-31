CREATE TABLE IF NOT EXISTS voice_readiness_declarations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'voice-readiness-v1'),
  status text NOT NULL CHECK (status = 'attested'),
  messaging_reliability_evaluation_id uuid NOT NULL REFERENCES messaging_reliability_evaluations(id),
  jurisdiction_code text NOT NULL,
  recording_mode text NOT NULL CHECK (recording_mode = 'disabled'),
  transfer_mode text NOT NULL CHECK (transfer_mode IN ('human','voicemail')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS voice_readiness_location_idx
  ON voice_readiness_declarations (tenant_id, location_id, created_at DESC);

COMMENT ON TABLE voice_readiness_declarations IS
  'Owner compliance attestations required before voice runtime engineering; declarations do not enable or originate calls.';
