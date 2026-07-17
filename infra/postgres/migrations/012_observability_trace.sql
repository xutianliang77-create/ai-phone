BEGIN;

ALTER TABLE ai_phone.provider_operations
  ADD COLUMN IF NOT EXISTS trace_id text;

CREATE INDEX IF NOT EXISTS provider_operations_trace_idx
  ON ai_phone.provider_operations(trace_id)
  WHERE trace_id IS NOT NULL;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('012_observability_trace')
ON CONFLICT (version) DO NOTHING;

COMMIT;
