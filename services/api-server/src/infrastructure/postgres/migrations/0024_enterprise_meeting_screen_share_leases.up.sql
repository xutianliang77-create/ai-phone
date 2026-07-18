ALTER TABLE enterprise.tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.communication_session_bindings DISABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_screen_shares DISABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work DISABLE ROW LEVEL SECURITY;

ALTER TABLE enterprise.communication_session_bindings
  ADD CONSTRAINT communication_bindings_meeting_session_key
    UNIQUE (tenant_id, meeting_id, communication_session_id);

ALTER TABLE enterprise.meeting_participants
  ADD CONSTRAINT meeting_participants_scope_key
    UNIQUE (tenant_id, meeting_id, id);

ALTER TABLE enterprise.meeting_screen_shares
  ADD COLUMN communication_session_id text,
  ADD COLUMN route_epoch bigint,
  ADD COLUMN generation bigint NOT NULL DEFAULT 1,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz;

UPDATE enterprise.meeting_screen_shares share
SET communication_session_id = binding.communication_session_id,
  route_epoch = binding.route_epoch
FROM enterprise.communication_session_bindings binding
WHERE binding.tenant_id = share.tenant_id
  AND binding.kind = 'meeting'
  AND binding.meeting_id = share.meeting_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.meeting_screen_shares
    WHERE communication_session_id IS NULL OR route_epoch IS NULL
  ) THEN
    RAISE EXCEPTION 'meeting screen share has no communication binding';
  END IF;
END
$$;

UPDATE enterprise.meeting_screen_shares
SET source_type = CASE
    WHEN source_type IN ('screen', 'window', 'tab') THEN source_type
    ELSE 'screen'
  END,
  quality_mode = CASE
    WHEN quality_mode IN ('auto', 'smooth', 'high') THEN quality_mode
    ELSE 'auto'
  END,
  track_sid = CASE
    WHEN track_sid ~ '^[A-Za-z0-9_-]{1,128}$' THEN track_sid
    ELSE NULL
  END,
  status = CASE
    WHEN status IN ('active', 'paused') AND
      lease_expires_at IS NOT NULL AND lease_expires_at > now() THEN status
    WHEN status IN ('active', 'paused') THEN 'expired'
    WHEN status IN ('ended', 'expired') THEN status
    ELSE 'ended'
  END,
  idempotency_key = 'legacy:' || id::text,
  request_hash = md5(id::text) || md5(id::text),
  started_at = COALESCE(started_at, paused_at, ended_at, now()),
  ended_at = CASE
    WHEN status IN ('active', 'paused') AND
      lease_expires_at IS NOT NULL AND lease_expires_at > now() THEN NULL
    ELSE COALESCE(ended_at, now())
  END,
  paused_at = CASE WHEN status = 'paused' THEN COALESCE(paused_at, now()) ELSE NULL END,
  lease_expires_at = CASE
    WHEN status IN ('active', 'paused') AND
      lease_expires_at IS NOT NULL AND lease_expires_at > now()
      THEN lease_expires_at
    ELSE NULL
  END,
  created_at = COALESCE(started_at, paused_at, ended_at, now()),
  updated_at = COALESCE(ended_at, paused_at, started_at, now());

ALTER TABLE enterprise.meeting_screen_shares
  ALTER COLUMN communication_session_id SET NOT NULL,
  ALTER COLUMN route_epoch SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT meeting_screen_shares_scope_key
    UNIQUE (tenant_id, meeting_id, id),
  ADD CONSTRAINT meeting_screen_shares_acquire_key
    UNIQUE (tenant_id, meeting_id, idempotency_key),
  ADD CONSTRAINT meeting_screen_shares_binding_fk
    FOREIGN KEY (tenant_id, meeting_id, communication_session_id)
    REFERENCES enterprise.communication_session_bindings (
      tenant_id, meeting_id, communication_session_id
    ),
  ADD CONSTRAINT meeting_screen_shares_participant_meeting_fk
    FOREIGN KEY (tenant_id, meeting_id, participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  ADD CONSTRAINT meeting_screen_shares_source_check
    CHECK (source_type IN ('screen', 'window', 'tab')),
  ADD CONSTRAINT meeting_screen_shares_quality_check
    CHECK (quality_mode IN ('auto', 'smooth', 'high')),
  ADD CONSTRAINT meeting_screen_shares_status_check
    CHECK (status IN ('active', 'paused', 'ended', 'expired')),
  ADD CONSTRAINT meeting_screen_shares_generation_check
    CHECK (generation > 0),
  ADD CONSTRAINT meeting_screen_shares_route_epoch_check
    CHECK (route_epoch > 0),
  ADD CONSTRAINT meeting_screen_shares_track_sid_check
    CHECK (track_sid IS NULL OR track_sid ~ '^[A-Za-z0-9_-]{1,128}$'),
  ADD CONSTRAINT meeting_screen_shares_idempotency_key_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  ADD CONSTRAINT meeting_screen_shares_request_hash_check
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT meeting_screen_shares_lifecycle_check CHECK (
    (status IN ('active', 'paused') AND lease_expires_at IS NOT NULL
      AND ended_at IS NULL)
    OR
    (status IN ('ended', 'expired') AND lease_expires_at IS NULL
      AND ended_at IS NOT NULL)
  ),
  ADD CONSTRAINT meeting_screen_shares_time_check CHECK (
    started_at >= created_at AND updated_at >= created_at AND
    (paused_at IS NULL OR paused_at >= started_at) AND
    (ended_at IS NULL OR ended_at >= started_at)
  );

CREATE INDEX meeting_screen_shares_recovery_idx
  ON enterprise.meeting_screen_shares (
    tenant_id, status, lease_expires_at, meeting_id, id
  ) WHERE status IN ('active', 'paused');

CREATE TABLE enterprise.meeting_screen_share_commands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  share_id uuid NOT NULL,
  command text NOT NULL CHECK (
    command IN ('acquire', 'pause', 'resume', 'renew', 'stop')
  ),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  result_status text NOT NULL CHECK (
    result_status IN ('active', 'paused', 'ended', 'expired')
  ),
  result_version bigint NOT NULL CHECK (result_version > 0),
  result_generation bigint NOT NULL CHECK (result_generation > 0),
  revoked_generation bigint CHECK (revoked_generation > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, idempotency_key),
  FOREIGN KEY (tenant_id, meeting_id, share_id)
    REFERENCES enterprise.meeting_screen_shares (tenant_id, meeting_id, id)
);

