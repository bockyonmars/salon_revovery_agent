CREATE TABLE IF NOT EXISTS voice_release_evidence (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'voice-realtime-sandbox-v1'),
  status text NOT NULL CHECK (status = 'attested'),
  model text NOT NULL,
  reference_hash text NOT NULL CHECK (reference_hash ~ '^[a-f0-9]{64}$'),
  report_digest text NOT NULL CHECK (report_digest ~ '^[a-f0-9]{64}$'),
  sandbox_completed_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, location_id),
  UNIQUE (tenant_id, location_id, report_digest)
);

CREATE INDEX IF NOT EXISTS voice_release_evidence_location_idx
  ON voice_release_evidence (tenant_id, location_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS voice_readiness_declaration_scope_id_idx
  ON voice_readiness_declarations (id, tenant_id, location_id);

CREATE UNIQUE INDEX IF NOT EXISTS messaging_reliability_evaluation_scope_id_idx
  ON messaging_reliability_evaluations (id, tenant_id, location_id);

CREATE TABLE IF NOT EXISTS realtime_voice_activations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'voice-runtime-activation-v1'),
  status text NOT NULL CHECK (status = 'active'),
  voice_release_evidence_id uuid NOT NULL,
  voice_readiness_declaration_id uuid NOT NULL,
  messaging_reliability_evaluation_id uuid NOT NULL,
  model text NOT NULL,
  record jsonb NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (voice_release_evidence_id, tenant_id, location_id)
    REFERENCES voice_release_evidence (id, tenant_id, location_id),
  FOREIGN KEY (voice_readiness_declaration_id, tenant_id, location_id)
    REFERENCES voice_readiness_declarations (id, tenant_id, location_id),
  FOREIGN KEY (messaging_reliability_evaluation_id, tenant_id, location_id)
    REFERENCES messaging_reliability_evaluations (id, tenant_id, location_id)
);

CREATE INDEX IF NOT EXISTS realtime_voice_activation_location_idx
  ON realtime_voice_activations (tenant_id, location_id, activated_at DESC);

COMMENT ON TABLE voice_release_evidence IS
  'Owner-attested redacted digest of controlled Realtime SIP machine evidence and human observations.';
COMMENT ON TABLE realtime_voice_activations IS
  'Explicit owner activation binding a Realtime model to current sandbox, compliance, and SMS reliability evidence.';
