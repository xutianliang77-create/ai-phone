BEGIN;

ALTER TABLE ai_phone.provider_operations
  ADD COLUMN IF NOT EXISTS completion_observed_event text;
ALTER TABLE ai_phone.agent_tasks
  ADD COLUMN IF NOT EXISTS risk_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS call_id text,
  ADD COLUMN IF NOT EXISTS external_call_id text,
  ADD COLUMN IF NOT EXISTS execution_provider text,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_seconds integer,
  ADD COLUMN IF NOT EXISTS result_summary text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS next_step text;

CREATE OR REPLACE FUNCTION ai_phone.apply_projection_event(
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
  IF event_namespace NOT IN (
    'sessions', 'providerOperations', 'workerDispatches',
    'workerCapacityReservations', 'participantRecordingConsents',
    'recordingConsentSnapshots', 'recordingJobs', 'recordingArtifacts',
    'agentCallDrafts'
  ) THEN
    RAISE EXCEPTION 'Unsupported projection namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported projection operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Projection payload is required for upsert';
  END IF;

  INSERT INTO ai_phone.postgres_projection_inbox(
    event_id, namespace, record_key, operation, payload_hash
  ) VALUES (
    event_id, event_namespace, record_key, event_operation,
    md5(COALESCE(event_payload::text, ''))
  ) ON CONFLICT (event_id) DO NOTHING
  RETURNING true INTO inserted;
  IF NOT COALESCE(inserted, false) THEN
    RETURN false;
  END IF;

  IF event_operation = 'delete' THEN
    CASE event_namespace
      WHEN 'sessions' THEN DELETE FROM ai_phone.communication_sessions WHERE id = record_key;
      WHEN 'providerOperations' THEN DELETE FROM ai_phone.provider_operations WHERE id = record_key;
      WHEN 'workerDispatches' THEN DELETE FROM ai_phone.worker_dispatches WHERE id = record_key;
      WHEN 'workerCapacityReservations' THEN DELETE FROM ai_phone.worker_capacity_reservations WHERE id = record_key;
      WHEN 'participantRecordingConsents' THEN DELETE FROM ai_phone.participant_recording_consents WHERE id = record_key;
      WHEN 'recordingConsentSnapshots' THEN DELETE FROM ai_phone.recording_consent_snapshots WHERE id = record_key;
      WHEN 'recordingJobs' THEN DELETE FROM ai_phone.recording_jobs WHERE id = record_key;
      WHEN 'recordingArtifacts' THEN DELETE FROM ai_phone.recording_artifacts WHERE id = record_key;
      WHEN 'agentCallDrafts' THEN DELETE FROM ai_phone.agent_tasks WHERE id = record_key;
    END CASE;
    RETURN true;
  END IF;

  CASE event_namespace
    WHEN 'sessions' THEN
      INSERT INTO ai_phone.communication_sessions(
        id, user_id, mode, status, consumed_seconds, version, room_name,
        room_provider, created_at, last_activity_at, ended_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'userId', event_payload->>'mode',
        event_payload->>'status', COALESCE((event_payload->>'consumedSeconds')::integer, 0),
        COALESCE((event_payload->>'version')::bigint, 1),
        event_payload#>>'{callLink,roomName}', event_payload#>>'{callLink,roomProvider}',
        (event_payload->>'createdAt')::timestamptz,
        NULLIF(event_payload->>'lastActivityAt', '')::timestamptz,
        NULLIF(event_payload->>'endedAt', '')::timestamptz,
        COALESCE(
          NULLIF(event_payload->>'lastActivityAt', '')::timestamptz,
          NULLIF(event_payload->>'endedAt', '')::timestamptz,
          (event_payload->>'createdAt')::timestamptz
        )
      ) ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id, mode = EXCLUDED.mode, status = EXCLUDED.status,
        consumed_seconds = EXCLUDED.consumed_seconds, version = EXCLUDED.version,
        room_name = EXCLUDED.room_name, room_provider = EXCLUDED.room_provider,
        last_activity_at = EXCLUDED.last_activity_at, ended_at = EXCLUDED.ended_at,
        updated_at = EXCLUDED.updated_at;

      DELETE FROM ai_phone.session_media_legs WHERE session_id = record_key;
      INSERT INTO ai_phone.session_media_legs(
        id, session_id, participant_identity, participant_role, join_type,
        status, joined_at, ended_at, updated_at
      ) SELECT
        leg->>'id', record_key, leg->>'participantIdentity',
        leg->>'participantRole', leg->>'joinType', leg->>'status',
        (leg->>'joinedAt')::timestamptz,
        NULLIF(leg->>'endedAt', '')::timestamptz,
        COALESCE(NULLIF(leg->>'endedAt', '')::timestamptz, (leg->>'joinedAt')::timestamptz)
      FROM jsonb_array_elements(COALESCE(event_payload->'callLegs', '[]'::jsonb)) AS leg;

      DELETE FROM ai_phone.transcript_segments WHERE session_id = record_key;
      INSERT INTO ai_phone.transcript_segments(
        session_id, segment_id, turn_id, revision, source_text, raw_text,
        optimized_text, translated_text, source_language, target_language,
        dominant_language, confidence, stage, provider, model, latency_ms,
        speaker_id, speaker_role, start_ms, end_ms, overlap, created_at, updated_at
      ) SELECT
        record_key, segment->>'id', segment->>'turnId',
        COALESCE((segment->>'revision')::integer, 1), segment->>'sourceText',
        segment->>'rawText', segment->>'optimizedText', segment->>'translatedText',
        segment->>'sourceLanguage', segment->>'targetLanguage',
        segment->>'dominantLanguage', NULLIF(segment->>'confidence', '')::double precision,
        segment->>'stage', segment->>'provider', segment->>'model',
        NULLIF(segment->>'latencyMs', '')::integer, segment#>>'{speaker,speakerId}',
        segment#>>'{speaker,role}', NULLIF(segment#>>'{timing,startMs}', '')::bigint,
        NULLIF(segment#>>'{timing,endMs}', '')::bigint,
        NULLIF(segment#>>'{timing,overlap}', '')::boolean,
        (event_payload->>'createdAt')::timestamptz,
        COALESCE(NULLIF(event_payload->>'lastActivityAt', '')::timestamptz, now())
      FROM jsonb_array_elements(COALESCE(event_payload->'segments', '[]'::jsonb)) AS segment;

      DELETE FROM ai_phone.tts_playbacks WHERE session_id = record_key;
      INSERT INTO ai_phone.tts_playbacks(
        id, session_id, segment_id, source_leg_id, target_leg_id, generation,
        status, provider, model, audio_duration_ms, interrupt_reason,
        queued_at, started_at, ended_at, updated_at
      ) SELECT
        playback->>'id', record_key, playback->>'segmentId',
        playback->>'sourceLegId', playback->>'targetLegId',
        (playback->>'generation')::integer, playback->>'status',
        playback->>'provider', playback->>'model',
        NULLIF(playback->>'audioDurationMs', '')::integer,
        playback->>'interruptReason', (playback->>'queuedAt')::timestamptz,
        NULLIF(playback->>'startedAt', '')::timestamptz,
        NULLIF(playback->>'endedAt', '')::timestamptz,
        COALESCE(
          NULLIF(playback->>'endedAt', '')::timestamptz,
          NULLIF(playback->>'startedAt', '')::timestamptz,
          (playback->>'queuedAt')::timestamptz
        )
      FROM jsonb_array_elements(COALESCE(event_payload->'playbacks', '[]'::jsonb)) AS playback;

    WHEN 'providerOperations' THEN
      INSERT INTO ai_phone.provider_operations(
        id, session_id, provider, operation_type, operation_key, idempotency_key,
        request_hash, status, attempt, version, external_operation_id,
        external_resource_id, last_error_class, started_at, accepted_at,
        answered_at, completion_observed_at, completion_observed_event,
        ended_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'sessionId', event_payload->>'provider',
        event_payload->>'operationType', event_payload->>'operationKey',
        event_payload->>'idempotencyKey', event_payload->>'requestHash',
        event_payload->>'status', (event_payload->>'attempt')::integer,
        (event_payload->>'version')::bigint, event_payload->>'externalOperationId',
        event_payload->>'externalResourceId', event_payload->>'lastErrorClass',
        (event_payload->>'startedAt')::timestamptz,
        NULLIF(event_payload->>'acceptedAt', '')::timestamptz,
        NULLIF(event_payload->>'answeredAt', '')::timestamptz,
        NULLIF(event_payload->>'completionObservedAt', '')::timestamptz,
        event_payload->>'completionObservedEvent',
        NULLIF(event_payload->>'endedAt', '')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, attempt = EXCLUDED.attempt, version = EXCLUDED.version,
        external_operation_id = EXCLUDED.external_operation_id,
        external_resource_id = EXCLUDED.external_resource_id,
        last_error_class = EXCLUDED.last_error_class, accepted_at = EXCLUDED.accepted_at,
        answered_at = EXCLUDED.answered_at,
        completion_observed_at = EXCLUDED.completion_observed_at,
        completion_observed_event = EXCLUDED.completion_observed_event,
        ended_at = EXCLUDED.ended_at, updated_at = EXCLUDED.updated_at;

    WHEN 'workerDispatches' THEN
      INSERT INTO ai_phone.worker_dispatches(
        id, call_id, session_id, room_name, provider, agent_name, status,
        generation, version, operation_id, external_dispatch_id, job_id,
        worker_id, metadata_hash, lease_expires_at, ready_at,
        last_heartbeat_at, ended_at, last_error_class, created_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'callId', event_payload->>'sessionId',
        event_payload->>'roomName', event_payload->>'provider', event_payload->>'agentName',
        event_payload->>'status', (event_payload->>'generation')::integer,
        (event_payload->>'version')::bigint, event_payload->>'operationId',
        event_payload->>'externalDispatchId', event_payload->>'jobId',
        event_payload->>'workerId', event_payload->>'metadataHash',
        (event_payload->>'leaseExpiresAt')::timestamptz,
        NULLIF(event_payload->>'readyAt', '')::timestamptz,
        NULLIF(event_payload->>'lastHeartbeatAt', '')::timestamptz,
        NULLIF(event_payload->>'endedAt', '')::timestamptz,
        event_payload->>'lastErrorClass', (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, generation = EXCLUDED.generation,
        version = EXCLUDED.version, operation_id = EXCLUDED.operation_id,
        external_dispatch_id = EXCLUDED.external_dispatch_id, job_id = EXCLUDED.job_id,
        worker_id = EXCLUDED.worker_id, metadata_hash = EXCLUDED.metadata_hash,
        lease_expires_at = EXCLUDED.lease_expires_at, ready_at = EXCLUDED.ready_at,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at, ended_at = EXCLUDED.ended_at,
        last_error_class = EXCLUDED.last_error_class, updated_at = EXCLUDED.updated_at;

    WHEN 'workerCapacityReservations' THEN
      INSERT INTO ai_phone.worker_capacity_reservations(
        id, session_id, resource, units, status, owner, lease_expires_at,
        released_at, created_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'sessionId', event_payload->>'resource',
        (event_payload->>'units')::integer, event_payload->>'status',
        event_payload->>'owner', (event_payload->>'leaseExpiresAt')::timestamptz,
        NULLIF(event_payload->>'releasedAt', '')::timestamptz,
        (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, owner = EXCLUDED.owner,
        lease_expires_at = EXCLUDED.lease_expires_at,
        released_at = EXCLUDED.released_at, updated_at = EXCLUDED.updated_at;

    WHEN 'participantRecordingConsents' THEN
      INSERT INTO ai_phone.participant_recording_consents(
        id, session_id, participant_identity, policy_version, status,
        granted_at, revoked_at, created_at
      ) VALUES (
        event_payload->>'id', event_payload->>'sessionId',
        event_payload->>'participantIdentity', event_payload->>'policyVersion',
        event_payload->>'status', NULLIF(event_payload->>'grantedAt', '')::timestamptz,
        NULLIF(event_payload->>'revokedAt', '')::timestamptz,
        (event_payload->>'createdAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, granted_at = EXCLUDED.granted_at,
        revoked_at = EXCLUDED.revoked_at;

    WHEN 'recordingConsentSnapshots' THEN
      INSERT INTO ai_phone.recording_consent_snapshots(
        id, session_id, policy_version, purpose, participant_consent_ids,
        participant_identities, payload_hash, created_at
      ) VALUES (
        event_payload->>'id', event_payload->>'sessionId',
        event_payload->>'policyVersion', event_payload->>'purpose',
        ARRAY(SELECT jsonb_array_elements_text(event_payload->'participantConsentIds')),
        ARRAY(SELECT jsonb_array_elements_text(event_payload->'participantIdentities')),
        event_payload->>'payloadHash', (event_payload->>'createdAt')::timestamptz
      ) ON CONFLICT (id) DO NOTHING;

    WHEN 'recordingJobs' THEN
      INSERT INTO ai_phone.recording_jobs(
        id, session_id, room_name, recording_type, provider, consent_snapshot_id,
        retention_until, object_key, content_type, status, idempotency_key,
        request_hash, version, provider_operation_id, external_recording_id,
        last_error_class, created_at, updated_at, started_at, ended_at
      ) VALUES (
        event_payload->>'id', event_payload->>'sessionId', event_payload->>'roomName',
        event_payload->>'recordingType', event_payload->>'provider',
        event_payload->>'consentSnapshotId', (event_payload->>'retentionUntil')::timestamptz,
        event_payload->>'objectKey', event_payload->>'contentType', event_payload->>'status',
        event_payload->>'idempotencyKey', event_payload->>'requestHash',
        (event_payload->>'version')::bigint, event_payload->>'providerOperationId',
        event_payload->>'externalRecordingId', event_payload->>'lastErrorClass',
        (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz,
        NULLIF(event_payload->>'startedAt', '')::timestamptz,
        NULLIF(event_payload->>'endedAt', '')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, version = EXCLUDED.version,
        provider_operation_id = EXCLUDED.provider_operation_id,
        external_recording_id = EXCLUDED.external_recording_id,
        last_error_class = EXCLUDED.last_error_class, updated_at = EXCLUDED.updated_at,
        started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at;

    WHEN 'recordingArtifacts' THEN
      INSERT INTO ai_phone.recording_artifacts(
        id, recording_job_id, session_id, object_key, content_type, status,
        size_bytes, duration_ms, sha256, available_at, verified_at, deleted_at,
        created_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'recordingJobId',
        event_payload->>'sessionId', event_payload->>'objectKey',
        event_payload->>'contentType', event_payload->>'status',
        NULLIF(event_payload->>'sizeBytes', '')::bigint,
        NULLIF(event_payload->>'durationMs', '')::bigint, event_payload->>'sha256',
        NULLIF(event_payload->>'availableAt', '')::timestamptz,
        NULLIF(event_payload->>'verifiedAt', '')::timestamptz,
        NULLIF(event_payload->>'deletedAt', '')::timestamptz,
        (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, size_bytes = EXCLUDED.size_bytes,
        duration_ms = EXCLUDED.duration_ms, sha256 = EXCLUDED.sha256,
        available_at = EXCLUDED.available_at, verified_at = EXCLUDED.verified_at,
        deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at;

    WHEN 'agentCallDrafts' THEN
      INSERT INTO ai_phone.agent_tasks(
        id, user_id, scenario, objective, suggested_script, target_name,
        target_phone_reference, language, risk_level, status,
        consent_prompt_version, disclosure_prompt_version,
        recipient_disclosure_confirmed, authorization_at, risk_reasons,
        call_id, external_call_id, execution_provider, queued_at, started_at,
        completed_at, failed_at, consumed_seconds, result_summary,
        failure_reason, next_step, created_at, updated_at
      ) VALUES (
        event_payload->>'id', event_payload->>'userId', event_payload->>'scenario',
        event_payload->>'objective', event_payload->>'suggestedScript',
        event_payload->>'targetName', NULL, event_payload->>'language',
        event_payload->>'riskLevel', event_payload->>'status',
        event_payload->>'consentPromptVersion', event_payload->>'disclosurePromptVersion',
        NULLIF(event_payload->>'recipientDisclosureConfirmed', '')::boolean,
        NULLIF(event_payload->>'authorizedAt', '')::timestamptz,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(event_payload->'riskReasons', '[]'::jsonb))),
        event_payload->>'callId', event_payload->>'providerCallId',
        event_payload->>'executionProvider', NULLIF(event_payload->>'queuedAt', '')::timestamptz,
        NULLIF(event_payload->>'startedAt', '')::timestamptz,
        NULLIF(event_payload->>'completedAt', '')::timestamptz,
        NULLIF(event_payload->>'failedAt', '')::timestamptz,
        NULLIF(event_payload->>'consumedSeconds', '')::integer,
        event_payload->>'resultSummary', event_payload->>'failureReason',
        event_payload->>'nextStep', (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, risk_level = EXCLUDED.risk_level,
        risk_reasons = EXCLUDED.risk_reasons,
        consent_prompt_version = EXCLUDED.consent_prompt_version,
        disclosure_prompt_version = EXCLUDED.disclosure_prompt_version,
        recipient_disclosure_confirmed = EXCLUDED.recipient_disclosure_confirmed,
        authorization_at = EXCLUDED.authorization_at, call_id = EXCLUDED.call_id,
        external_call_id = EXCLUDED.external_call_id,
        execution_provider = EXCLUDED.execution_provider, queued_at = EXCLUDED.queued_at,
        started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at,
        failed_at = EXCLUDED.failed_at, consumed_seconds = EXCLUDED.consumed_seconds,
        result_summary = EXCLUDED.result_summary, failure_reason = EXCLUDED.failure_reason,
        next_step = EXCLUDED.next_step, updated_at = EXCLUDED.updated_at;
  END CASE;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('003_projection_apply')
ON CONFLICT (version) DO NOTHING;

COMMIT;
