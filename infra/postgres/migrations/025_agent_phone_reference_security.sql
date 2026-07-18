BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_tasks_phone_reference_format_check'
      AND conrelid = 'ai_phone.agent_tasks'::regclass
  ) THEN
    ALTER TABLE ai_phone.agent_tasks
      ADD CONSTRAINT agent_tasks_phone_reference_format_check CHECK (
        target_phone_reference IS NULL OR (
          length(target_phone_reference) BETWEEN 40 AND 512 AND
          target_phone_reference ~
            '^aph1\.[A-Za-z0-9_-]{1,40}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'
        )
      );
  END IF;
END;
$$;

COMMENT ON COLUMN ai_phone.agent_tasks.target_phone_reference IS
  'Opaque aph1 AES-256-GCM reference; plaintext phone numbers are forbidden.';

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('025_agent_phone_reference_security')
ON CONFLICT (version) DO NOTHING;

COMMIT;
