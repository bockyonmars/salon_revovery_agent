CREATE UNIQUE INDEX IF NOT EXISTS integration_active_external_route_unique
  ON integration_accounts (provider, external_id)
  WHERE status = 'active';
