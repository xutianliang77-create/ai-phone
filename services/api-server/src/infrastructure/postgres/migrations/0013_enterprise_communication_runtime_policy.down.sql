ALTER TABLE enterprise.worker_dispatch_grants
  DROP CONSTRAINT IF EXISTS worker_dispatch_grants_policy_snapshot_fk,
  DROP CONSTRAINT IF EXISTS worker_dispatch_grants_policy_version_fk,
  DROP COLUMN IF EXISTS policy_snapshot_id,
  DROP COLUMN IF EXISTS policy_version;

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
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

ALTER TABLE enterprise.communication_session_bindings
  DROP CONSTRAINT IF EXISTS communication_bindings_policy_version_fk;
DROP TABLE IF EXISTS enterprise.communication_policy_snapshots;
DROP TABLE IF EXISTS enterprise.communication_authorization_evidence;
DROP TABLE IF EXISTS enterprise.communication_policy_versions;
DROP FUNCTION IF EXISTS enterprise.reject_communication_policy_snapshot_change();
DROP FUNCTION IF EXISTS enterprise.invalidate_communication_policy_snapshot();
DROP FUNCTION IF EXISTS enterprise.reject_communication_authorization_change();
DROP FUNCTION IF EXISTS enterprise.reject_communication_policy_version_change();
