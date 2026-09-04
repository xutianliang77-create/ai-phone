BEGIN;

ALTER TABLE ai_phone.air_devices
  ADD COLUMN IF NOT EXISTS boot_id text,
  ADD COLUMN IF NOT EXISTS heartbeat_sequence bigint,
  ADD COLUMN IF NOT EXISTS device_uptime_ms numeric(20, 0),
  ADD COLUMN IF NOT EXISTS heartbeat_observed_at timestamptz;

ALTER TABLE ai_phone.air_devices
  DROP CONSTRAINT IF EXISTS air_devices_heartbeat_identity_check,
  ADD CONSTRAINT air_devices_heartbeat_identity_check CHECK (
    (boot_id IS NULL AND heartbeat_sequence IS NULL AND
      device_uptime_ms IS NULL AND heartbeat_observed_at IS NULL)
    OR
    (length(boot_id) BETWEEN 1 AND 128 AND
      heartbeat_sequence BETWEEN 0 AND 4294967295 AND
      device_uptime_ms BETWEEN 0 AND 18446744073709551615 AND
      heartbeat_observed_at IS NOT NULL)
  );

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('034_air_device_heartbeats')
ON CONFLICT (version) DO NOTHING;

COMMIT;
