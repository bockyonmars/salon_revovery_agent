CREATE TABLE IF NOT EXISTS tool_calls (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  input_message_id uuid NOT NULL REFERENCES conversation_messages(id),
  agent_run_id uuid NOT NULL,
  provider_call_id text NOT NULL,
  tool_name text NOT NULL CHECK (tool_name IN ('get_salon_information','list_services','get_service_details','list_staff','search_availability','create_temporary_hold')),
  status text NOT NULL CHECK (status IN ('completed','failed')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  UNIQUE (tenant_id,location_id,agent_run_id,provider_call_id)
);
CREATE INDEX IF NOT EXISTS tool_calls_scope_idx
  ON tool_calls (tenant_id,location_id,conversation_id,created_at);
