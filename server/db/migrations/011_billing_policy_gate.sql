ALTER TABLE workflow_jobs DROP CONSTRAINT IF EXISTS workflow_jobs_status_check;
ALTER TABLE workflow_jobs ADD CONSTRAINT workflow_jobs_status_check CHECK (status IN ('pending','running','completed','failed','paused'));
CREATE INDEX IF NOT EXISTS workflow_jobs_paused_scope_idx ON workflow_jobs (tenant_id,location_id,updated_at) WHERE status='paused';
