ALTER TABLE conversation_actions
  DROP CONSTRAINT IF EXISTS conversation_actions_action_type_check;

ALTER TABLE conversation_actions
  ADD CONSTRAINT conversation_actions_action_type_check
  CHECK (action_type IN ('book_appointment','cancel_appointment','reschedule_appointment'));

ALTER TABLE conversation_actions
  ALTER COLUMN hold_id DROP NOT NULL,
  ALTER COLUMN agent_run_id TYPE text USING agent_run_id::text;

ALTER TABLE conversation_actions
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id);

CREATE INDEX IF NOT EXISTS conversation_actions_booking_idx
  ON conversation_actions (tenant_id,location_id,booking_id,created_at DESC)
  WHERE booking_id IS NOT NULL;
