CREATE TABLE enterprise.marketing_pstn_dispatches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  task_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  communication_session_id text NOT NULL,
  communication_binding_id uuid NOT NULL,
  usage_hold_id uuid NOT NULL,
  outbox_event_id uuid NOT NULL,
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  home_region text NOT NULL CHECK (length(home_region) BETWEEN 2 AND 64),
  cell_id text NOT NULL CHECK (length(cell_id) BETWEEN 2 AND 64),
  provider text NOT NULL CHECK (provider IN ('pstn_http', 'pstn_fonoster')),
  provider_fingerprint text NOT NULL CHECK (provider_fingerprint ~ '^[a-f0-9]{64}$'),
  provider_idempotency_key text NOT NULL CHECK (
    provider_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN (
    'prepared', 'unknown', 'accepted', 'answered', 'completed', 'failed'
  )),
  provider_call_id text CHECK (
    provider_call_id IS NULL OR length(btrim(provider_call_id)) BETWEEN 1 AND 160
  ),
  last_provider_event_id text CHECK (
    last_provider_event_id IS NULL OR
      last_provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  prepared_at timestamptz NOT NULL,
  accepted_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_id, dispatch_generation),
  UNIQUE (tenant_id, provider_idempotency_key),
  UNIQUE (tenant_id, communication_session_id),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES enterprise.marketing_call_tasks (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, communication_binding_id)
    REFERENCES enterprise.communication_session_bindings (tenant_id, id),
  FOREIGN KEY (tenant_id, usage_hold_id)
    REFERENCES enterprise.usage_holds (tenant_id, id),
  FOREIGN KEY (tenant_id, outbox_event_id)
    REFERENCES enterprise.outbox_events (tenant_id, id),
  CHECK (updated_at >= prepared_at),
  CHECK (accepted_at IS NULL OR accepted_at BETWEEN prepared_at AND updated_at),
  CHECK (answered_at IS NULL OR answered_at BETWEEN prepared_at AND updated_at),
  CHECK (ended_at IS NULL OR ended_at BETWEEN prepared_at AND updated_at),
  CHECK ((status IN ('completed', 'failed')) = (ended_at IS NOT NULL)),
  CHECK (status <> 'answered' OR answered_at IS NOT NULL),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);

CREATE INDEX marketing_pstn_dispatches_tenant_campaign_idx
  ON enterprise.marketing_pstn_dispatches
    (tenant_id, campaign_id, status, updated_at, id);
CREATE UNIQUE INDEX marketing_pstn_dispatches_provider_call_unique_idx
  ON enterprise.marketing_pstn_dispatches (tenant_id, provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_pstn_dispatch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing PSTN dispatch cannot be deleted';
  END IF;
  IF enterprise.current_user_id() <> 'system:enterprise-marketing-pstn' THEN
    RAISE EXCEPTION 'enterprise marketing PSTN dispatch actor rejected';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.status <> 'prepared' OR NEW.provider_call_id IS NOT NULL OR
      NEW.last_provider_event_id IS NOT NULL OR NEW.failure_code IS NOT NULL OR
      NEW.accepted_at IS NOT NULL OR NEW.answered_at IS NOT NULL OR
      NEW.ended_at IS NOT NULL OR NEW.updated_at IS DISTINCT FROM NEW.prepared_at OR
      NEW.version <> 1 OR NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_call_tasks task
        WHERE task.tenant_id = NEW.tenant_id AND task.id = NEW.task_id
          AND task.campaign_id = NEW.campaign_id AND task.status = 'dispatching'
          AND task.dispatch_generation = NEW.dispatch_generation
          AND task.usage_hold_id = NEW.usage_hold_id
          AND task.lease_expires_at > NEW.prepared_at) THEN
      RAISE EXCEPTION 'invalid enterprise marketing PSTN dispatch creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.task_id, NEW.campaign_id,
      NEW.communication_session_id, NEW.communication_binding_id,
      NEW.usage_hold_id, NEW.outbox_event_id, NEW.dispatch_generation,
      NEW.route_epoch, NEW.home_region, NEW.cell_id, NEW.provider,
      NEW.provider_fingerprint, NEW.provider_idempotency_key,
      NEW.request_hash, NEW.prepared_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.task_id, OLD.campaign_id,
      OLD.communication_session_id, OLD.communication_binding_id,
      OLD.usage_hold_id, OLD.outbox_event_id, OLD.dispatch_generation,
      OLD.route_epoch, OLD.home_region, OLD.cell_id, OLD.provider,
      OLD.provider_fingerprint, OLD.provider_idempotency_key,
      OLD.request_hash, OLD.prepared_at) OR NEW.version <> OLD.version + 1 OR
      NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'enterprise marketing PSTN dispatch identity is immutable';
  END IF;
  IF NOT ((OLD.status = 'prepared' AND NEW.status IN
      ('unknown', 'accepted', 'failed')) OR
    (OLD.status = 'unknown' AND NEW.status IN ('accepted', 'failed')) OR
    (OLD.status = 'accepted' AND NEW.status IN
      ('answered', 'completed', 'failed')) OR
    (OLD.status = 'answered' AND NEW.status IN ('completed', 'failed'))) THEN
    RAISE EXCEPTION 'invalid enterprise marketing PSTN dispatch transition';
  END IF;
  IF (NEW.status = 'accepted' AND NEW.accepted_at IS NULL) OR
    (NEW.status = 'answered' AND
      (NEW.accepted_at IS NULL OR NEW.answered_at IS NULL)) OR
    (NEW.status = 'completed' AND
      (NEW.accepted_at IS NULL OR NEW.ended_at IS NULL)) OR
    (NEW.status = 'failed' AND
      (NEW.failure_code IS NULL OR NEW.ended_at IS NULL)) THEN
    RAISE EXCEPTION 'invalid enterprise marketing PSTN dispatch evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_pstn_dispatches_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_pstn_dispatches
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_pstn_dispatch();

