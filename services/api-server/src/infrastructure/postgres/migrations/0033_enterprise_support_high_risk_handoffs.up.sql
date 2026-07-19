CREATE TABLE enterprise.support_high_risk_handoff_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  support_session_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  support_agent_run_id uuid NOT NULL,
  tool_definition_id uuid NOT NULL,
  tool_name text NOT NULL,
  tool_revision bigint NOT NULL CHECK (tool_revision >= 1),
  risk_level text NOT NULL DEFAULT 'high_risk'
    CHECK (risk_level = 'high_risk'),
  authorization_scope text NOT NULL DEFAULT 'support:takeover'
    CHECK (authorization_scope = 'support:takeover'),
  confirmation_mode text NOT NULL DEFAULT 'human_handoff'
    CHECK (confirmation_mode = 'human_handoff'),
  risk_category text NOT NULL CHECK (risk_category IN (
    'refund', 'payment', 'identity', 'other_high_risk'
  )),
  policy_version text NOT NULL CHECK (policy_version = 'ent-cs-008.v1'),
  arguments_hash text NOT NULL CHECK (arguments_hash ~ '^[a-f0-9]{64}$'),
  risk_evidence_hash text NOT NULL CHECK (risk_evidence_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, support_session_id, customer_id)
    REFERENCES enterprise.support_sessions (tenant_id, id, customer_id),
  FOREIGN KEY (tenant_id, support_agent_run_id)
    REFERENCES enterprise.support_agent_runs (tenant_id, id),
  FOREIGN KEY (
    tenant_id, tool_definition_id, tool_name, tool_revision,
    risk_level, authorization_scope
  ) REFERENCES enterprise.support_tool_definitions (
    tenant_id, id, tool_name, revision, risk_level, required_scope
  )
);

CREATE INDEX support_high_risk_handoffs_session_idx
  ON enterprise.support_high_risk_handoff_requests (
    tenant_id, support_session_id, created_at, id
  );

CREATE OR REPLACE FUNCTION enterprise.guard_support_high_risk_handoff_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_status text;
DECLARE run_status text;
DECLARE run_session_id uuid;
DECLARE definition_status text;
DECLARE definition_confirmation text;
BEGIN
  SELECT status INTO session_status
  FROM enterprise.support_sessions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.support_session_id
    AND customer_id = NEW.customer_id;
  SELECT status, support_session_id INTO run_status, run_session_id
  FROM enterprise.support_agent_runs
  WHERE tenant_id = NEW.tenant_id AND id = NEW.support_agent_run_id;
  SELECT status, confirmation_mode
    INTO definition_status, definition_confirmation
  FROM enterprise.support_tool_definitions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.tool_definition_id
    AND tool_name = NEW.tool_name AND revision = NEW.tool_revision
    AND risk_level = NEW.risk_level
    AND required_scope = NEW.authorization_scope;
  IF session_status IS DISTINCT FROM 'ai_active' OR
    run_status IS DISTINCT FROM 'active' OR
    run_session_id IS DISTINCT FROM NEW.support_session_id OR
    definition_status IS DISTINCT FROM 'active' OR
    definition_confirmation IS DISTINCT FROM 'human_handoff' THEN
    RAISE EXCEPTION 'enterprise high risk handoff binding is not active';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_high_risk_handoffs_insert_guard BEFORE INSERT
  ON enterprise.support_high_risk_handoff_requests FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_high_risk_handoff_insert();

CREATE OR REPLACE FUNCTION enterprise.guard_support_high_risk_handoff_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise high risk handoff request is immutable';
END;
$$;
CREATE TRIGGER support_high_risk_handoffs_mutation_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_high_risk_handoff_requests FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_high_risk_handoff_mutation();

ALTER TABLE enterprise.support_high_risk_handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_high_risk_handoff_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise.support_high_risk_handoff_requests
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
