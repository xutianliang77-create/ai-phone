CREATE TABLE enterprise.support_tool_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  tool_name text NOT NULL CHECK (
    tool_name ~ '^[a-z][a-z0-9_.-]{1,127}$'
  ),
  revision bigint NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  description text NOT NULL CHECK (
    octet_length(btrim(description)) BETWEEN 1 AND 500
  ),
  risk_level text NOT NULL CHECK (
    risk_level IN ('read', 'reversible_write', 'high_risk')
  ),
  required_scope text NOT NULL CHECK (
    required_scope IN ('support:read', 'support:manage', 'support:takeover')
  ),
  confirmation_mode text NOT NULL CHECK (
    confirmation_mode IN ('none', 'customer_confirmation', 'human_handoff')
  ),
  input_schema jsonb NOT NULL CHECK (
    jsonb_typeof(input_schema) = 'object' AND
    input_schema ->> 'type' = 'object' AND
    input_schema ->> 'additionalProperties' = 'false' AND
    jsonb_typeof(input_schema -> 'properties') = 'object' AND
    jsonb_typeof(input_schema -> 'required') = 'array' AND
    octet_length(input_schema::text) <= 8192
  ),
  schema_hash text NOT NULL CHECK (schema_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  published_by text CHECK (
    published_by IS NULL OR enterprise.is_account_subject_id(published_by)
  ),
  retired_by text CHECK (
    retired_by IS NULL OR enterprise.is_account_subject_id(retired_by)
  ),
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  retired_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, tool_name, revision),
  UNIQUE (
    tenant_id, id, tool_name, revision, risk_level, required_scope
  ),
  CHECK (
    (risk_level = 'read' AND required_scope = 'support:read' AND
      confirmation_mode = 'none') OR
    (risk_level = 'reversible_write' AND required_scope = 'support:manage' AND
      confirmation_mode = 'customer_confirmation') OR
    (risk_level = 'high_risk' AND required_scope = 'support:takeover' AND
      confirmation_mode = 'human_handoff')
  ),
  CHECK (
    (status = 'draft' AND published_by IS NULL AND published_at IS NULL AND
      retired_by IS NULL AND retired_at IS NULL) OR
    (status = 'active' AND published_by IS NOT NULL AND published_at IS NOT NULL AND
      retired_by IS NULL AND retired_at IS NULL) OR
    (status = 'retired' AND published_by IS NOT NULL AND published_at IS NOT NULL AND
      retired_by IS NOT NULL AND retired_at IS NOT NULL)
  ),
  CHECK (updated_at >= created_at AND
    (published_at IS NULL OR published_at >= created_at) AND
    (retired_at IS NULL OR retired_at >= published_at))
);
CREATE UNIQUE INDEX support_tool_definitions_active_idx
  ON enterprise.support_tool_definitions (tenant_id, tool_name)
  WHERE status = 'active';
CREATE INDEX support_tool_definitions_list_idx
  ON enterprise.support_tool_definitions (tenant_id, tool_name, revision DESC, id);

CREATE OR REPLACE FUNCTION enterprise.guard_support_tool_definition_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.tool_name,
    NEW.revision, NEW.description, NEW.risk_level, NEW.required_scope,
    NEW.confirmation_mode, NEW.input_schema, NEW.schema_hash, NEW.created_by,
    NEW.created_at) IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id, OLD.tool_name,
    OLD.revision, OLD.description, OLD.risk_level, OLD.required_scope,
    OLD.confirmation_mode, OLD.input_schema, OLD.schema_hash, OLD.created_by,
    OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    (OLD.status = 'active' AND ROW(NEW.published_by, NEW.published_at)
      IS DISTINCT FROM ROW(OLD.published_by, OLD.published_at)) OR
    OLD.status = 'retired' OR NOT (
      (OLD.status = 'draft' AND NEW.status = 'active') OR
      (OLD.status = 'active' AND NEW.status = 'retired')
    ) THEN RAISE EXCEPTION 'invalid enterprise support tool definition mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_tool_definitions_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_tool_definitions FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_tool_definition_mutation();

ALTER TABLE enterprise.tool_executions
  ADD COLUMN registry_definition_id uuid,
  ADD COLUMN tool_revision bigint,
  ADD COLUMN arguments_hash text,
  ADD COLUMN authorization_scope text,
  ADD CONSTRAINT tool_executions_registry_shape_check CHECK (
    (registry_definition_id IS NULL AND tool_revision IS NULL AND
      arguments_hash IS NULL AND authorization_scope IS NULL) OR
    (registry_definition_id IS NOT NULL AND tool_revision >= 1 AND
      arguments_hash ~ '^[a-f0-9]{64}$' AND authorization_scope IS NOT NULL)
  ),
  ADD CONSTRAINT tool_executions_registry_fk FOREIGN KEY (
    tenant_id, registry_definition_id, tool_name, tool_revision,
    risk_level, authorization_scope
  ) REFERENCES enterprise.support_tool_definitions (
    tenant_id, id, tool_name, revision, risk_level, required_scope
  );

UPDATE enterprise.tool_executions
SET status = 'cancelled', completed_at = GREATEST(created_at, now()),
  updated_at = GREATEST(created_at, now()), version = version + 1
WHERE registry_definition_id IS NULL AND status IN (
  'requested', 'awaiting_confirmation', 'confirmed', 'running'
);

CREATE OR REPLACE FUNCTION enterprise.guard_registered_tool_execution_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition_status text;
DECLARE definition_confirmation text;
BEGIN
  SELECT status, confirmation_mode
    INTO definition_status, definition_confirmation
  FROM enterprise.support_tool_definitions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.registry_definition_id
    AND tool_name = NEW.tool_name AND revision = NEW.tool_revision
    AND risk_level = NEW.risk_level
    AND required_scope = NEW.authorization_scope;
  IF definition_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'enterprise support tool is not registered and active';
  END IF;
  IF NEW.risk_level = 'high_risk' THEN
    RAISE EXCEPTION 'enterprise high risk support tool requires human handoff';
  END IF;
  IF (NEW.risk_level = 'read' AND NOT (
      definition_confirmation = 'none' AND
      NEW.confirmation_status = 'not_required' AND NEW.status = 'requested'
    )) OR (NEW.risk_level = 'reversible_write' AND NOT (
      definition_confirmation = 'customer_confirmation' AND
      NEW.confirmation_status = 'required' AND NEW.status = 'awaiting_confirmation'
    )) THEN
    RAISE EXCEPTION 'enterprise support tool confirmation policy mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tool_executions_registry_insert_guard BEFORE INSERT
  ON enterprise.tool_executions FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_registered_tool_execution_insert();

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

ALTER TABLE enterprise.support_tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_tool_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise.support_tool_definitions
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
