ALTER TABLE conversation_followup_attempts
  ADD COLUMN IF NOT EXISTS channel text;

UPDATE conversation_followup_attempts AS followup
SET channel = CASE
  WHEN conversation.record->>'channel' = 'whatsapp' THEN 'whatsapp'
  ELSE 'sms'
END
FROM conversations AS conversation
WHERE conversation.id = followup.conversation_id
  AND conversation.tenant_id = followup.tenant_id
  AND conversation.location_id = followup.location_id
  AND followup.channel IS NULL;

UPDATE conversation_followup_attempts
SET channel = 'sms'
WHERE channel IS NULL;

UPDATE conversation_followup_attempts
SET record = jsonb_set(record, '{channel}', to_jsonb(channel), true);

ALTER TABLE conversation_followup_attempts
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE conversation_followup_attempts
  DROP CONSTRAINT IF EXISTS conversation_followup_attempts_channel_check;

ALTER TABLE conversation_followup_attempts
  ADD CONSTRAINT conversation_followup_attempts_channel_check
  CHECK (channel IN ('sms', 'whatsapp'));

COMMENT ON COLUMN conversation_followup_attempts.channel IS
  'Immutable SMS or WhatsApp channel inherited from the authoritative conversation at follow-up reservation time.';
