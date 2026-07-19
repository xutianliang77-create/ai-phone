BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.primary_command_inbox (
  command_id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  command_type text NOT NULL,
  request_hash text NOT NULL,
  result_payload jsonb NOT NULL,
  retain_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(command_id) BETWEEN 1 AND 200),
  CHECK (length(aggregate_type) BETWEEN 2 AND 80),
  CHECK (length(aggregate_id) BETWEEN 1 AND 160),
  CHECK (length(command_type) BETWEEN 2 AND 100),
  CHECK (length(request_hash) BETWEEN 16 AND 128),
  CHECK (retain_until > created_at)
);

CREATE INDEX IF NOT EXISTS primary_command_inbox_retention_idx
  ON ai_phone.primary_command_inbox(retain_until, command_id);

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('017_primary_command_inbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