DROP TRIGGER marketing_call_tasks_scheduler_guard
  ON enterprise.marketing_call_tasks;
CREATE TRIGGER marketing_call_tasks_scheduler_insert_guard
BEFORE INSERT ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_scheduler_task();
CREATE TRIGGER marketing_call_tasks_scheduler_delete_guard
BEFORE DELETE ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_scheduler_task();
CREATE TRIGGER marketing_call_tasks_scheduler_update_guard
BEFORE UPDATE ON enterprise.marketing_call_tasks
FOR EACH ROW WHEN (NOT (
  (OLD.status = 'dispatching' AND NEW.status = 'dispatched') OR
  (OLD.status = 'dispatched' AND NEW.status IN ('answered', 'completed', 'failed')) OR
  (OLD.status = 'answered' AND NEW.status IN ('completed', 'failed'))
)) EXECUTE FUNCTION enterprise.guard_marketing_scheduler_task();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_pstn_task_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_dispatch_status text;
BEGIN
  IF enterprise.current_user_id() <> 'system:enterprise-marketing-pstn' OR
    ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.lead_id, NEW.scheduled_at,
      NEW.attempt, NEW.idempotency_key, NEW.approval_snapshot_id,
      NEW.country_policy_version_id, NEW.generation_hash, NEW.generated_by,
      NEW.generated_at, NEW.dispatch_generation, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.lead_id, OLD.scheduled_at,
      OLD.attempt, OLD.idempotency_key, OLD.approval_snapshot_id,
      OLD.country_policy_version_id, OLD.generation_hash, OLD.generated_by,
      OLD.generated_at, OLD.dispatch_generation, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at OR
    NEW.usage_hold_id IS DISTINCT FROM OLD.usage_hold_id THEN
    RAISE EXCEPTION 'invalid enterprise marketing PSTN task transition';
  END IF;
  IF NEW.status = 'dispatched' THEN
    IF OLD.status <> 'dispatching' OR NEW.outcome_code IS NOT NULL OR
      NEW.claimed_at IS NOT NULL OR NEW.claim_owner IS NOT NULL OR
      NEW.claim_token_hash IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid enterprise marketing PSTN task acceptance';
    END IF;
    expected_dispatch_status := 'accepted';
  ELSIF NEW.status = 'answered' THEN
    IF OLD.status <> 'dispatched' OR NEW.outcome_code IS NOT NULL THEN
      RAISE EXCEPTION 'invalid enterprise marketing PSTN task answer';
    END IF;
    expected_dispatch_status := 'answered';
  ELSIF NEW.status = 'completed' THEN
    IF OLD.status NOT IN ('dispatched', 'answered') OR
      NEW.outcome_code <> 'provider_completed' THEN
      RAISE EXCEPTION 'invalid enterprise marketing PSTN task completion';
    END IF;
    expected_dispatch_status := 'completed';
  ELSIF NEW.status = 'failed' THEN
    IF OLD.status NOT IN ('dispatched', 'answered') OR
      NEW.outcome_code <> 'provider_failed' THEN
      RAISE EXCEPTION 'invalid enterprise marketing PSTN task failure';
    END IF;
    expected_dispatch_status := 'failed';
  ELSE
    RAISE EXCEPTION 'invalid enterprise marketing PSTN task status';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
    WHERE dispatch.tenant_id = NEW.tenant_id AND dispatch.task_id = NEW.id
      AND dispatch.dispatch_generation = NEW.dispatch_generation
      AND dispatch.status = expected_dispatch_status
      AND dispatch.usage_hold_id = NEW.usage_hold_id
  ) THEN
    RAISE EXCEPTION 'enterprise marketing PSTN dispatch evidence required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_call_tasks_pstn_update_guard
BEFORE UPDATE ON enterprise.marketing_call_tasks
FOR EACH ROW WHEN (
  (OLD.status = 'dispatching' AND NEW.status = 'dispatched') OR
  (OLD.status = 'dispatched' AND NEW.status IN ('answered', 'completed', 'failed')) OR
  (OLD.status = 'answered' AND NEW.status IN ('completed', 'failed'))
) EXECUTE FUNCTION enterprise.guard_marketing_pstn_task_transition();

ALTER TABLE enterprise.marketing_pstn_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_pstn_dispatches FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_pstn_dispatches_tenant_isolation
  ON enterprise.marketing_pstn_dispatches
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
