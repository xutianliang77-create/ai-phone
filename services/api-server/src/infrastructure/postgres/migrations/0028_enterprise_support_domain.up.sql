CREATE TABLE enterprise.support_queues (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('active', 'paused', 'disabled')),
  default_priority integer NOT NULL CHECK (default_priority BETWEEN 0 AND 100),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX support_queues_tenant_name_unique_idx
  ON enterprise.support_queues (tenant_id, lower(name));
CREATE INDEX support_queues_tenant_status_idx
  ON enterprise.support_queues (tenant_id, status, default_priority DESC, id);
ALTER TABLE enterprise.support_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_queues FORCE ROW LEVEL SECURITY;
CREATE POLICY support_queues_tenant_isolation ON enterprise.support_queues
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

ALTER TABLE enterprise.support_channels
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT support_channels_type_check
    CHECK (channel_type IN ('pstn', 'web', 'app')),
  ADD CONSTRAINT support_channels_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_-]{1,63}$'),
  ADD CONSTRAINT support_channels_config_ref_check
    CHECK (length(btrim(config_ref)) BETWEEN 1 AND 200),
  ADD CONSTRAINT support_channels_status_check
    CHECK (status IN ('inactive', 'active', 'suspended')),
  ADD CONSTRAINT support_channels_time_check CHECK (updated_at >= created_at);

