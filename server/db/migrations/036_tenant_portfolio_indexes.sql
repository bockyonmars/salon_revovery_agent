CREATE INDEX IF NOT EXISTS revenue_attribution_tenant_period_idx
  ON revenue_attribution (tenant_id, verified_at DESC, location_id);

CREATE INDEX IF NOT EXISTS recovery_cases_tenant_period_idx
  ON recovery_cases (tenant_id, opened_at DESC, location_id);

CREATE INDEX IF NOT EXISTS outbound_message_tenant_period_idx
  ON outbound_message_deliveries (tenant_id, created_at DESC, location_id);

CREATE INDEX IF NOT EXISTS workflow_jobs_tenant_backlog_idx
  ON workflow_jobs (tenant_id, location_id, status, updated_at DESC)
  WHERE status IN ('pending','running','failed','paused');

CREATE INDEX IF NOT EXISTS approval_requests_tenant_pending_idx
  ON approval_requests (tenant_id, location_id, created_at DESC)
  WHERE status = 'pending';

COMMENT ON INDEX revenue_attribution_tenant_period_idx IS
  'Supports owner-only, cross-location portfolio reporting inside one authenticated tenant.';
