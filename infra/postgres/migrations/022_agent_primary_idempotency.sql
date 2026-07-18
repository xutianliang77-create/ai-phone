BEGIN;

ALTER TABLE ai_phone.agent_runs
  ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE ai_phone.agent_steps
  ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE ai_phone.tool_executions
  ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE ai_phone.handoff_records
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text;

ALTER TABLE ai_phone.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_task_id_attempt_key;
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_task_mode_attempt_idx
  ON ai_phone.agent_runs(task_id, mode, attempt);
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_active_mode_idx
  ON ai_phone.agent_runs(task_id, mode)
  WHERE status IN ('ready', 'running', 'takeover_requested');
CREATE UNIQUE INDEX IF NOT EXISTS handoff_records_idempotency_idx
  ON ai_phone.handoff_records(run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS handoff_records_active_idx
  ON ai_phone.handoff_records(run_id, target, requested_at DESC)
  WHERE status = 'requested';

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('022_agent_primary_idempotency')
ON CONFLICT (version) DO NOTHING;

COMMIT;
