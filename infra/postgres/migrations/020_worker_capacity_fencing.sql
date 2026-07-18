BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.worker_capacity_pool_locks (
  resource text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_phone.worker_capacity_pool_locks(resource)
VALUES ('translation_runtime'), ('voice_agent_runtime')
ON CONFLICT (resource) DO NOTHING;

ALTER TABLE ai_phone.worker_capacity_reservations
  DROP CONSTRAINT IF EXISTS worker_capacity_reservations_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS worker_capacity_reservations_session_resource_idx
  ON ai_phone.worker_capacity_reservations(session_id, resource);

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('020_worker_capacity_fencing')
ON CONFLICT (version) DO NOTHING;

COMMIT;
