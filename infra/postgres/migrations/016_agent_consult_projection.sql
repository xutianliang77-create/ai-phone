BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.agent_consults (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ai_phone.agent_runs(id) ON DELETE CASCADE,
  handoff_id text NOT NULL REFERENCES ai_phone.handoff_records(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  main_room_name text NOT NULL,
  consult_room_name text NOT NULL UNIQUE,
  operator_phone_hash text NOT NULL,
  operator_participant_identity text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'requested', 'dialing', 'connected', 'merging', 'merged',
    'rejected', 'no_answer', 'failed', 'completed'
  )),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  provider_operation_id text,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  dialing_at timestamptz,
  connected_at timestamptz,
  merging_at timestamptz,
  merged_at timestamptz,
  rejected_at timestamptz,
  failed_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  billable_seconds integer CHECK (billable_seconds IS NULL OR billable_seconds >= 0),
  updated_at timestamptz NOT NULL,
  UNIQUE(run_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_consults_one_active_run_idx
  ON ai_phone.agent_consults(run_id)
  WHERE status IN ('requested', 'dialing', 'connected', 'merging', 'merged');
CREATE INDEX IF NOT EXISTS agent_consults_recovery_idx
  ON ai_phone.agent_consults(status, expires_at, updated_at)
  WHERE status IN ('requested', 'dialing', 'connected', 'merging', 'merged');

CREATE OR REPLACE FUNCTION ai_phone.apply_agent_consult_projection_event(
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
  IF event_namespace <> 'agentConsults' THEN
    RAISE EXCEPTION 'Unsupported Agent consult projection namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported Agent consult projection operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Agent consult payload is required for upsert';
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
    DELETE FROM ai_phone.agent_consults WHERE id = record_key;
    RETURN true;
  END IF;

  INSERT INTO ai_phone.agent_consults(
    id, run_id, handoff_id, session_id, main_room_name, consult_room_name,
    operator_phone_hash, operator_participant_identity, status,
    idempotency_key, request_hash, version, provider_operation_id,
    requested_at, expires_at, dialing_at, connected_at, merging_at,
    merged_at, rejected_at, failed_at, completed_at, failure_code,
    billable_seconds, updated_at
  ) VALUES (
    event_payload->>'id', event_payload->>'runId', event_payload->>'handoffId',
    event_payload->>'sessionId', event_payload->>'mainRoomName',
    event_payload->>'consultRoomName', event_payload->>'operatorPhoneHash',
    event_payload->>'operatorParticipantIdentity', event_payload->>'status',
    event_payload->>'idempotencyKey', event_payload->>'requestHash',
    (event_payload->>'version')::bigint, event_payload->>'providerOperationId',
    (event_payload->>'requestedAt')::timestamptz,
    (event_payload->>'expiresAt')::timestamptz,
    NULLIF(event_payload->>'dialingAt', '')::timestamptz,
    NULLIF(event_payload->>'connectedAt', '')::timestamptz,
    NULLIF(event_payload->>'mergingAt', '')::timestamptz,
    NULLIF(event_payload->>'mergedAt', '')::timestamptz,
    NULLIF(event_payload->>'rejectedAt', '')::timestamptz,
    NULLIF(event_payload->>'failedAt', '')::timestamptz,
    NULLIF(event_payload->>'completedAt', '')::timestamptz,
    event_payload->>'failureCode',
    NULLIF(event_payload->>'billableSeconds', '')::integer,
    (event_payload->>'updatedAt')::timestamptz
  ) ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    version = EXCLUDED.version,
    provider_operation_id = EXCLUDED.provider_operation_id,
    dialing_at = EXCLUDED.dialing_at,
    connected_at = EXCLUDED.connected_at,
    merging_at = EXCLUDED.merging_at,
    merged_at = EXCLUDED.merged_at,
    rejected_at = EXCLUDED.rejected_at,
    failed_at = EXCLUDED.failed_at,
    completed_at = EXCLUDED.completed_at,
    failure_code = EXCLUDED.failure_code,
    billable_seconds = EXCLUDED.billable_seconds,
    updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('016_agent_consult_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
