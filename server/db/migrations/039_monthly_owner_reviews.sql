CREATE TABLE IF NOT EXISTS monthly_owner_review_snapshots (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  report jsonb NOT NULL,
  report_digest text NOT NULL CHECK (report_digest ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (period_to > period_from),
  CHECK (period_to - period_from <= interval '31 days')
);

CREATE INDEX IF NOT EXISTS monthly_owner_review_tenant_idx
  ON monthly_owner_review_snapshots (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS owner_review_conversations_period_idx
  ON conversations (tenant_id, updated_at DESC)
  WHERE intent IN ('complaint','medical_safety');

CREATE INDEX IF NOT EXISTS owner_review_feedback_period_idx
  ON review_requests (tenant_id, created_at DESC)
  WHERE feedback_status = 'negative';

COMMENT ON TABLE monthly_owner_review_snapshots IS
  'Immutable, owner-generated governance snapshots. Reports contain aggregates and identifiers for proposed experiments, but no client identities or message content.';
