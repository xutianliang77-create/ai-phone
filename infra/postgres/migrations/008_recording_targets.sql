BEGIN;

ALTER TABLE ai_phone.recording_jobs
  ADD COLUMN IF NOT EXISTS participant_identity text,
  ADD COLUMN IF NOT EXISTS track_id text;

ALTER TABLE ai_phone.recording_jobs
  DROP CONSTRAINT IF EXISTS recording_jobs_target_check;

ALTER TABLE ai_phone.recording_jobs
  ADD CONSTRAINT recording_jobs_target_check CHECK (
    (recording_type = 'room_audio' AND participant_identity IS NULL AND track_id IS NULL)
    OR
    (recording_type = 'participant' AND participant_identity IS NOT NULL AND track_id IS NULL)
    OR
    (recording_type = 'track' AND participant_identity IS NOT NULL AND track_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION ai_phone.apply_recording_job_projection_event(
  event_id text,
  event_namespace text,
  record_key text,
  event_operation text,
  event_payload jsonb
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  inserted boolean;
BEGIN
  IF event_namespace <> 'recordingJobs' THEN
    RAISE EXCEPTION 'Unsupported recording job namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported recording job operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Recording job payload is required for upsert';
  END IF;

  INSERT INTO ai_phone.postgres_projection_inbox(
    event_id, namespace, record_key, operation, payload_hash
  ) VALUES (
    event_id, event_namespace, record_key, event_operation,
    md5(COALESCE(event_payload::text, ''))
  ) ON CONFLICT (event_id) DO NOTHING
  RETURNING true INTO inserted;
  IF NOT COALESCE(inserted, false) THEN RETURN false; END IF;

  IF event_operation = 'delete' THEN
    DELETE FROM ai_phone.recording_jobs WHERE id = record_key;
    RETURN true;
  END IF;

  INSERT INTO ai_phone.recording_jobs(
    id, session_id, room_name, recording_type, participant_identity, track_id,
    provider, consent_snapshot_id, retention_until, object_key, content_type,
    status, idempotency_key, request_hash, version, provider_operation_id,
    external_recording_id, last_error_class, created_at, updated_at,
    started_at, ended_at
  ) VALUES (
    event_payload->>'id', event_payload->>'sessionId', event_payload->>'roomName',
    event_payload->>'recordingType', event_payload->>'participantIdentity',
    event_payload->>'trackId', event_payload->>'provider',
    event_payload->>'consentSnapshotId',
    (event_payload->>'retentionUntil')::timestamptz,
    event_payload->>'objectKey', event_payload->>'contentType',
    event_payload->>'status', event_payload->>'idempotencyKey',
    event_payload->>'requestHash', (event_payload->>'version')::bigint,
    event_payload->>'providerOperationId', event_payload->>'externalRecordingId',
    event_payload->>'lastErrorClass', (event_payload->>'createdAt')::timestamptz,
    (event_payload->>'updatedAt')::timestamptz,
    NULLIF(event_payload->>'startedAt', '')::timestamptz,
    NULLIF(event_payload->>'endedAt', '')::timestamptz
  ) ON CONFLICT (id) DO UPDATE SET
    recording_type = EXCLUDED.recording_type,
    participant_identity = EXCLUDED.participant_identity,
    track_id = EXCLUDED.track_id,
    status = EXCLUDED.status, version = EXCLUDED.version,
    provider_operation_id = EXCLUDED.provider_operation_id,
    external_recording_id = EXCLUDED.external_recording_id,
    last_error_class = EXCLUDED.last_error_class,
    updated_at = EXCLUDED.updated_at, started_at = EXCLUDED.started_at,
    ended_at = EXCLUDED.ended_at;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('008_recording_targets')
ON CONFLICT (version) DO NOTHING;

COMMIT;
