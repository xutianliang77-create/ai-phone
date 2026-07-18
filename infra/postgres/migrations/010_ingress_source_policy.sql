BEGIN;

ALTER TABLE ai_phone.external_media_sources
  ADD COLUMN IF NOT EXISTS source_url_hash text,
  ADD COLUMN IF NOT EXISTS source_final_url_hash text,
  ADD COLUMN IF NOT EXISTS source_resolution_hash text,
  ADD COLUMN IF NOT EXISTS source_validated_at timestamptz;

CREATE OR REPLACE FUNCTION ai_phone.apply_ingress_projection_event(
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
  IF event_namespace <> 'externalMediaSources' THEN
    RAISE EXCEPTION 'Unsupported ingress projection namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported ingress projection operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Ingress projection payload is required for upsert';
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
    DELETE FROM ai_phone.external_media_sources WHERE id = record_key;
    RETURN true;
  END IF;

  INSERT INTO ai_phone.external_media_sources(
    id, session_id, room_name, provider, input_type, participant_identity,
    status, external_ingress_id, source_policy_version, idempotency_key,
    request_hash, source_url_hash, source_final_url_hash,
    source_resolution_hash, source_validated_at, version,
    provider_operation_id, last_error_class, created_at, updated_at, ended_at
  ) VALUES (
    event_payload->>'id', event_payload->>'sessionId', event_payload->>'roomName',
    event_payload->>'provider', event_payload->>'inputType',
    event_payload->>'participantIdentity', event_payload->>'status',
    event_payload->>'externalIngressId', event_payload->>'sourcePolicyVersion',
    event_payload->>'idempotencyKey', event_payload->>'requestHash',
    event_payload->>'sourceUrlHash', event_payload->>'sourceFinalUrlHash',
    event_payload->>'sourceResolutionHash',
    NULLIF(event_payload->>'sourceValidatedAt', '')::timestamptz,
    (event_payload->>'version')::bigint, event_payload->>'providerOperationId',
    event_payload->>'lastErrorClass', (event_payload->>'createdAt')::timestamptz,
    (event_payload->>'updatedAt')::timestamptz,
    NULLIF(event_payload->>'endedAt', '')::timestamptz
  ) ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status, external_ingress_id = EXCLUDED.external_ingress_id,
    source_url_hash = EXCLUDED.source_url_hash,
    source_final_url_hash = EXCLUDED.source_final_url_hash,
    source_resolution_hash = EXCLUDED.source_resolution_hash,
    source_validated_at = EXCLUDED.source_validated_at,
    version = EXCLUDED.version,
    provider_operation_id = EXCLUDED.provider_operation_id,
    last_error_class = EXCLUDED.last_error_class,
    updated_at = EXCLUDED.updated_at, ended_at = EXCLUDED.ended_at;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('010_ingress_source_policy')
ON CONFLICT (version) DO NOTHING;

COMMIT;
