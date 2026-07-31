CREATE TABLE IF NOT EXISTS prompt_versions (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL,
  model text NOT NULL,
  instructions text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (name,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_active_idx
  ON prompt_versions (name) WHERE active=true;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  client_id text NOT NULL,
  participant_address text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  status text NOT NULL CHECK (status IN ('active','escalated','closed')),
  intent text NOT NULL,
  requires_human boolean NOT NULL DEFAULT false,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id,location_id,channel,participant_address)
);
CREATE INDEX IF NOT EXISTS conversations_scope_idx
  ON conversations (tenant_id,location_id,last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  author text NOT NULL CHECK (author IN ('client','agent','operator','system')),
  body text NOT NULL,
  provider_message_id text,
  delivery_status text NOT NULL CHECK (delivery_status IN ('received','draft','queued','sent','delivered','failed')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_provider_message_idx
  ON conversation_messages (tenant_id,location_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_thread_idx
  ON conversation_messages (tenant_id,location_id,conversation_id,created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  input_message_id uuid NOT NULL REFERENCES conversation_messages(id),
  response_message_id uuid REFERENCES conversation_messages(id),
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(id),
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','skipped','failed')),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_scope_idx
  ON agent_runs (tenant_id,location_id,conversation_id,created_at DESC);
