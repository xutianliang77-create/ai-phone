ALTER TABLE enterprise.support_cases
  ADD CONSTRAINT support_cases_followup_binding_key
  UNIQUE (tenant_id, id, session_id, customer_id);
ALTER TABLE enterprise.support_agent_claims
  ADD CONSTRAINT support_agent_claims_followup_binding_key
  UNIQUE (tenant_id, id, support_session_id);

CREATE TABLE enterprise.support_callbacks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  session_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN (
    'dispatch_pending', 'scheduled', 'failed', 'cancelled', 'completed'
  )),
  external_callback_id text CHECK (
    external_callback_id IS NULL OR
    length(btrim(external_callback_id)) BETWEEN 1 AND 200
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, session_id, customer_id),
  FOREIGN KEY (tenant_id, session_id, customer_id)
    REFERENCES enterprise.support_sessions (tenant_id, id, customer_id),
  CHECK (scheduled_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at = updated_at),
  CHECK (
    (status = 'dispatch_pending' AND external_callback_id IS NULL AND
      completed_at IS NULL) OR
    (status = 'scheduled' AND external_callback_id IS NOT NULL AND
      failure_code IS NULL AND completed_at IS NOT NULL) OR
    (status = 'failed' AND external_callback_id IS NULL AND
      failure_code IS NOT NULL AND completed_at IS NOT NULL) OR
    (status IN ('cancelled', 'completed') AND completed_at IS NOT NULL)
  )
);
CREATE INDEX support_callbacks_session_idx
  ON enterprise.support_callbacks (tenant_id, session_id, created_at, id);
ALTER TABLE enterprise.support_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_callbacks FORCE ROW LEVEL SECURITY;
CREATE POLICY support_callbacks_tenant_isolation
  ON enterprise.support_callbacks
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE TABLE enterprise.support_followup_commands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  session_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  agent_claim_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ticket', 'callback')),
  case_id uuid,
  callback_id uuid,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  outbox_event_id uuid NOT NULL,
  provider_fingerprint text NOT NULL CHECK (
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  provider_simulated boolean NOT NULL,
  provider_reference text CHECK (
    provider_reference IS NULL OR
    length(btrim(provider_reference)) BETWEEN 1 AND 400
  ),
  result_hash text CHECK (result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  attempts integer NOT NULL CHECK (attempts >= 0),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, session_id, idempotency_key),
  UNIQUE (tenant_id, outbox_event_id),
  FOREIGN KEY (tenant_id, session_id, customer_id)
    REFERENCES enterprise.support_sessions (tenant_id, id, customer_id),
  FOREIGN KEY (tenant_id, agent_claim_id, session_id)
    REFERENCES enterprise.support_agent_claims (
      tenant_id, id, support_session_id
    ),
  FOREIGN KEY (tenant_id, case_id, session_id, customer_id)
    REFERENCES enterprise.support_cases (
      tenant_id, id, session_id, customer_id
    ),
  FOREIGN KEY (tenant_id, callback_id, session_id, customer_id)
    REFERENCES enterprise.support_callbacks (
      tenant_id, id, session_id, customer_id
    ),
  FOREIGN KEY (tenant_id, outbox_event_id)
    REFERENCES enterprise.outbox_events (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (kind = 'ticket' AND case_id IS NOT NULL AND callback_id IS NULL) OR
    (kind = 'callback' AND callback_id IS NOT NULL AND case_id IS NULL)
  ),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at = updated_at),
  CHECK (
    (status = 'processing' AND provider_reference IS NULL AND
      result_hash IS NULL AND completed_at IS NULL) OR
    (status = 'completed' AND provider_reference IS NOT NULL AND
      result_hash IS NOT NULL AND failure_code IS NULL AND
      completed_at IS NOT NULL) OR
    (status = 'failed' AND provider_reference IS NOT NULL AND
      result_hash IS NULL AND failure_code IS NOT NULL AND
      completed_at IS NOT NULL)
  )
);
CREATE INDEX support_followup_commands_session_idx
  ON enterprise.support_followup_commands (
    tenant_id, session_id, created_at, id
  );
CREATE INDEX support_followup_commands_pending_idx
  ON enterprise.support_followup_commands (
    tenant_id, status, outbox_event_id, id
  ) WHERE status = 'processing';
ALTER TABLE enterprise.support_followup_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_followup_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY support_followup_commands_tenant_isolation
  ON enterprise.support_followup_commands
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.guard_support_followup_command_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM enterprise.support_sessions session
    JOIN enterprise.support_agent_claims claim
      ON claim.tenant_id = session.tenant_id AND
        claim.id = session.active_agent_claim_id AND
        claim.support_session_id = session.id
    JOIN enterprise.members member
      ON member.tenant_id = session.tenant_id AND
        member.user_id = NEW.created_by
    WHERE session.tenant_id = NEW.tenant_id AND session.id = NEW.session_id AND
      session.customer_id = NEW.customer_id AND session.status = 'human_active' AND
      session.active_agent_claim_id = NEW.agent_claim_id AND
      claim.status = 'active' AND claim.lease_expires_at > NEW.created_at AND
      member.status = 'active' AND (
        member.user_id = claim.agent_user_id OR
        member.role IN ('owner', 'admin', 'support_manager')
      )
  ) THEN
    RAISE EXCEPTION 'enterprise support followup binding is not eligible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_followup_commands_insert_guard BEFORE INSERT
  ON enterprise.support_followup_commands FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_followup_command_insert();

CREATE OR REPLACE FUNCTION enterprise.guard_support_callback_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.session_id,
    NEW.customer_id, NEW.scheduled_at, NEW.reason, NEW.created_by,
    NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id,
    OLD.session_id, OLD.customer_id, OLD.scheduled_at, OLD.reason,
    OLD.created_by, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at < OLD.updated_at OR OLD.status <> 'dispatch_pending' OR
    NEW.status NOT IN ('scheduled', 'failed') THEN
    RAISE EXCEPTION 'invalid enterprise support callback mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_callbacks_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_callbacks FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_callback_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_support_followup_command_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.session_id,
    NEW.customer_id, NEW.agent_claim_id, NEW.kind, NEW.case_id,
    NEW.callback_id, NEW.idempotency_key, NEW.request_hash,
    NEW.outbox_event_id, NEW.provider_fingerprint, NEW.provider_simulated,
    NEW.created_by, NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id,
    OLD.id, OLD.session_id, OLD.customer_id, OLD.agent_claim_id, OLD.kind,
    OLD.case_id, OLD.callback_id, OLD.idempotency_key, OLD.request_hash,
    OLD.outbox_event_id, OLD.provider_fingerprint, OLD.provider_simulated,
    OLD.created_by, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at < OLD.updated_at OR OLD.status <> 'processing' OR
    NEW.status NOT IN ('processing', 'completed', 'failed') OR
    NEW.attempts <> OLD.attempts + 1 THEN
    RAISE EXCEPTION 'invalid enterprise support followup command mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_followup_commands_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_followup_commands FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_followup_command_mutation();
