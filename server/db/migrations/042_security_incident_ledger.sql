CREATE TABLE IF NOT EXISTS security_incidents (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('suspected_data_exposure','credential_compromise','audit_integrity_failure','unauthorized_access','provider_security_event','availability_attack','other')),
  severity text NOT NULL CHECK (severity IN ('sev1','sev2','sev3')),
  status text NOT NULL CHECK (status IN ('open','contained','resolved','false_positive')),
  record jsonb NOT NULL,
  opened_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, tenant_id, location_id)
);

CREATE INDEX IF NOT EXISTS security_incidents_scope_status_idx
  ON security_incidents (tenant_id, location_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS security_incident_events (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('opened','contained','resolved','false_positive')),
  record jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (incident_id, tenant_id, location_id)
    REFERENCES security_incidents (id, tenant_id, location_id)
);

CREATE INDEX IF NOT EXISTS security_incident_events_scope_idx
  ON security_incident_events (tenant_id, location_id, incident_id, occurred_at);

CREATE OR REPLACE FUNCTION prevent_security_incident_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security incident events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS security_incident_events_append_only ON security_incident_events;
CREATE TRIGGER security_incident_events_append_only
BEFORE UPDATE OR DELETE ON security_incident_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_incident_event_mutation();

COMMENT ON TABLE security_incident_events IS
  'Append-only, tenant/location-scoped incident lifecycle evidence. Records must not contain customer identifiers, credentials, provider payloads, or message content.';
