DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.tool_executions
    WHERE registry_definition_id IS NOT NULL AND risk_level = 'reversible_write' AND (
      status NOT IN ('awaiting_confirmation', 'cancelled') OR
      confirmation_challenge_id IS NOT NULL OR write_outbox_event_id IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'cannot roll back enterprise support write tools after confirmation';
  END IF;
END;
$$;

DROP INDEX IF EXISTS enterprise.tool_executions_write_pending_idx;
ALTER TABLE enterprise.tool_executions
  DROP CONSTRAINT tool_executions_runtime_shape_check,
  DROP CONSTRAINT tool_executions_write_outbox_unique,
  DROP CONSTRAINT tool_executions_confirmation_challenge_unique,
  DROP CONSTRAINT tool_executions_write_outbox_fk,
  DROP CONSTRAINT tool_executions_confirmation_turn_fk,
  DROP CONSTRAINT tool_executions_confirmation_run_fk,
  DROP CONSTRAINT tool_executions_confirmation_time_check,
  DROP CONSTRAINT tool_executions_confirmation_hash_check,
  DROP COLUMN write_outbox_event_id,
  DROP COLUMN confirmation_decided_at,
  DROP COLUMN confirmation_expires_at,
  DROP COLUMN confirmation_requested_at,
  DROP COLUMN confirmation_after_sequence,
  DROP COLUMN confirmation_turn_id,
  DROP COLUMN confirmation_run_id,
  DROP COLUMN confirmation_response_hash,
  DROP COLUMN confirmation_prompt_hash,
  DROP COLUMN confirmation_challenge_id,
  ADD CONSTRAINT tool_executions_read_shape_check CHECK (
    (registry_definition_id IS NULL AND execution_attempt = 0 AND
      execution_lease_id IS NULL AND execution_lease_expires_at IS NULL AND
      provider_fingerprint IS NULL AND provider_simulated IS NULL AND
      result_document IS NULL AND result_hash IS NULL AND failure_code IS NULL) OR
    (registry_definition_id IS NOT NULL AND risk_level <> 'read' AND
      execution_attempt = 0 AND execution_lease_id IS NULL AND
      execution_lease_expires_at IS NULL AND provider_fingerprint IS NULL AND
      provider_simulated IS NULL AND result_document IS NULL AND
      result_hash IS NULL AND failure_code IS NULL) OR
    (registry_definition_id IS NOT NULL AND risk_level = 'read' AND
      confirmation_status = 'not_required' AND authorization_scope = 'support:read' AND (
      (status = 'requested' AND execution_attempt = 0 AND
        execution_lease_id IS NULL AND execution_lease_expires_at IS NULL AND
        provider_fingerprint IS NULL AND provider_simulated IS NULL AND
        result_document IS NULL AND result_hash IS NULL AND failure_code IS NULL AND
        external_result_ref IS NULL) OR
      (status = 'running' AND execution_attempt >= 1 AND
        execution_lease_id IS NOT NULL AND execution_lease_expires_at IS NOT NULL AND
        provider_fingerprint IS NOT NULL AND provider_simulated IS NOT NULL AND
        result_document IS NULL AND result_hash IS NULL AND failure_code IS NULL AND
        external_result_ref IS NULL) OR
      (status = 'completed' AND execution_attempt >= 1 AND
        execution_lease_id IS NOT NULL AND execution_lease_expires_at IS NOT NULL AND
        provider_fingerprint IS NOT NULL AND provider_simulated IS NOT NULL AND
        result_document IS NOT NULL AND result_hash IS NOT NULL AND failure_code IS NULL AND
        external_result_ref IS NOT NULL) OR
      (status = 'failed' AND execution_attempt >= 1 AND
        execution_lease_id IS NOT NULL AND execution_lease_expires_at IS NOT NULL AND
        provider_fingerprint IS NOT NULL AND provider_simulated IS NOT NULL AND
        result_document IS NULL AND result_hash IS NULL AND failure_code IS NOT NULL AND
        external_result_ref IS NULL) OR
      (status = 'cancelled' AND result_document IS NULL AND result_hash IS NULL AND
        failure_code IS NULL AND external_result_ref IS NULL AND (
          (execution_attempt = 0 AND execution_lease_id IS NULL AND
            execution_lease_expires_at IS NULL AND provider_fingerprint IS NULL AND
            provider_simulated IS NULL) OR
          (execution_attempt >= 1 AND execution_lease_id IS NOT NULL AND
            execution_lease_expires_at IS NOT NULL AND provider_fingerprint IS NOT NULL AND
            provider_simulated IS NOT NULL)
        ))
    ))
  );

CREATE OR REPLACE FUNCTION enterprise.guard_tool_execution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;
  IF ROW(NEW.tenant_id, NEW.id, NEW.session_id, NEW.customer_id,
    NEW.tool_name, NEW.risk_level, NEW.request_hash, NEW.idempotency_key,
    NEW.registry_definition_id, NEW.tool_revision, NEW.arguments_hash,
    NEW.authorization_scope, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.session_id, OLD.customer_id,
    OLD.tool_name, OLD.risk_level, OLD.request_hash, OLD.idempotency_key,
    OLD.registry_definition_id, OLD.tool_revision, OLD.arguments_hash,
    OLD.authorization_scope, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at OR
    (NEW.started_at IS DISTINCT FROM OLD.started_at AND NOT (
      OLD.started_at IS NULL AND NEW.started_at = NEW.updated_at AND
      OLD.status IN ('requested', 'confirmed') AND NEW.status = 'running'
    )) OR
    (NEW.completed_at IS DISTINCT FROM OLD.completed_at AND NOT (
      OLD.completed_at IS NULL AND NEW.completed_at = NEW.updated_at AND
      OLD.status <> NEW.status AND
      NEW.status IN ('completed', 'rejected', 'failed', 'cancelled')
    )) OR
    (OLD.registry_definition_id IS NOT NULL AND OLD.risk_level = 'read' AND
      OLD.status = 'running' AND NEW.status IN ('completed', 'failed') AND
      NEW.completed_at >= OLD.execution_lease_expires_at) OR
    NEW.execution_attempt < OLD.execution_attempt OR
    NEW.execution_attempt > OLD.execution_attempt + 1 OR
    (NEW.execution_attempt = OLD.execution_attempt + 1 AND NOT (
      NEW.status = 'running' AND OLD.status IN ('requested', 'running') AND
      (OLD.status <> 'running' OR OLD.execution_lease_expires_at <= NEW.updated_at) AND
      NEW.execution_lease_id IS NOT NULL AND
      NEW.execution_lease_id IS DISTINCT FROM OLD.execution_lease_id AND
      NEW.execution_lease_expires_at > NEW.updated_at AND
      NEW.provider_fingerprint IS NOT NULL AND NEW.provider_simulated IS NOT NULL
    )) OR
    (NEW.execution_attempt = OLD.execution_attempt AND
      ROW(NEW.execution_lease_id, NEW.execution_lease_expires_at,
        NEW.provider_fingerprint, NEW.provider_simulated) IS DISTINCT FROM
      ROW(OLD.execution_lease_id, OLD.execution_lease_expires_at,
        OLD.provider_fingerprint, OLD.provider_simulated)) OR
    (ROW(NEW.result_document, NEW.result_hash, NEW.failure_code,
      NEW.external_result_ref) IS DISTINCT FROM
      ROW(OLD.result_document, OLD.result_hash, OLD.failure_code,
      OLD.external_result_ref) AND NOT (
        OLD.status = 'running' AND NEW.status IN ('completed', 'failed') AND
        NEW.execution_attempt = OLD.execution_attempt
      )) OR
    (NEW.status IN ('confirmed', 'running', 'completed') AND
      NEW.registry_definition_id IS NULL) OR
    OLD.status IN ('completed', 'rejected', 'failed', 'cancelled') OR NOT (
      NEW.status = OLD.status OR
      (OLD.status = 'requested' AND NEW.status IN (
        'awaiting_confirmation', 'running', 'rejected', 'failed', 'cancelled')) OR
      (OLD.status = 'awaiting_confirmation' AND NEW.status IN (
        'confirmed', 'rejected', 'failed', 'cancelled')) OR
      (OLD.status = 'confirmed' AND NEW.status IN ('running', 'failed', 'cancelled')) OR
      (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;
  RETURN NEW;
END;
$$;
