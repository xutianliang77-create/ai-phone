DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM enterprise.support_agent_claims) THEN
    RAISE EXCEPTION 'cannot roll back enterprise support agent claim evidence';
  END IF;
END;
$$;

DROP POLICY IF EXISTS tenant_isolation ON enterprise.support_agent_claims;
DROP TRIGGER IF EXISTS support_sessions_active_claim_guard
  ON enterprise.support_sessions;
DROP TRIGGER IF EXISTS support_agent_claims_binding_guard
  ON enterprise.support_agent_claims;
DROP FUNCTION IF EXISTS enterprise.validate_support_session_active_claim();
DROP FUNCTION IF EXISTS enterprise.validate_support_agent_claim_binding();
ALTER TABLE enterprise.support_sessions
  DROP CONSTRAINT support_sessions_active_claim_fk,
  DROP CONSTRAINT support_sessions_state_shape_check,
  ADD CONSTRAINT support_sessions_state_shape_check CHECK (
    (status = 'created' AND queued_at IS NULL AND started_at IS NULL AND
      handoff_requested_at IS NULL AND assigned_user_id IS NULL AND ended_at IS NULL) OR
    (status = 'waiting' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NULL AND handoff_requested_at IS NULL AND
      assigned_user_id IS NULL AND ended_at IS NULL) OR
    (status = 'ai_active' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND assigned_user_id IS NULL AND ended_at IS NULL) OR
    (status = 'handoff_requested' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND handoff_requested_at IS NOT NULL AND
      assigned_user_id IS NULL AND ended_at IS NULL) OR
    (status = 'human_active' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND handoff_requested_at IS NOT NULL AND
      assigned_user_id IS NOT NULL AND ended_at IS NULL) OR
    (status = 'ended' AND ended_at IS NOT NULL AND failure_code IS NULL) OR
    (status = 'failed' AND ended_at IS NOT NULL AND failure_code IS NOT NULL)
  ),
  DROP COLUMN active_agent_claim_id;

DROP TRIGGER IF EXISTS support_agent_claims_mutation_guard
  ON enterprise.support_agent_claims;
DROP TRIGGER IF EXISTS support_agent_claims_insert_guard
  ON enterprise.support_agent_claims;
DROP FUNCTION IF EXISTS enterprise.guard_support_agent_claim_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_support_agent_claim_insert();
DROP TABLE enterprise.support_agent_claims;

CREATE OR REPLACE FUNCTION enterprise.guard_support_session_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invalid enterprise support session mutation';
  END IF;
  IF ROW(NEW.tenant_id, NEW.id, NEW.customer_id, NEW.channel_id,
    NEW.creation_key, NEW.creation_request_hash, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.customer_id, OLD.channel_id,
    OLD.creation_key, OLD.creation_request_hash, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR OLD.status IN ('ended', 'failed') OR NOT (
      NEW.status = OLD.status OR
      (OLD.status = 'created' AND NEW.status IN ('waiting', 'failed')) OR
      (OLD.status = 'waiting' AND NEW.status IN (
        'ai_active', 'handoff_requested', 'ended', 'failed'
      )) OR
      (OLD.status = 'ai_active' AND NEW.status IN (
        'handoff_requested', 'ended', 'failed'
      )) OR
      (OLD.status = 'handoff_requested' AND NEW.status IN (
        'ai_active', 'human_active', 'ended', 'failed'
      )) OR
      (OLD.status = 'human_active' AND NEW.status IN (
        'handoff_requested', 'ended', 'failed'
      ))
    ) THEN RAISE EXCEPTION 'invalid enterprise support session mutation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE enterprise.support_queues
  DROP COLUMN claim_lease_seconds,
  DROP COLUMN handoff_sla_seconds;
