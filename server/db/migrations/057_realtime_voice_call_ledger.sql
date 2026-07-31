CREATE TABLE IF NOT EXISTS realtime_voice_calls (
  call_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  provider_event_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('received','processing','accept_failed','accepted','rejected','transferred')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS realtime_voice_provider_event_idx
  ON realtime_voice_calls (provider_event_id);

CREATE INDEX IF NOT EXISTS realtime_voice_location_status_idx
  ON realtime_voice_calls (tenant_id, location_id, status, updated_at DESC);

COMMENT ON TABLE realtime_voice_calls IS
  'Redacted OpenAI Realtime SIP control ledger. Records call-control identifiers and bounded state only; never caller/transfer numbers, audio, or transcripts.';
