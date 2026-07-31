ALTER TABLE prompt_versions
  ADD COLUMN IF NOT EXISTS release_label text,
  ADD COLUMN IF NOT EXISTS content_digest text,
  ADD COLUMN IF NOT EXISTS approval_reference text;

ALTER TABLE agent_evaluation_runs
  ADD COLUMN IF NOT EXISTS prompt_digest text;

ALTER TABLE prompt_versions
  DROP CONSTRAINT IF EXISTS prompt_versions_content_digest_format;
ALTER TABLE prompt_versions
  ADD CONSTRAINT prompt_versions_content_digest_format
  CHECK (content_digest IS NULL OR content_digest ~ '^[a-f0-9]{64}$');

ALTER TABLE agent_evaluation_runs
  DROP CONSTRAINT IF EXISTS agent_evaluation_runs_prompt_digest_format;
ALTER TABLE agent_evaluation_runs
  ADD CONSTRAINT agent_evaluation_runs_prompt_digest_format
  CHECK (prompt_digest IS NULL OR prompt_digest ~ '^[a-f0-9]{64}$');

COMMENT ON COLUMN prompt_versions.content_digest IS
  'SHA-256 digest of the code-managed prompt name, release label, model, instructions, and output schema version.';
COMMENT ON COLUMN agent_evaluation_runs.prompt_digest IS
  'Exact code-managed prompt digest evaluated by this run. Legacy NULL evidence is never activation-eligible.';
