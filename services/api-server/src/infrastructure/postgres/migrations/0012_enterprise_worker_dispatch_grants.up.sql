ALTER TABLE ai_phone.worker_capacity_reservations
  ADD CONSTRAINT worker_capacity_reservations_scope_key
  UNIQUE (scope_type, scope_id, id);

CREATE TABLE enterprise.worker_dispatch_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  communication_session_id text NOT NULL,
  dispatch_id text NOT NULL,
  capacity_reservation_id text NOT NULL,
  scope_type text GENERATED ALWAYS AS ('tenant'::text) STORED,
  scope_id text GENERATED ALWAYS AS (tenant_id::text) STORED,
  capability text NOT NULL CHECK (
    capability IN ('translation_runtime', 'voice_agent_runtime')
  ),
  cell_id text NOT NULL CHECK (length(cell_id) BETWEEN 2 AND 64),
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  generation bigint NOT NULL CHECK (generation > 0),
  status text NOT NULL CHECK (
    status IN ('issued', 'accepted', 'cancelled', 'completed', 'failed')
  ),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  accepted_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, communication_session_id, capability, generation),
  FOREIGN KEY (tenant_id, communication_session_id)
    REFERENCES enterprise.communication_session_bindings (
      tenant_id, communication_session_id
    ) ON DELETE CASCADE,
  FOREIGN KEY (scope_type, scope_id, dispatch_id)
    REFERENCES ai_phone.worker_dispatches (scope_type, scope_id, id),
  FOREIGN KEY (scope_type, scope_id, capacity_reservation_id)
    REFERENCES ai_phone.worker_capacity_reservations (scope_type, scope_id, id),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CHECK (lease_expires_at IS NULL OR lease_expires_at <= expires_at),
  CHECK (
    (status = 'issued' AND lease_owner IS NULL AND accepted_at IS NULL)
    OR (status <> 'issued')
  ),
  CHECK (
    (status IN ('cancelled', 'completed', 'failed') AND ended_at IS NOT NULL)
    OR (status IN ('issued', 'accepted') AND ended_at IS NULL)
  )
);

CREATE INDEX worker_dispatch_grants_recovery_idx
  ON enterprise.worker_dispatch_grants (
    tenant_id, cell_id, status, lease_expires_at, expires_at, id
  ) WHERE status IN ('issued', 'accepted');

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.idempotency_key,
    NEW.request_hash, NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.idempotency_key,
    OLD.request_hash, OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER worker_dispatch_grant_identity_immutable
BEFORE UPDATE ON enterprise.worker_dispatch_grants
FOR EACH ROW
EXECUTE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change();

ALTER TABLE enterprise.worker_dispatch_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.worker_dispatch_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_dispatch_grants_tenant_isolation
  ON enterprise.worker_dispatch_grants
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
