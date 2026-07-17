BEGIN;

ALTER TABLE ai_phone.provider_operations
  DROP CONSTRAINT IF EXISTS
    provider_operations_session_id_operation_type_operation_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS provider_operations_session_operation_idx
  ON ai_phone.provider_operations(
    session_id,
    operation_type,
    COALESCE(operation_key, '')
  );

ALTER TABLE ai_phone.recording_jobs
  DROP CONSTRAINT IF EXISTS recording_jobs_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS recording_jobs_idempotency_idx
  ON ai_phone.recording_jobs(session_id, idempotency_key);

DROP INDEX IF EXISTS ai_phone.tool_executions_idempotency_idx;
CREATE UNIQUE INDEX tool_executions_idempotency_idx
  ON ai_phone.tool_executions(run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE ai_phone.external_media_sources
  DROP CONSTRAINT IF EXISTS external_media_sources_idempotency_key_key;
DROP INDEX IF EXISTS ai_phone.external_media_sources_idempotency_idx;
CREATE UNIQUE INDEX external_media_sources_idempotency_idx
  ON ai_phone.external_media_sources(session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('006_idempotency_scope')
ON CONFLICT (version) DO NOTHING;

COMMIT;
