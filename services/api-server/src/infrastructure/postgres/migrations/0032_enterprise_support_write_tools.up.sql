ALTER TABLE enterprise.tool_executions
  DROP CONSTRAINT tool_executions_read_shape_check,
  ADD COLUMN confirmation_challenge_id uuid,
  ADD COLUMN confirmation_prompt_hash text,
  ADD COLUMN confirmation_response_hash text,
  ADD COLUMN confirmation_run_id uuid,
  ADD COLUMN confirmation_turn_id uuid,
  ADD COLUMN confirmation_after_sequence bigint,
  ADD COLUMN confirmation_requested_at timestamptz,
  ADD COLUMN confirmation_expires_at timestamptz,
  ADD COLUMN confirmation_decided_at timestamptz,
  ADD COLUMN write_outbox_event_id uuid,
  ADD CONSTRAINT tool_executions_confirmation_hash_check CHECK (
    (confirmation_prompt_hash IS NULL OR confirmation_prompt_hash ~ '^[a-f0-9]{64}$') AND
    (confirmation_response_hash IS NULL OR confirmation_response_hash ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT tool_executions_confirmation_time_check CHECK (
    (confirmation_after_sequence IS NULL OR confirmation_after_sequence >= 0) AND
    (confirmation_requested_at IS NULL OR confirmation_requested_at >= created_at) AND
    (confirmation_expires_at IS NULL OR
      confirmation_expires_at > confirmation_requested_at) AND
    (confirmation_decided_at IS NULL OR
      confirmation_decided_at >= confirmation_requested_at)
  ),
  ADD CONSTRAINT tool_executions_confirmation_run_fk FOREIGN KEY (
    tenant_id, confirmation_run_id
  ) REFERENCES enterprise.support_agent_runs (tenant_id, id),
  ADD CONSTRAINT tool_executions_confirmation_turn_fk FOREIGN KEY (
    tenant_id, confirmation_turn_id
  ) REFERENCES enterprise.support_agent_turns (tenant_id, id),
  ADD CONSTRAINT tool_executions_write_outbox_fk FOREIGN KEY (
    tenant_id, write_outbox_event_id
  ) REFERENCES enterprise.outbox_events (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT tool_executions_confirmation_challenge_unique
    UNIQUE (tenant_id, confirmation_challenge_id),
  ADD CONSTRAINT tool_executions_write_outbox_unique
    UNIQUE (tenant_id, write_outbox_event_id),
  ADD CONSTRAINT tool_executions_runtime_shape_check CHECK (
    (registry_definition_id IS NULL AND execution_attempt = 0 AND
      execution_lease_id IS NULL AND execution_lease_expires_at IS NULL AND
      provider_fingerprint IS NULL AND provider_simulated IS NULL AND
      result_document IS NULL AND result_hash IS NULL AND failure_code IS NULL AND
      confirmation_challenge_id IS NULL AND confirmation_prompt_hash IS NULL AND
      confirmation_response_hash IS NULL AND confirmation_run_id IS NULL AND
      confirmation_turn_id IS NULL AND confirmation_after_sequence IS NULL AND
      confirmation_requested_at IS NULL AND confirmation_expires_at IS NULL AND
      confirmation_decided_at IS NULL AND write_outbox_event_id IS NULL) OR
    (registry_definition_id IS NOT NULL AND risk_level = 'read' AND
      confirmation_status = 'not_required' AND authorization_scope = 'support:read' AND
      confirmation_challenge_id IS NULL AND confirmation_prompt_hash IS NULL AND
      confirmation_response_hash IS NULL AND confirmation_run_id IS NULL AND
      confirmation_turn_id IS NULL AND confirmation_after_sequence IS NULL AND
      confirmation_requested_at IS NULL AND confirmation_expires_at IS NULL AND
      confirmation_decided_at IS NULL AND write_outbox_event_id IS NULL AND (
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
        result_document IS NOT NULL AND result_hash IS NOT NULL AND
        failure_code IS NULL AND external_result_ref IS NOT NULL) OR
      (status = 'failed' AND execution_attempt >= 1 AND
        execution_lease_id IS NOT NULL AND execution_lease_expires_at IS NOT NULL AND
        provider_fingerprint IS NOT NULL AND provider_simulated IS NOT NULL AND
        result_document IS NULL AND result_hash IS NULL AND failure_code IS NOT NULL AND
        external_result_ref IS NULL) OR
      (status = 'cancelled' AND result_document IS NULL AND result_hash IS NULL AND
        failure_code IS NULL AND external_result_ref IS NULL)
    )) OR
    (registry_definition_id IS NOT NULL AND risk_level = 'reversible_write' AND
      authorization_scope = 'support:manage' AND execution_lease_id IS NULL AND
      execution_lease_expires_at IS NULL AND (
      (status = 'awaiting_confirmation' AND confirmation_status = 'required' AND
        execution_attempt = 0 AND provider_fingerprint IS NULL AND
        provider_simulated IS NULL AND result_document IS NULL AND result_hash IS NULL AND
        failure_code IS NULL AND external_result_ref IS NULL AND
        confirmation_response_hash IS NULL AND confirmation_turn_id IS NULL AND
        confirmation_decided_at IS NULL AND write_outbox_event_id IS NULL AND (
          (confirmation_challenge_id IS NULL AND confirmation_prompt_hash IS NULL AND
            confirmation_run_id IS NULL AND confirmation_after_sequence IS NULL AND
            confirmation_requested_at IS NULL AND confirmation_expires_at IS NULL) OR
          (confirmation_challenge_id IS NOT NULL AND confirmation_prompt_hash IS NOT NULL AND
            confirmation_run_id IS NOT NULL AND confirmation_after_sequence IS NOT NULL AND
            confirmation_requested_at IS NOT NULL AND confirmation_expires_at IS NOT NULL)
        )) OR
      (status = 'confirmed' AND confirmation_status = 'confirmed' AND
        confirmation_challenge_id IS NOT NULL AND confirmation_prompt_hash IS NOT NULL AND
        confirmation_response_hash IS NOT NULL AND confirmation_run_id IS NOT NULL AND
        confirmation_turn_id IS NOT NULL AND confirmation_after_sequence IS NOT NULL AND
        confirmation_requested_at IS NOT NULL AND confirmation_expires_at IS NOT NULL AND
        confirmation_decided_at IS NOT NULL AND write_outbox_event_id IS NOT NULL AND
        provider_fingerprint IS NOT NULL AND provider_simulated IS NOT NULL AND
        result_document IS NULL AND result_hash IS NULL AND external_result_ref IS NULL AND
        ((execution_attempt = 0 AND failure_code IS NULL) OR
          (execution_attempt >= 1 AND failure_code IS NOT NULL))) OR
      (status = 'completed' AND confirmation_status = 'confirmed' AND
        execution_attempt >= 1 AND confirmation_challenge_id IS NOT NULL AND
        confirmation_prompt_hash IS NOT NULL AND confirmation_response_hash IS NOT NULL AND
        confirmation_run_id IS NOT NULL AND confirmation_turn_id IS NOT NULL AND
        confirmation_after_sequence IS NOT NULL AND confirmation_requested_at IS NOT NULL AND
        confirmation_expires_at IS NOT NULL AND confirmation_decided_at IS NOT NULL AND
        write_outbox_event_id IS NOT NULL AND provider_fingerprint IS NOT NULL AND
        provider_simulated IS NOT NULL AND result_document IS NOT NULL AND
        result_hash IS NOT NULL AND failure_code IS NULL AND external_result_ref IS NOT NULL) OR
      (status = 'failed' AND confirmation_status = 'confirmed' AND
        execution_attempt >= 1 AND confirmation_challenge_id IS NOT NULL AND
        confirmation_prompt_hash IS NOT NULL AND confirmation_response_hash IS NOT NULL AND
        confirmation_run_id IS NOT NULL AND confirmation_turn_id IS NOT NULL AND
        confirmation_after_sequence IS NOT NULL AND confirmation_requested_at IS NOT NULL AND
        confirmation_expires_at IS NOT NULL AND confirmation_decided_at IS NOT NULL AND
        write_outbox_event_id IS NOT NULL AND provider_fingerprint IS NOT NULL AND
        provider_simulated IS NOT NULL AND result_document IS NULL AND result_hash IS NULL AND
        failure_code IS NOT NULL AND external_result_ref IS NOT NULL) OR
      (status = 'rejected' AND confirmation_status = 'rejected' AND
        execution_attempt = 0 AND confirmation_challenge_id IS NOT NULL AND
        confirmation_prompt_hash IS NOT NULL AND confirmation_response_hash IS NOT NULL AND
        confirmation_run_id IS NOT NULL AND confirmation_turn_id IS NOT NULL AND
        confirmation_after_sequence IS NOT NULL AND confirmation_requested_at IS NOT NULL AND
        confirmation_expires_at IS NOT NULL AND confirmation_decided_at IS NOT NULL AND
        write_outbox_event_id IS NULL AND provider_fingerprint IS NULL AND
        provider_simulated IS NULL AND result_document IS NULL AND result_hash IS NULL AND
        failure_code IS NULL AND external_result_ref IS NULL) OR
      (status = 'cancelled' AND execution_attempt = 0 AND
        confirmation_challenge_id IS NULL AND confirmation_prompt_hash IS NULL AND
        confirmation_response_hash IS NULL AND confirmation_run_id IS NULL AND
        confirmation_turn_id IS NULL AND confirmation_after_sequence IS NULL AND
        confirmation_requested_at IS NULL AND confirmation_expires_at IS NULL AND
        confirmation_decided_at IS NULL AND write_outbox_event_id IS NULL AND
        provider_fingerprint IS NULL AND provider_simulated IS NULL AND
        result_document IS NULL AND result_hash IS NULL AND failure_code IS NULL AND
        external_result_ref IS NULL)
    ))
  );

CREATE INDEX tool_executions_write_pending_idx
  ON enterprise.tool_executions (tenant_id, status, write_outbox_event_id, id)
  WHERE registry_definition_id IS NOT NULL AND risk_level = 'reversible_write' AND
    status = 'confirmed';

CREATE OR REPLACE FUNCTION enterprise.guard_tool_execution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.session_id,
    NEW.customer_id, NEW.tool_name, NEW.risk_level, NEW.request_hash,
    NEW.idempotency_key, NEW.registry_definition_id, NEW.tool_revision,
    NEW.arguments_hash, NEW.authorization_scope, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.session_id, OLD.customer_id,
    OLD.tool_name, OLD.risk_level, OLD.request_hash, OLD.idempotency_key,
    OLD.registry_definition_id, OLD.tool_revision, OLD.arguments_hash,
    OLD.authorization_scope, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;

  IF OLD.registry_definition_id IS NOT NULL AND
    OLD.risk_level = 'reversible_write' THEN
    IF OLD.status IN ('completed', 'rejected', 'failed', 'cancelled') OR NOT (
      (OLD.status = 'awaiting_confirmation' AND NEW.status = 'awaiting_confirmation' AND
        OLD.execution_attempt = NEW.execution_attempt AND
        OLD.confirmation_response_hash IS NULL AND NEW.confirmation_response_hash IS NULL AND
        NEW.confirmation_challenge_id IS NOT NULL AND
        NEW.confirmation_requested_at = NEW.updated_at AND
        (OLD.confirmation_challenge_id IS NULL OR OLD.confirmation_expires_at <= NEW.updated_at)) OR
      (OLD.status = 'awaiting_confirmation' AND NEW.status IN ('confirmed', 'rejected') AND
        NEW.confirmation_challenge_id = OLD.confirmation_challenge_id AND
        NEW.confirmation_prompt_hash = OLD.confirmation_prompt_hash AND
        NEW.confirmation_run_id = OLD.confirmation_run_id AND
        NEW.confirmation_after_sequence = OLD.confirmation_after_sequence AND
        NEW.confirmation_requested_at = OLD.confirmation_requested_at AND
        NEW.confirmation_expires_at = OLD.confirmation_expires_at AND
        NEW.confirmation_decided_at = NEW.updated_at AND
        NEW.confirmation_decided_at <= OLD.confirmation_expires_at AND
        NEW.execution_attempt = OLD.execution_attempt) OR
      (OLD.status = 'awaiting_confirmation' AND NEW.status = 'cancelled' AND
        OLD.confirmation_challenge_id IS NULL AND NEW.execution_attempt = 0) OR
      (OLD.status = 'confirmed' AND NEW.status IN ('confirmed', 'completed', 'failed') AND
        NEW.execution_attempt = OLD.execution_attempt + 1 AND
        ROW(NEW.confirmation_challenge_id, NEW.confirmation_prompt_hash,
          NEW.confirmation_response_hash, NEW.confirmation_run_id,
          NEW.confirmation_turn_id, NEW.confirmation_after_sequence,
          NEW.confirmation_requested_at, NEW.confirmation_expires_at,
          NEW.confirmation_decided_at, NEW.write_outbox_event_id,
          NEW.provider_fingerprint, NEW.provider_simulated) IS NOT DISTINCT FROM
        ROW(OLD.confirmation_challenge_id, OLD.confirmation_prompt_hash,
          OLD.confirmation_response_hash, OLD.confirmation_run_id,
          OLD.confirmation_turn_id, OLD.confirmation_after_sequence,
          OLD.confirmation_requested_at, OLD.confirmation_expires_at,
          OLD.confirmation_decided_at, OLD.write_outbox_event_id,
          OLD.provider_fingerprint, OLD.provider_simulated))
    ) THEN RAISE EXCEPTION 'invalid enterprise write tool execution mutation';
    END IF;
  ELSE
    IF ROW(NEW.confirmation_challenge_id, NEW.confirmation_prompt_hash,
      NEW.confirmation_response_hash, NEW.confirmation_run_id,
      NEW.confirmation_turn_id, NEW.confirmation_after_sequence,
      NEW.confirmation_requested_at, NEW.confirmation_expires_at,
      NEW.confirmation_decided_at, NEW.write_outbox_event_id) IS DISTINCT FROM
      ROW(OLD.confirmation_challenge_id, OLD.confirmation_prompt_hash,
      OLD.confirmation_response_hash, OLD.confirmation_run_id,
      OLD.confirmation_turn_id, OLD.confirmation_after_sequence,
      OLD.confirmation_requested_at, OLD.confirmation_expires_at,
      OLD.confirmation_decided_at, OLD.write_outbox_event_id) OR
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
  END IF;

  IF (NEW.started_at IS DISTINCT FROM OLD.started_at AND NOT (
      OLD.started_at IS NULL AND NEW.started_at = NEW.updated_at AND
      OLD.status IN ('requested', 'confirmed') AND NEW.status = 'running')) OR
    (NEW.completed_at IS DISTINCT FROM OLD.completed_at AND NOT (
      OLD.completed_at IS NULL AND NEW.completed_at = NEW.updated_at AND
      OLD.status <> NEW.status AND
      NEW.status IN ('completed', 'rejected', 'failed', 'cancelled'))) OR
    (OLD.risk_level = 'read' AND OLD.status = 'running' AND
      NEW.status IN ('completed', 'failed') AND
      NEW.completed_at >= OLD.execution_lease_expires_at) OR
    (ROW(NEW.result_document, NEW.result_hash, NEW.failure_code,
      NEW.external_result_ref) IS DISTINCT FROM
      ROW(OLD.result_document, OLD.result_hash, OLD.failure_code,
      OLD.external_result_ref) AND NOT (
        (OLD.risk_level = 'read' AND OLD.status = 'running' AND
          NEW.status IN ('completed', 'failed') AND
          NEW.execution_attempt = OLD.execution_attempt) OR
        (OLD.risk_level = 'reversible_write' AND OLD.status = 'confirmed' AND
          NEW.status IN ('confirmed', 'completed', 'failed') AND
          NEW.execution_attempt = OLD.execution_attempt + 1)
      )) THEN RAISE EXCEPTION 'invalid enterprise tool execution result mutation';
  END IF;
  RETURN NEW;
END;
$$;
