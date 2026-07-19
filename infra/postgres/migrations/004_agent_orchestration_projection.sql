BEGIN;

ALTER TABLE ai_phone.agent_steps
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS agent_steps_idempotency_idx
  ON ai_phone.agent_steps(run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE ai_phone.tool_executions
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS tool_executions_idempotency_idx
  ON ai_phone.tool_executions(run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_phone.handoff_records (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ai_phone.agent_runs(id) ON DELETE CASCADE,
  reason text NOT NULL,
  redacted_summary text NOT NULL,
  target text NOT NULL CHECK (target IN ('user', 'operator')),
  status text NOT NULL CHECK (status IN ('requested', 'accepted', 'failed')),
  requested_at timestamptz NOT NULL,
  accepted_at timestamptz,
  failed_at timestamptz
);

CREATE OR REPLACE FUNCTION ai_phone.apply_agent_projection_event(
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
    'agentRuns', 'agentSteps', 'agentToolExecutions', 'agentHandoffs'
  ) THEN
    RAISE EXCEPTION 'Unsupported agent projection namespace: %', event_namespace;
  END IF;
  IF event_operation NOT IN ('upsert', 'delete') THEN
    RAISE EXCEPTION 'Unsupported agent projection operation: %', event_operation;
  END IF;
  IF event_operation = 'upsert' AND event_payload IS NULL THEN
    RAISE EXCEPTION 'Agent projection payload is required for upsert';
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
    CASE event_namespace
      WHEN 'agentRuns' THEN DELETE FROM ai_phone.agent_runs WHERE id = record_key;
      WHEN 'agentSteps' THEN DELETE FROM ai_phone.agent_steps WHERE id = record_key;
      WHEN 'agentToolExecutions' THEN DELETE FROM ai_phone.tool_executions WHERE id = record_key;
      WHEN 'agentHandoffs' THEN DELETE FROM ai_phone.handoff_records WHERE id = record_key;
    END CASE;
    RETURN true;
  END IF;

  CASE event_namespace
    WHEN 'agentRuns' THEN
      INSERT INTO ai_phone.agent_runs(
        id, task_id, session_id, attempt, mode, status, policy_version,
        model_profile_id, started_at, ended_at, failure_code, created_at
      ) VALUES (
        event_payload->>'id', event_payload->>'taskId', event_payload->>'sessionId',
        (event_payload->>'attempt')::integer, event_payload->>'mode',
        event_payload->>'status', event_payload->>'policyVersion',
        event_payload->>'modelProfileId',
        NULLIF(event_payload->>'startedAt', '')::timestamptz,
        NULLIF(event_payload->>'endedAt', '')::timestamptz,
        event_payload->>'failureCode',
        (event_payload->>'createdAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, model_profile_id = EXCLUDED.model_profile_id,
        started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at,
        failure_code = EXCLUDED.failure_code;

    WHEN 'agentSteps' THEN
      INSERT INTO ai_phone.agent_steps(
        id, run_id, sequence, decision_type, input_turn_id, output_summary,
        latency_ms, status, idempotency_key, created_at
      ) VALUES (
        event_payload->>'id', event_payload->>'runId',
        (event_payload->>'sequence')::integer, event_payload->>'decisionType',
        event_payload->>'inputTurnId', event_payload->>'outputSummary',
        NULLIF(event_payload->>'latencyMs', '')::integer,
        event_payload->>'status', event_payload->>'idempotencyKey',
        (event_payload->>'createdAt')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, output_summary = EXCLUDED.output_summary,
        latency_ms = EXCLUDED.latency_ms;

    WHEN 'agentToolExecutions' THEN
      INSERT INTO ai_phone.tool_executions(
        id, run_id, step_id, tool_name, tool_version, arguments_hash,
        risk_level, approval_status, provider_operation_id, status,
        result_summary, idempotency_key, created_at, ended_at
      ) VALUES (
        event_payload->>'id', event_payload->>'runId', event_payload->>'stepId',
        event_payload->>'toolName', event_payload->>'toolVersion',
        event_payload->>'argumentsHash', event_payload->>'riskLevel',
        event_payload->>'approvalStatus', event_payload->>'providerOperationId',
        event_payload->>'status', event_payload->>'resultSummary',
        event_payload->>'idempotencyKey',
        (event_payload->>'createdAt')::timestamptz,
        NULLIF(event_payload->>'endedAt', '')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        approval_status = EXCLUDED.approval_status,
        provider_operation_id = EXCLUDED.provider_operation_id,
        status = EXCLUDED.status, result_summary = EXCLUDED.result_summary,
        ended_at = EXCLUDED.ended_at;

    WHEN 'agentHandoffs' THEN
      INSERT INTO ai_phone.handoff_records(
        id, run_id, reason, redacted_summary, target, status,
        requested_at, accepted_at, failed_at
      ) VALUES (
        event_payload->>'id', event_payload->>'runId', event_payload->>'reason',
        event_payload->>'redactedSummary', event_payload->>'target',
        event_payload->>'status', (event_payload->>'requestedAt')::timestamptz,
        NULLIF(event_payload->>'acceptedAt', '')::timestamptz,
        NULLIF(event_payload->>'failedAt', '')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, accepted_at = EXCLUDED.accepted_at,
        failed_at = EXCLUDED.failed_at;
  END CASE;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('004_agent_orchestration_projection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
