CREATE INDEX IF NOT EXISTS client_profiles_contact_lookup_idx
  ON client_profiles (tenant_id, location_id, contact_to);

COMMENT ON INDEX client_profiles_contact_lookup_idx IS
  'Supports tenant/location-scoped inbound SMS and WhatsApp identity resolution. The index is intentionally non-unique because a shared family contact must remain ambiguity-safe rather than being assigned arbitrarily.';
