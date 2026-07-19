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
    NEW.version <> OLD.version + 1 OR
    (NEW.status IN ('confirmed', 'running', 'completed') AND
      NEW.registry_definition_id IS NULL) OR
    OLD.status IN ('completed', 'rejected', 'failed', 'cancelled') OR NOT (
      NEW.status = OLD.status OR
      (OLD.status = 'requested' AND NEW.status IN (
        'awaiting_confirmation', 'running', 'rejected', 'failed', 'cancelled'
      )) OR
      (OLD.status = 'awaiting_confirmation' AND NEW.status IN (
        'confirmed', 'rejected', 'failed', 'cancelled'
      )) OR
      (OLD.status = 'confirmed' AND NEW.status IN ('running', 'failed', 'cancelled')) OR
      (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS enterprise.tool_executions_read_recovery_idx;
ALTER TABLE enterprise.tool_executions
  DROP CONSTRAINT IF EXISTS tool_executions_read_shape_check,
  DROP CONSTRAINT IF EXISTS tool_executions_read_lease_time_check,
  DROP CONSTRAINT IF EXISTS tool_executions_read_failure_check,
  DROP CONSTRAINT IF EXISTS tool_executions_read_result_check,
  DROP CONSTRAINT IF EXISTS tool_executions_read_provider_check,
  DROP COLUMN IF EXISTS failure_code,
  DROP COLUMN IF EXISTS result_hash,
  DROP COLUMN IF EXISTS result_document,
  DROP COLUMN IF EXISTS provider_simulated,
  DROP COLUMN IF EXISTS provider_fingerprint,
  DROP COLUMN IF EXISTS execution_lease_expires_at,
  DROP COLUMN IF EXISTS execution_lease_id,
  DROP COLUMN IF EXISTS execution_attempt;
