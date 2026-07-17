BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.domain_capacity_pool_locks (
  scope text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_phone.domain_capacity_pool_locks(scope)
VALUES ('external_media_source')
ON CONFLICT (scope) DO NOTHING;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('021_domain_capacity_locks')
ON CONFLICT (version) DO NOTHING;

COMMIT;
