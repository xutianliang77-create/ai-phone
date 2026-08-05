BEGIN;

ALTER TABLE ai_phone.air_device_calls
  ADD COLUMN IF NOT EXISTS carrier_event_sequence bigint NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS livekit_event_sequence bigint NOT NULL DEFAULT -1;

ALTER TABLE ai_phone.air_device_calls
  DROP CONSTRAINT IF EXISTS air_device_calls_carrier_event_sequence_check,
  ADD CONSTRAINT air_device_calls_carrier_event_sequence_check
    CHECK (carrier_event_sequence BETWEEN -1 AND 4294967295),
  DROP CONSTRAINT IF EXISTS air_device_calls_livekit_event_sequence_check,
  ADD CONSTRAINT air_device_calls_livekit_event_sequence_check
    CHECK (livekit_event_sequence BETWEEN -1 AND 9007199254740991);

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('033_air_device_call_event_sequences')
ON CONFLICT (version) DO NOTHING;

COMMIT;
