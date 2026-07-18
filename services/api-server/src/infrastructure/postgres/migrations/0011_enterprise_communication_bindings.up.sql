CREATE TABLE enterprise.communication_session_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  communication_session_id text NOT NULL,
  scope_type text GENERATED ALWAYS AS ('tenant'::text) STORED,
  scope_id text GENERATED ALWAYS AS (tenant_id::text) STORED,
  kind text NOT NULL CHECK (kind IN ('meeting', 'support', 'marketing')),
  meeting_id uuid,
  support_session_id uuid,
  marketing_call_task_id uuid,
  status text NOT NULL CHECK (status IN (
    'provisioning', 'dispatching', 'ready', 'active', 'degraded',
    'captions_only', 'half_duplex', 'draining', 'ended', 'cancelled', 'failed'
  )),
  home_region text NOT NULL CHECK (length(home_region) BETWEEN 2 AND 64),
  cell_id text NOT NULL CHECK (length(cell_id) BETWEEN 2 AND 64),
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128),
  entitlement_version text NOT NULL
    CHECK (length(btrim(entitlement_version)) BETWEEN 1 AND 128),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  last_event_at timestamptz,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, communication_session_id),
  FOREIGN KEY (scope_type, scope_id, communication_session_id)
    REFERENCES ai_phone.communication_sessions (scope_type, scope_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, marketing_call_task_id)
    REFERENCES enterprise.marketing_call_tasks (tenant_id, id),
  CHECK (
    (kind = 'meeting' AND meeting_id IS NOT NULL
      AND support_session_id IS NULL AND marketing_call_task_id IS NULL)
    OR
    (kind = 'support' AND meeting_id IS NULL
      AND support_session_id IS NOT NULL AND marketing_call_task_id IS NULL)
    OR
    (kind = 'marketing' AND meeting_id IS NULL
      AND support_session_id IS NULL AND marketing_call_task_id IS NOT NULL)
  ),
  CHECK (
    (status IN ('ended', 'cancelled', 'failed') AND ended_at IS NOT NULL)
    OR (status NOT IN ('ended', 'cancelled', 'failed') AND ended_at IS NULL)
  ),
  CHECK (updated_at >= started_at),
  CHECK (last_event_at IS NULL OR last_event_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX communication_bindings_meeting_unique_idx
  ON enterprise.communication_session_bindings (tenant_id, meeting_id)
  WHERE meeting_id IS NOT NULL;
CREATE UNIQUE INDEX communication_bindings_support_unique_idx
  ON enterprise.communication_session_bindings (tenant_id, support_session_id)
  WHERE support_session_id IS NOT NULL;
CREATE UNIQUE INDEX communication_bindings_marketing_unique_idx
  ON enterprise.communication_session_bindings (tenant_id, marketing_call_task_id)
  WHERE marketing_call_task_id IS NOT NULL;
CREATE INDEX communication_bindings_recovery_idx
  ON enterprise.communication_session_bindings (
    tenant_id, status, generation, last_event_sequence, updated_at, id
  )
  WHERE status NOT IN ('ended', 'cancelled', 'failed');

CREATE OR REPLACE FUNCTION enterprise.reject_communication_binding_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.kind,
    NEW.meeting_id, NEW.support_session_id, NEW.marketing_call_task_id,
    NEW.home_region, NEW.cell_id, NEW.route_epoch,
    NEW.policy_version, NEW.entitlement_version, NEW.started_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.kind,
    OLD.meeting_id, OLD.support_session_id, OLD.marketing_call_task_id,
    OLD.home_region, OLD.cell_id, OLD.route_epoch,
    OLD.policy_version, OLD.entitlement_version, OLD.started_at
  ) THEN
    RAISE EXCEPTION 'enterprise communication binding identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER communication_binding_identity_immutable
BEFORE UPDATE ON enterprise.communication_session_bindings
FOR EACH ROW
EXECUTE FUNCTION enterprise.reject_communication_binding_identity_change();

ALTER TABLE enterprise.communication_session_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.communication_session_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY communication_session_bindings_tenant_isolation
  ON enterprise.communication_session_bindings
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

COMMENT ON COLUMN enterprise.marketing_call_tasks.translation_session_id IS
  'Legacy pre-scope field; new enterprise flows use communication_session_bindings.';
COMMENT ON COLUMN enterprise.support_sessions.translation_session_id IS
  'Legacy pre-scope field; new enterprise flows use communication_session_bindings.';
COMMENT ON COLUMN enterprise.meetings.translation_session_id IS
  'Legacy pre-scope field; new enterprise flows use communication_session_bindings.';
