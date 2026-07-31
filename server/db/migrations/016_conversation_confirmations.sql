CREATE TABLE IF NOT EXISTS conversation_actions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type='book_appointment'),
  hold_id uuid NOT NULL REFERENCES appointment_holds(id),
  agent_run_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared','awaiting_confirmation','completed','cancelled','expired')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_actions_one_active_idx
  ON conversation_actions (tenant_id,location_id,conversation_id)
  WHERE status IN ('prepared','awaiting_confirmation');
CREATE INDEX IF NOT EXISTS conversation_actions_scope_idx
  ON conversation_actions (tenant_id,location_id,conversation_id,created_at DESC);
