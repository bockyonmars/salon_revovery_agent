ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS chain_version integer,
  ADD COLUMN IF NOT EXISTS chain_sequence bigint,
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS record_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_sequence_idx
  ON audit_log (tenant_id,location_id,chain_sequence)
  WHERE chain_sequence IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  chain_version integer NOT NULL,
  chain_sequence bigint NOT NULL,
  record_hash text NOT NULL,
  legacy_anchor text,
  legacy_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,location_id)
);

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
