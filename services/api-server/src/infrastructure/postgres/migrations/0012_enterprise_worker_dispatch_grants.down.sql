DROP TRIGGER IF EXISTS worker_dispatch_grant_identity_immutable
  ON enterprise.worker_dispatch_grants;
DROP FUNCTION IF EXISTS enterprise.reject_worker_dispatch_grant_identity_change();
DROP TABLE IF EXISTS enterprise.worker_dispatch_grants;

ALTER TABLE ai_phone.worker_capacity_reservations
  DROP CONSTRAINT IF EXISTS worker_capacity_reservations_scope_key;
