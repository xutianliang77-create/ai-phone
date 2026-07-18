BEGIN;

ALTER TABLE ai_phone.agent_tasks
  ADD COLUMN IF NOT EXISTS version bigint,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE ai_phone.agent_tasks
SET version = COALESCE(version, 1),
    request_hash = COALESCE(
      request_hash,
      md5(id || ':' || updated_at::text) || md5(user_id || ':' || created_at::text)
    ),
    idempotency_key = COALESCE(idempotency_key, 'import:' || id)
WHERE version IS NULL OR request_hash IS NULL OR idempotency_key IS NULL;

ALTER TABLE ai_phone.agent_tasks
  ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tasks_version_check'
      AND conrelid = 'ai_phone.agent_tasks'::regclass
  ) THEN
    ALTER TABLE ai_phone.agent_tasks
      ADD CONSTRAINT agent_tasks_version_check CHECK (version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tasks_request_hash_check'
      AND conrelid = 'ai_phone.agent_tasks'::regclass
  ) THEN
    ALTER TABLE ai_phone.agent_tasks
      ADD CONSTRAINT agent_tasks_request_hash_check
      CHECK (length(request_hash) BETWEEN 16 AND 128);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tasks_idempotency_key_check'
      AND conrelid = 'ai_phone.agent_tasks'::regclass
  ) THEN
    ALTER TABLE ai_phone.agent_tasks
      ADD CONSTRAINT agent_tasks_idempotency_key_check
      CHECK (length(idempotency_key) BETWEEN 1 AND 200);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_user_idempotency_idx
  ON ai_phone.agent_tasks(user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_call_id_idx
  ON ai_phone.agent_tasks(call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_user_updated_idx
  ON ai_phone.agent_tasks(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_tasks_queue_idx
  ON ai_phone.agent_tasks(queued_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS agent_tasks_external_call_idx
  ON ai_phone.agent_tasks(external_call_id) WHERE external_call_id IS NOT NULL;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('026_agent_task_primary')
ON CONFLICT (version) DO NOTHING;

COMMIT;
