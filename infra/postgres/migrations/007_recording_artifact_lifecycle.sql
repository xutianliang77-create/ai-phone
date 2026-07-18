BEGIN;

ALTER TABLE ai_phone.recording_artifacts
  ADD COLUMN IF NOT EXISTS etag text,
  ADD COLUMN IF NOT EXISTS storage_version_id text,
  ADD COLUMN IF NOT EXISTS manifest_object_key text,
  ADD COLUMN IF NOT EXISTS manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_verification_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_deletion_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_class text;

CREATE INDEX IF NOT EXISTS recording_artifacts_verification_queue_idx
  ON ai_phone.recording_artifacts(next_verification_at, updated_at)
  WHERE status IN ('available', 'verification_failed');

CREATE INDEX IF NOT EXISTS recording_artifacts_deletion_queue_idx
  ON ai_phone.recording_artifacts(next_deletion_at, updated_at)
  WHERE status IN ('deleting', 'deletion_failed');

CREATE OR REPLACE FUNCTION ai_phone.apply_recording_artifact_projection_event(
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
  IF event_namespace <> 'recordingArtifacts' THEN
    RAISE EXCEPTION 'Unsupported recording artifact namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported recording artifact operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Recording artifact payload is required for upsert';
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
    DELETE FROM ai_phone.recording_artifacts WHERE id = record_key;
    RETURN true;
  END IF;

  INSERT INTO ai_phone.recording_artifacts(
    id, recording_job_id, session_id, object_key, content_type, status,
    size_bytes, duration_ms, sha256, etag, storage_version_id,
    manifest_object_key, manifest_sha256, verification_attempts,
    next_verification_at, deletion_attempts, next_deletion_at,
    last_error_class, available_at, verified_at, deleted_at, created_at, updated_at
  ) VALUES (
    event_payload->>'id', event_payload->>'recordingJobId',
    event_payload->>'sessionId', event_payload->>'objectKey',
    event_payload->>'contentType', event_payload->>'status',
    NULLIF(event_payload->>'sizeBytes', '')::bigint,
    NULLIF(event_payload->>'durationMs', '')::bigint,
    event_payload->>'sha256', event_payload->>'etag',
    event_payload->>'storageVersionId', event_payload->>'manifestObjectKey',
    event_payload->>'manifestSha256',
    COALESCE((event_payload->>'verificationAttempts')::integer, 0),
    NULLIF(event_payload->>'nextVerificationAt', '')::timestamptz,
    COALESCE((event_payload->>'deletionAttempts')::integer, 0),
    NULLIF(event_payload->>'nextDeletionAt', '')::timestamptz,
    event_payload->>'lastErrorClass',
    NULLIF(event_payload->>'availableAt', '')::timestamptz,
    NULLIF(event_payload->>'verifiedAt', '')::timestamptz,
    NULLIF(event_payload->>'deletedAt', '')::timestamptz,
    (event_payload->>'createdAt')::timestamptz,
    (event_payload->>'updatedAt')::timestamptz
  ) ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status, size_bytes = EXCLUDED.size_bytes,
    duration_ms = EXCLUDED.duration_ms, sha256 = EXCLUDED.sha256,
    etag = EXCLUDED.etag, storage_version_id = EXCLUDED.storage_version_id,
    manifest_object_key = EXCLUDED.manifest_object_key,
    manifest_sha256 = EXCLUDED.manifest_sha256,
    verification_attempts = EXCLUDED.verification_attempts,
    next_verification_at = EXCLUDED.next_verification_at,
    deletion_attempts = EXCLUDED.deletion_attempts,
    next_deletion_at = EXCLUDED.next_deletion_at,
    last_error_class = EXCLUDED.last_error_class,
    available_at = EXCLUDED.available_at, verified_at = EXCLUDED.verified_at,
    deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('007_recording_artifact_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