ALTER TABLE enterprise.customer_profiles
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT customer_profiles_external_check CHECK (
    external_id IS NULL OR length(btrim(external_id)) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT customer_profiles_phone_hash_check CHECK (
    phone_hash IS NULL OR phone_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT customer_profiles_name_check CHECK (
    display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT customer_profiles_locale_check CHECK (
    locale IS NULL OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  ),
  ADD CONSTRAINT customer_profiles_attributes_check
    CHECK (jsonb_typeof(attributes) = 'object'),
  ADD CONSTRAINT customer_profiles_consent_check
    CHECK (cardinality(consent_scope) <= 32 AND array_position(consent_scope, NULL) IS NULL),
  ADD CONSTRAINT customer_profiles_time_check CHECK (updated_at >= created_at);

ALTER TABLE enterprise.support_sessions
  ADD COLUMN creation_key text,
  ADD COLUMN creation_request_hash text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN queued_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN handoff_requested_at timestamptz,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN failure_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE enterprise.support_sessions SET
  creation_key = 'legacy:' || id::text,
  creation_request_hash = repeat('0', 64)
WHERE creation_key IS NULL OR creation_request_hash IS NULL;
ALTER TABLE enterprise.support_sessions
  ALTER COLUMN creation_key SET NOT NULL,
  ALTER COLUMN creation_request_hash SET NOT NULL,
  ADD CONSTRAINT support_sessions_creation_key_check
    CHECK (creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  ADD CONSTRAINT support_sessions_request_hash_check
    CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT support_sessions_status_check CHECK (status IN (
    'created', 'waiting', 'ai_active', 'handoff_requested',
    'human_active', 'ended', 'failed'
  )),
  ADD CONSTRAINT support_sessions_priority_check CHECK (priority BETWEEN 0 AND 100),
  ADD CONSTRAINT support_sessions_intent_check CHECK (
    intent IS NULL OR length(btrim(intent)) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT support_sessions_failure_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  ADD CONSTRAINT support_sessions_legacy_binding_check
    CHECK (translation_session_id IS NULL),
  ADD CONSTRAINT support_sessions_assignment_time_check CHECK (
    (assigned_user_id IS NULL) = (assigned_at IS NULL)
  ),
  ADD CONSTRAINT support_sessions_time_check CHECK (
    updated_at >= created_at AND
    (queued_at IS NULL OR queued_at >= created_at) AND
    (started_at IS NULL OR started_at >= COALESCE(queued_at, created_at)) AND
    (handoff_requested_at IS NULL OR
      handoff_requested_at >= COALESCE(started_at, queued_at, created_at)) AND
    (assigned_at IS NULL OR assigned_at >= handoff_requested_at) AND
    (ended_at IS NULL OR ended_at >= COALESCE(started_at, queued_at, created_at))
  ),
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
  ADD CONSTRAINT support_sessions_tenant_session_customer_unique
    UNIQUE (tenant_id, id, customer_id),
  ADD CONSTRAINT support_sessions_queue_fk FOREIGN KEY (tenant_id, queue_id)
    REFERENCES enterprise.support_queues (tenant_id, id);
CREATE UNIQUE INDEX support_sessions_tenant_creation_unique_idx
  ON enterprise.support_sessions (tenant_id, creation_key);
CREATE INDEX support_sessions_recovery_idx
  ON enterprise.support_sessions (tenant_id, status, updated_at, id)
  WHERE status NOT IN ('ended', 'failed');

ALTER TABLE enterprise.support_cases
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN closed_at timestamptz,
  ADD CONSTRAINT support_cases_subject_check
    CHECK (length(btrim(subject)) BETWEEN 1 AND 240),
  ADD CONSTRAINT support_cases_status_check
    CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  ADD CONSTRAINT support_cases_summary_check
    CHECK (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 4000),
  ADD CONSTRAINT support_cases_resolution_check
    CHECK (resolution IS NULL OR length(btrim(resolution)) BETWEEN 1 AND 4000),
  ADD CONSTRAINT support_cases_external_check
    CHECK (external_ticket_id IS NULL OR length(btrim(external_ticket_id)) BETWEEN 1 AND 200),
  ADD CONSTRAINT support_cases_time_check CHECK (
    updated_at >= created_at AND
    (resolved_at IS NULL OR resolved_at >= created_at) AND
    (closed_at IS NULL OR closed_at >= COALESCE(resolved_at, created_at))
  ),
  ADD CONSTRAINT support_cases_state_shape_check CHECK (
    (status IN ('open', 'pending') AND resolved_at IS NULL AND closed_at IS NULL) OR
    (status = 'resolved' AND resolved_at IS NOT NULL AND closed_at IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL)
  ),
  ADD CONSTRAINT support_cases_session_customer_fk
    FOREIGN KEY (tenant_id, session_id, customer_id)
    REFERENCES enterprise.support_sessions (tenant_id, id, customer_id);

ALTER TABLE enterprise.tool_executions
  ADD COLUMN customer_id uuid,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN version bigint NOT NULL DEFAULT 1;
UPDATE enterprise.tool_executions execution SET
  customer_id = session_record.customer_id,
  updated_at = COALESCE(execution.completed_at, execution.created_at)
FROM enterprise.support_sessions session_record
WHERE execution.tenant_id = session_record.tenant_id
  AND execution.session_id = session_record.id;
ALTER TABLE enterprise.tool_executions
  ALTER COLUMN customer_id SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT tool_executions_name_check
    CHECK (tool_name ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  ADD CONSTRAINT tool_executions_risk_check
    CHECK (risk_level IN ('read', 'reversible_write', 'high_risk')),
  ADD CONSTRAINT tool_executions_hash_check
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT tool_executions_confirmation_check CHECK (
    confirmation_status IN ('not_required', 'required', 'confirmed', 'rejected')
  ),
  ADD CONSTRAINT tool_executions_status_check CHECK (status IN (
    'requested', 'awaiting_confirmation', 'confirmed', 'running',
    'completed', 'rejected', 'failed', 'cancelled'
  )),
  ADD CONSTRAINT tool_executions_idempotency_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  ADD CONSTRAINT tool_executions_result_check CHECK (
    external_result_ref IS NULL OR length(btrim(external_result_ref)) BETWEEN 1 AND 400
  ),
  ADD CONSTRAINT tool_executions_time_check CHECK (
    updated_at >= created_at AND
    (started_at IS NULL OR started_at >= created_at) AND
    (completed_at IS NULL OR completed_at >= COALESCE(started_at, created_at))
  ),
  ADD CONSTRAINT tool_executions_state_shape_check CHECK (
    (status IN ('requested', 'awaiting_confirmation', 'confirmed') AND
      started_at IS NULL AND completed_at IS NULL) OR
    (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL) OR
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL) OR
    (status = 'rejected' AND confirmation_status = 'rejected' AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT tool_executions_confirmation_shape_check CHECK (
    (status = 'confirmed' AND confirmation_status = 'confirmed') OR
    (status IN ('running', 'completed') AND
      (risk_level = 'read' OR confirmation_status = 'confirmed')) OR
    status NOT IN ('confirmed', 'running', 'completed')
  ),
  ADD CONSTRAINT tool_executions_session_customer_fk
    FOREIGN KEY (tenant_id, session_id, customer_id)
    REFERENCES enterprise.support_sessions (tenant_id, id, customer_id);

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
      (OLD.status = 'waiting' AND NEW.status IN ('ai_active', 'handoff_requested', 'ended', 'failed')) OR
      (OLD.status = 'ai_active' AND NEW.status IN ('handoff_requested', 'ended', 'failed')) OR
      (OLD.status = 'handoff_requested' AND NEW.status IN ('ai_active', 'human_active', 'ended', 'failed')) OR
      (OLD.status = 'human_active' AND NEW.status IN ('handoff_requested', 'ended', 'failed'))
    ) THEN RAISE EXCEPTION 'invalid enterprise support session mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_sessions_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_sessions FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_session_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_support_case_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invalid enterprise support case mutation';
  END IF;
  IF ROW(NEW.tenant_id, NEW.id, NEW.customer_id, NEW.session_id,
    NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id, OLD.customer_id,
    OLD.session_id, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    OLD.status = 'closed' OR NOT (NEW.status = OLD.status OR
      (OLD.status IN ('open', 'pending') AND NEW.status IN ('open', 'pending', 'resolved', 'closed')) OR
      (OLD.status = 'resolved' AND NEW.status = 'closed')) THEN
    RAISE EXCEPTION 'invalid enterprise support case mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_cases_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_cases FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_case_mutation();

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
CREATE TRIGGER tool_executions_guard BEFORE UPDATE OR DELETE
  ON enterprise.tool_executions FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_tool_execution_mutation();
