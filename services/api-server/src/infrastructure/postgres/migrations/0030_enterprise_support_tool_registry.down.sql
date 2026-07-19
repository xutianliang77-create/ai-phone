DROP TRIGGER IF EXISTS tool_executions_registry_insert_guard
  ON enterprise.tool_executions;
DROP FUNCTION IF EXISTS enterprise.guard_registered_tool_execution_insert();

ALTER TABLE enterprise.tool_executions
  DROP CONSTRAINT IF EXISTS tool_executions_registry_fk,
  DROP CONSTRAINT IF EXISTS tool_executions_registry_shape_check,
  DROP COLUMN IF EXISTS authorization_scope,
  DROP COLUMN IF EXISTS arguments_hash,
  DROP COLUMN IF EXISTS tool_revision,
  DROP COLUMN IF EXISTS registry_definition_id;

CREATE OR REPLACE FUNCTION enterprise.guard_tool_execution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;
  IF ROW(NEW.tenant_id, NEW.id, NEW.session_id, NEW.customer_id,
    NEW.tool_name, NEW.risk_level, NEW.request_hash, NEW.idempotency_key, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id, OLD.session_id, OLD.customer_id,
    OLD.tool_name, OLD.risk_level, OLD.request_hash, OLD.idempotency_key, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR OLD.status IN ('completed', 'rejected', 'failed', 'cancelled') OR NOT (
      NEW.status = OLD.status OR
      (OLD.status = 'requested' AND NEW.status IN ('awaiting_confirmation', 'running', 'rejected', 'failed', 'cancelled')) OR
      (OLD.status = 'awaiting_confirmation' AND NEW.status IN ('confirmed', 'rejected', 'failed', 'cancelled')) OR
      (OLD.status = 'confirmed' AND NEW.status IN ('running', 'failed', 'cancelled')) OR
      (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise tool execution mutation';
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS tenant_isolation ON enterprise.support_tool_definitions;
DROP TRIGGER IF EXISTS support_tool_definitions_guard
  ON enterprise.support_tool_definitions;
DROP FUNCTION IF EXISTS enterprise.guard_support_tool_definition_mutation();
DROP TABLE IF EXISTS enterprise.support_tool_definitions;
