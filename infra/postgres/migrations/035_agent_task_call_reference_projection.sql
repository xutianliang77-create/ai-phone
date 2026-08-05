BEGIN;

CREATE OR REPLACE FUNCTION ai_phone.apply_agent_task_projection_event(
  event_id text,
  event_namespace text,
  record_key text,
  event_operation text,
  event_payload jsonb
) RETURNS boolean
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  inserted boolean;
BEGIN
  IF event_namespace <> 'agentCallDrafts' THEN
    RAISE EXCEPTION 'Unsupported agent task namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported agent task operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Agent task payload is required for upsert';
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
    DELETE FROM ai_phone.agent_tasks WHERE id = record_key;
    RETURN true;
  END IF;

  INSERT INTO ai_phone.agent_tasks(
    id, user_id, session_id, scenario, objective, suggested_script, target_name,
    target_phone_reference, language, risk_level, status,
    consent_prompt_version, disclosure_prompt_version,
    recipient_disclosure_confirmed, authorization_at, risk_reasons,
    call_id, external_call_id, execution_provider, queued_at, started_at,
    completed_at, failed_at, consumed_seconds, result_summary,
    failure_reason, next_step, worker_lease_owner, worker_lease_token_hash,
    worker_lease_expires_at, worker_lease_attempt, provider_operation_id,
    created_at, updated_at
  ) VALUES (
    event_payload->>'id', event_payload->>'userId', event_payload->>'callId',
    event_payload->>'scenario', event_payload->>'objective',
    event_payload->>'suggestedScript', event_payload->>'targetName', NULL,
    event_payload->>'language', event_payload->>'riskLevel',
    event_payload->>'status', event_payload->>'consentPromptVersion',
    event_payload->>'disclosurePromptVersion',
    NULLIF(event_payload->>'recipientDisclosureConfirmed', '')::boolean,
    NULLIF(event_payload->>'authorizedAt', '')::timestamptz,
    ARRAY(SELECT jsonb_array_elements_text(
      COALESCE(event_payload->'riskReasons', '[]'::jsonb)
    )),
    event_payload->>'callId', event_payload->>'providerCallId',
    event_payload->>'executionProvider',
    NULLIF(event_payload->>'queuedAt', '')::timestamptz,
    NULLIF(event_payload->>'startedAt', '')::timestamptz,
    NULLIF(event_payload->>'completedAt', '')::timestamptz,
    NULLIF(event_payload->>'failedAt', '')::timestamptz,
    NULLIF(event_payload->>'consumedSeconds', '')::integer,
    event_payload->>'resultSummary', event_payload->>'failureReason',
    event_payload->>'nextStep', event_payload->>'workerLeaseOwner',
    event_payload->>'workerLeaseTokenHash',
    NULLIF(event_payload->>'workerLeaseExpiresAt', '')::timestamptz,
    COALESCE((event_payload->>'workerLeaseAttempt')::integer, 0),
    event_payload->>'providerOperationId',
    (event_payload->>'createdAt')::timestamptz,
    (event_payload->>'updatedAt')::timestamptz
  ) ON CONFLICT (id) DO UPDATE SET
    session_id = EXCLUDED.session_id,
    status = EXCLUDED.status, risk_level = EXCLUDED.risk_level,
    risk_reasons = EXCLUDED.risk_reasons,
    call_id = EXCLUDED.call_id,
    external_call_id = EXCLUDED.external_call_id,
    execution_provider = EXCLUDED.execution_provider,
    queued_at = EXCLUDED.queued_at, started_at = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at, failed_at = EXCLUDED.failed_at,
    consumed_seconds = EXCLUDED.consumed_seconds,
    result_summary = EXCLUDED.result_summary,
    failure_reason = EXCLUDED.failure_reason, next_step = EXCLUDED.next_step,
    worker_lease_owner = EXCLUDED.worker_lease_owner,
    worker_lease_token_hash = EXCLUDED.worker_lease_token_hash,
    worker_lease_expires_at = EXCLUDED.worker_lease_expires_at,
    worker_lease_attempt = EXCLUDED.worker_lease_attempt,
    provider_operation_id = EXCLUDED.provider_operation_id,
    updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;

UPDATE ai_phone.agent_tasks AS task
SET session_id = primary_record.payload->>'callId',
    call_id = primary_record.payload->>'callId'
FROM ai_phone.projection_records AS primary_record
WHERE primary_record.namespace = 'agentCallDrafts'
  AND primary_record.record_key = task.id
  AND (
    task.session_id IS DISTINCT FROM primary_record.payload->>'callId' OR
    task.call_id IS DISTINCT FROM primary_record.payload->>'callId'
  );

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('035_agent_task_call_reference_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