CREATE INDEX meeting_screen_share_commands_share_idx
  ON enterprise.meeting_screen_share_commands (
    tenant_id, meeting_id, share_id, created_at, id
  );

CREATE OR REPLACE FUNCTION enterprise.reject_meeting_screen_share_command_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise meeting screen share commands are append-only';
END;
$$;

CREATE TRIGGER meeting_screen_share_commands_append_only
BEFORE UPDATE OR DELETE ON enterprise.meeting_screen_share_commands
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_screen_share_command_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_meeting_screen_share_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.meeting_id, NEW.participant_id,
    NEW.communication_session_id, NEW.route_epoch, NEW.source_type,
    NEW.includes_system_audio, NEW.quality_mode, NEW.idempotency_key,
    NEW.request_hash, NEW.created_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.meeting_id, OLD.participant_id,
    OLD.communication_session_id, OLD.route_epoch, OLD.source_type,
    OLD.includes_system_audio, OLD.quality_mode, OLD.idempotency_key,
    OLD.request_hash, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'enterprise meeting screen share identity is immutable';
  END IF;
  IF NEW.generation < OLD.generation OR NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'enterprise meeting screen share fence must advance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_screen_share_identity_immutable
BEFORE UPDATE ON enterprise.meeting_screen_shares
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_screen_share_identity_change();

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_work_kind_check,
  DROP CONSTRAINT platform_pending_work_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox', 'audit_export', 'screen_share')
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind IN ('outbox', 'screen_share') AND actor_id IS NULL)
  );

INSERT INTO enterprise.platform_pending_work(
  cell_id, tenant_id, work_kind, resource_id, actor_id,
  due_at, lease_expires_at
)
SELECT tenant.cell_id, share.tenant_id, 'screen_share', share.meeting_id, NULL,
  share.lease_expires_at, NULL
FROM enterprise.meeting_screen_shares share
JOIN enterprise.tenants tenant ON tenant.id = share.tenant_id
WHERE share.status IN ('active', 'paused')
ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
  cell_id = excluded.cell_id,
  actor_id = NULL,
  due_at = excluded.due_at,
  lease_expires_at = NULL;

CREATE OR REPLACE FUNCTION enterprise.sync_meeting_screen_share_pending_work()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id AND work_kind = 'screen_share'
      AND resource_id = OLD.meeting_id;
    RETURN OLD;
  END IF;
  IF NEW.status IN ('active', 'paused') THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    )
    SELECT tenant.cell_id, NEW.tenant_id, 'screen_share', NEW.meeting_id, NULL,
      NEW.lease_expires_at, NULL
    FROM enterprise.tenants tenant WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id,
      actor_id = NULL,
      due_at = excluded.due_at,
      lease_expires_at = NULL;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id AND work_kind = 'screen_share'
      AND resource_id = NEW.meeting_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_screen_share_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.meeting_screen_shares
FOR EACH ROW EXECUTE FUNCTION enterprise.sync_meeting_screen_share_pending_work();

ALTER TABLE enterprise.meeting_screen_share_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_screen_share_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_screen_share_commands_tenant_isolation
  ON enterprise.meeting_screen_share_commands
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

ALTER TABLE enterprise.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.communication_session_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.communication_session_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_screen_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_screen_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;
