CREATE TABLE enterprise.release_controls (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  capability text NOT NULL CHECK (capability IN (
    'meeting.screen_ocr', 'support.agent', 'support.write_tools',
    'marketing.pstn'
  )),
  enabled boolean NOT NULL DEFAULT false,
  kill_switch_active boolean NOT NULL DEFAULT false,
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (
    circuit_state IN ('closed', 'open', 'half_open')
  ),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (
    consecutive_failures BETWEEN 0 AND 100000
  ),
  failure_threshold integer NOT NULL CHECK (failure_threshold BETWEEN 1 AND 100),
  owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 128),
  rollout_expires_at timestamptz NOT NULL,
  last_failure_at timestamptz,
  opened_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, capability),
  CHECK (rollout_expires_at > created_at),
  CHECK ((circuit_state = 'closed' AND opened_at IS NULL) OR
    (circuit_state IN ('open', 'half_open') AND opened_at IS NOT NULL))
);

CREATE TABLE enterprise.release_control_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  capability text NOT NULL,
  operation_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('control_change', 'outcome')),
  actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 160),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  state_before jsonb,
  state_after jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, capability, operation_id),
  FOREIGN KEY (tenant_id, capability)
    REFERENCES enterprise.release_controls (tenant_id, capability),
  CHECK (state_before IS NULL OR jsonb_typeof(state_before) = 'object'),
  CHECK (jsonb_typeof(state_after) = 'object')
);

CREATE INDEX release_control_events_tenant_capability_created_idx
  ON enterprise.release_control_events (tenant_id, capability, created_at DESC, id);

ALTER TABLE enterprise.release_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.release_controls FORCE ROW LEVEL SECURITY;
CREATE POLICY release_controls_tenant_isolation ON enterprise.release_controls
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

ALTER TABLE enterprise.release_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.release_control_events FORCE ROW LEVEL SECURITY;
CREATE POLICY release_control_events_tenant_isolation
  ON enterprise.release_control_events
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.guard_release_control_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise release control cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.tenant_id, NEW.capability, NEW.created_at) IS DISTINCT FROM
      (OLD.tenant_id, OLD.capability, OLD.created_at) THEN
    RAISE EXCEPTION 'enterprise release control identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise release control version transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.circuit_state = 'half_open' AND
      OLD.circuit_state NOT IN ('open', 'half_open') THEN
    RAISE EXCEPTION 'enterprise release half-open requires an open circuit'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_release_control_guard
BEFORE UPDATE OR DELETE ON enterprise.release_controls
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_release_control_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_release_control_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise release control event is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER enterprise_release_control_events_append_only
BEFORE UPDATE OR DELETE ON enterprise.release_control_events
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_release_control_event_mutation();
