DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.support_sessions
    WHERE status = 'human_active' OR
      (status IN ('ended', 'failed') AND assigned_user_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'cannot add support agent claims while legacy agent bindings exist';
  END IF;
END;
$$;

ALTER TABLE enterprise.support_queues
  ADD COLUMN handoff_sla_seconds integer NOT NULL DEFAULT 60
    CHECK (handoff_sla_seconds BETWEEN 10 AND 86400),
  ADD COLUMN claim_lease_seconds integer NOT NULL DEFAULT 300
    CHECK (claim_lease_seconds BETWEEN 30 AND 3600);

CREATE TABLE enterprise.support_agent_claims (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  support_session_id uuid NOT NULL,
  queue_id uuid NOT NULL,
  agent_user_id text NOT NULL CHECK (
    enterprise.is_account_subject_id(agent_user_id)
  ),
  status text NOT NULL CHECK (status IN (
    'active', 'released', 'reassigned', 'expired'
  )),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reassigned_from_claim_id uuid,
  claimed_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  released_at timestamptz,
  released_by text CHECK (
    released_by IS NULL OR enterprise.is_account_subject_id(released_by)
  ),
  release_reason text CHECK (release_reason IS NULL OR release_reason IN (
    'agent_release', 'agent_disconnect', 'manager_release',
    'reassigned', 'lease_expired'
  )),
  release_idempotency_key text CHECK (
    release_idempotency_key IS NULL OR
    release_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  release_request_hash text CHECK (
    release_request_hash IS NULL OR release_request_hash ~ '^[a-f0-9]{64}$'
  ),
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, support_session_id, agent_user_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, queue_id)
    REFERENCES enterprise.support_queues (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_user_id)
    REFERENCES enterprise.members (tenant_id, user_id),
  FOREIGN KEY (tenant_id, reassigned_from_claim_id)
    REFERENCES enterprise.support_agent_claims (tenant_id, id),
  CHECK (lease_expires_at > claimed_at AND updated_at >= claimed_at),
  CHECK (
    (status = 'active' AND released_at IS NULL AND released_by IS NULL AND
      release_reason IS NULL AND release_idempotency_key IS NULL AND
      release_request_hash IS NULL) OR
    (status IN ('released', 'reassigned', 'expired') AND
      released_at IS NOT NULL AND released_at >= claimed_at AND
      released_by IS NOT NULL AND release_reason IS NOT NULL AND
      release_idempotency_key IS NOT NULL AND release_request_hash IS NOT NULL)
  )
);
CREATE UNIQUE INDEX support_agent_claims_active_session_idx
  ON enterprise.support_agent_claims (tenant_id, support_session_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX support_agent_claims_release_key_idx
  ON enterprise.support_agent_claims (tenant_id, release_idempotency_key)
  WHERE release_idempotency_key IS NOT NULL;
CREATE INDEX support_agent_claims_agent_idx
  ON enterprise.support_agent_claims (
    tenant_id, agent_user_id, status, lease_expires_at, id
  );

ALTER TABLE enterprise.support_sessions
  ADD COLUMN active_agent_claim_id uuid;

ALTER TABLE enterprise.support_sessions
  ADD CONSTRAINT support_sessions_active_claim_fk FOREIGN KEY (
    tenant_id, active_agent_claim_id, id, assigned_user_id
  ) REFERENCES enterprise.support_agent_claims (
    tenant_id, id, support_session_id, agent_user_id
  ) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise.support_sessions
  DROP CONSTRAINT support_sessions_state_shape_check,
  ADD CONSTRAINT support_sessions_state_shape_check CHECK (
    (status = 'created' AND queued_at IS NULL AND started_at IS NULL AND
      handoff_requested_at IS NULL AND assigned_user_id IS NULL AND
      active_agent_claim_id IS NULL AND ended_at IS NULL) OR
    (status = 'waiting' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NULL AND handoff_requested_at IS NULL AND
      assigned_user_id IS NULL AND active_agent_claim_id IS NULL AND ended_at IS NULL) OR
    (status = 'ai_active' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND assigned_user_id IS NULL AND
      active_agent_claim_id IS NULL AND ended_at IS NULL) OR
    (status = 'handoff_requested' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND handoff_requested_at IS NOT NULL AND
      assigned_user_id IS NULL AND active_agent_claim_id IS NULL AND ended_at IS NULL) OR
    (status = 'human_active' AND queue_id IS NOT NULL AND queued_at IS NOT NULL AND
      started_at IS NOT NULL AND handoff_requested_at IS NOT NULL AND
      assigned_user_id IS NOT NULL AND active_agent_claim_id IS NOT NULL AND
      ended_at IS NULL) OR
    (status = 'ended' AND assigned_user_id IS NULL AND
      active_agent_claim_id IS NULL AND ended_at IS NOT NULL AND failure_code IS NULL) OR
    (status = 'failed' AND assigned_user_id IS NULL AND
      active_agent_claim_id IS NULL AND ended_at IS NOT NULL AND failure_code IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION enterprise.guard_support_agent_claim_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_status text;
DECLARE session_queue_id uuid;
DECLARE session_claim_id uuid;
DECLARE queue_status text;
DECLARE queue_claim_lease_seconds integer;
DECLARE member_status text;
DECLARE member_role text;
BEGIN
  SELECT status, queue_id, active_agent_claim_id
    INTO session_status, session_queue_id, session_claim_id
  FROM enterprise.support_sessions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.support_session_id;
  SELECT status, claim_lease_seconds
    INTO queue_status, queue_claim_lease_seconds
  FROM enterprise.support_queues
  WHERE tenant_id = NEW.tenant_id AND id = NEW.queue_id;
  SELECT status, role INTO member_status, member_role
  FROM enterprise.members
  WHERE tenant_id = NEW.tenant_id AND user_id = NEW.agent_user_id;
  IF NEW.status <> 'active' OR session_status IS DISTINCT FROM 'handoff_requested' OR
    session_queue_id IS DISTINCT FROM NEW.queue_id OR session_claim_id IS NOT NULL OR
    queue_status IS DISTINCT FROM 'active' OR member_status IS DISTINCT FROM 'active' OR
    member_role IS NULL OR
    member_role NOT IN ('owner', 'admin', 'support_manager', 'support_agent') OR
    NEW.lease_expires_at IS DISTINCT FROM NEW.claimed_at +
      make_interval(secs => queue_claim_lease_seconds) THEN
    RAISE EXCEPTION 'enterprise support agent claim binding is not eligible';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_support_agent_claim_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE queue_claim_lease_seconds integer;
BEGIN
  SELECT claim_lease_seconds INTO queue_claim_lease_seconds
  FROM enterprise.support_queues
  WHERE tenant_id = OLD.tenant_id AND id = OLD.queue_id;
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.support_session_id,
    NEW.queue_id, NEW.agent_user_id, NEW.idempotency_key, NEW.request_hash,
    NEW.reassigned_from_claim_id, NEW.claimed_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.support_session_id, OLD.queue_id,
    OLD.agent_user_id, OLD.idempotency_key, OLD.request_hash,
    OLD.reassigned_from_claim_id, OLD.claimed_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at OR
    OLD.status <> 'active' OR NOT (
      (NEW.status = 'active' AND NEW.lease_expires_at > OLD.lease_expires_at AND
        NEW.lease_expires_at IS NOT DISTINCT FROM
          GREATEST(OLD.lease_expires_at, NEW.updated_at) +
            make_interval(secs => queue_claim_lease_seconds) AND
        ROW(NEW.released_at, NEW.released_by, NEW.release_reason,
          NEW.release_idempotency_key, NEW.release_request_hash) IS NOT DISTINCT FROM
        ROW(OLD.released_at, OLD.released_by, OLD.release_reason,
          OLD.release_idempotency_key, OLD.release_request_hash)) OR
      (NEW.status IN ('released', 'reassigned', 'expired') AND
        NEW.lease_expires_at = OLD.lease_expires_at)
    ) THEN
    RAISE EXCEPTION 'invalid enterprise support agent claim mutation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER support_agent_claims_insert_guard BEFORE INSERT
  ON enterprise.support_agent_claims FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_agent_claim_insert();
CREATE TRIGGER support_agent_claims_mutation_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_agent_claims FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_agent_claim_mutation();

CREATE OR REPLACE FUNCTION enterprise.validate_support_agent_claim_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM enterprise.support_sessions
    WHERE tenant_id = NEW.tenant_id AND id = NEW.support_session_id AND
      status = 'human_active' AND active_agent_claim_id = NEW.id AND
      assigned_user_id = NEW.agent_user_id
  ) THEN
    RAISE EXCEPTION 'active support agent claim is not bound to its session';
  END IF;
  IF NEW.status <> 'active' AND EXISTS (
    SELECT 1 FROM enterprise.support_sessions
    WHERE tenant_id = NEW.tenant_id AND active_agent_claim_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'terminal support agent claim remains bound to a session';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.validate_support_session_active_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'human_active' AND NOT EXISTS (
    SELECT 1 FROM enterprise.support_agent_claims
    WHERE tenant_id = NEW.tenant_id AND id = NEW.active_agent_claim_id AND
      support_session_id = NEW.id AND agent_user_id = NEW.assigned_user_id AND
      status = 'active'
  ) THEN
    RAISE EXCEPTION 'human support session has no active agent claim';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER support_agent_claims_binding_guard
  AFTER INSERT OR UPDATE ON enterprise.support_agent_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enterprise.validate_support_agent_claim_binding();
CREATE CONSTRAINT TRIGGER support_sessions_active_claim_guard
  AFTER INSERT OR UPDATE ON enterprise.support_sessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enterprise.validate_support_session_active_claim();

CREATE OR REPLACE FUNCTION enterprise.guard_support_session_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.customer_id, NEW.channel_id,
    NEW.creation_key, NEW.creation_request_hash, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.customer_id, OLD.channel_id,
    OLD.creation_key, OLD.creation_request_hash, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR OLD.status IN ('ended', 'failed') OR NOT (
      (NEW.status = OLD.status AND
        NEW.active_agent_claim_id IS NOT DISTINCT FROM OLD.active_agent_claim_id) OR
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

ALTER TABLE enterprise.support_agent_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.support_agent_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise.support_agent_claims
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
