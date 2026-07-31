CREATE TABLE IF NOT EXISTS support_knowledge_articles (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  location_id text NOT NULL REFERENCES locations(id),
  slug text NOT NULL,
  current_version integer NOT NULL CHECK (current_version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, location_id, slug)
);

CREATE TABLE IF NOT EXISTS support_knowledge_article_versions (
  article_id uuid NOT NULL REFERENCES support_knowledge_articles(id),
  tenant_id text NOT NULL,
  location_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  updated_by text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (article_id, version)
);

CREATE INDEX IF NOT EXISTS support_knowledge_published_scope_idx
  ON support_knowledge_articles (tenant_id, location_id, updated_at DESC)
  WHERE status = 'published';

COMMENT ON TABLE support_knowledge_article_versions IS
  'Immutable manager-approved support content history. Only the current published version is available to agent tools.';
