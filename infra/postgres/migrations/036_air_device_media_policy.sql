BEGIN;

ALTER TABLE ai_phone.air_device_calls
  ADD COLUMN IF NOT EXISTS media_policy text;

UPDATE ai_phone.air_device_calls
SET media_policy = CASE
  WHEN EXISTS (
    SELECT 1 FROM ai_phone.agent_tasks AS task
    WHERE task.call_id = air_device_calls.communication_session_id
  ) THEN 'agent_monitored'
  ELSE 'translation_isolated'
END
WHERE media_policy IS NULL;

ALTER TABLE ai_phone.air_device_calls
  ALTER COLUMN media_policy SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'air_device_calls_media_policy_check'
      AND conrelid = 'ai_phone.air_device_calls'::regclass
  ) THEN
    ALTER TABLE ai_phone.air_device_calls
      ADD CONSTRAINT air_device_calls_media_policy_check
      CHECK (media_policy IN ('translation_isolated', 'agent_monitored'));
  END IF;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('036_air_device_media_policy')
ON CONFLICT (version) DO NOTHING;

COMMIT;
