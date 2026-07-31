ALTER TABLE voice_readiness_declarations
  ADD COLUMN IF NOT EXISTS transfer_to text;

ALTER TABLE voice_readiness_declarations
  DROP CONSTRAINT IF EXISTS voice_readiness_human_transfer_target_check;

ALTER TABLE voice_readiness_declarations
  ADD CONSTRAINT voice_readiness_human_transfer_target_check
  CHECK (transfer_mode = 'human' AND transfer_to ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;

COMMENT ON COLUMN voice_readiness_declarations.transfer_to IS
  'Tenant-specific human handoff destination. Older target-less declarations remain retained as evidence but fail closed in the runtime.';
