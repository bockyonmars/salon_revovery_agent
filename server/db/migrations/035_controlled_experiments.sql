CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  workflow_type text NOT NULL CHECK (workflow_type IN ('no_show_recovery','post_visit_rebook','lapsed_reactivation')),
  status text NOT NULL CHECK (status IN ('draft','active','paused','completed')),
  version integer NOT NULL CHECK (version = 1),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS experiments_one_active_workflow_idx
  ON experiments (tenant_id, location_id, workflow_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS experiments_location_created_idx
  ON experiments (tenant_id, location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS experiment_exposures (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE RESTRICT,
  variant_key text NOT NULL,
  workflow_job_id uuid NOT NULL,
  recovery_contact_attempt_id uuid NOT NULL REFERENCES recovery_contact_attempts(id) ON DELETE RESTRICT,
  client_id text NOT NULL,
  provider_message_id text NOT NULL,
  record jsonb NOT NULL,
  exposed_at timestamptz NOT NULL,
  UNIQUE (tenant_id, location_id, workflow_job_id)
);

CREATE INDEX IF NOT EXISTS experiment_exposures_results_idx
  ON experiment_exposures (tenant_id, location_id, experiment_id, variant_key, exposed_at);

COMMENT ON TABLE experiments IS
  'Manager-controlled recovery copy tests. Variants cannot change consent, channel, timing, frequency, pricing, offers, or booking behavior.';

COMMENT ON TABLE experiment_exposures IS
  'Immutable accepted-message exposures joined to verified booking attribution by workflow_job_id.';
