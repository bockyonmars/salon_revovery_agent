ALTER TABLE recovery_contact_attempts
  ADD COLUMN IF NOT EXISTS channel text;

UPDATE recovery_contact_attempts
SET channel = 'sms'
WHERE channel IS NULL;

ALTER TABLE recovery_contact_attempts
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE recovery_contact_attempts
  DROP CONSTRAINT IF EXISTS recovery_contact_attempts_channel_check;

ALTER TABLE recovery_contact_attempts
  ADD CONSTRAINT recovery_contact_attempts_channel_check
  CHECK (channel IN ('sms', 'whatsapp'));

COMMENT ON COLUMN recovery_contact_attempts.channel IS
  'Immutable outbound channel selected when the recovery contact was reserved; legacy rows are safely classified as SMS.';
