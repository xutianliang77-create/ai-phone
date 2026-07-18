DROP TRIGGER IF EXISTS enterprise_billing_plan_version_immutable
  ON enterprise.billing_plan_versions;
DROP TRIGGER IF EXISTS enterprise_subscription_immutable
  ON enterprise.subscriptions;
DROP TRIGGER IF EXISTS enterprise_entitlement_snapshot_immutable
  ON enterprise.entitlement_snapshots;
DROP TRIGGER IF EXISTS enterprise_billing_subscription_change_append_only
  ON enterprise.billing_subscription_changes;
DROP FUNCTION IF EXISTS enterprise.reject_billing_plan_version_change();
DROP FUNCTION IF EXISTS enterprise.reject_subscription_change();
DROP FUNCTION IF EXISTS enterprise.reject_entitlement_snapshot_change();
DROP FUNCTION IF EXISTS enterprise.reject_billing_change_mutation();

ALTER TABLE enterprise.worker_dispatch_grants
  DROP CONSTRAINT IF EXISTS worker_dispatch_grants_entitlement_version_fk,
  DROP CONSTRAINT IF EXISTS worker_dispatch_grants_billing_account_fk,
  DROP COLUMN IF EXISTS entitlement_version,
  DROP COLUMN IF EXISTS billing_account_id;

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.policy_snapshot_id,
    NEW.policy_version, NEW.idempotency_key, NEW.request_hash,
    NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.policy_snapshot_id,
    OLD.policy_version, OLD.idempotency_key, OLD.request_hash,
    OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE enterprise.usage_ledger
  DROP CONSTRAINT IF EXISTS usage_ledger_billing_account_fk,
  DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE enterprise.usage_holds
  DROP CONSTRAINT IF EXISTS usage_holds_billing_account_fk,
  DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE enterprise.usage_budgets
  DROP CONSTRAINT IF EXISTS usage_budgets_billing_account_fk,
  DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE enterprise.communication_session_bindings
  DROP CONSTRAINT IF EXISTS communication_bindings_entitlement_version_fk;

ALTER TABLE enterprise.entitlements
  DROP CONSTRAINT IF EXISTS entitlements_snapshot_version_fk;

DROP TABLE IF EXISTS enterprise.billing_subscription_changes;
DROP TABLE IF EXISTS enterprise.entitlement_snapshots;

ALTER TABLE enterprise.entitlements
  DROP CONSTRAINT IF EXISTS entitlements_billing_account_fk,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS entitlement_version,
  DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE enterprise.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_version_fk,
  DROP CONSTRAINT IF EXISTS subscriptions_billing_account_fk,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS plan_version,
  DROP COLUMN IF EXISTS billing_account_id;
DROP INDEX IF EXISTS enterprise.subscriptions_one_active_account_idx;

DROP TABLE IF EXISTS enterprise.billing_plan_versions;
DROP TABLE IF EXISTS enterprise.billing_accounts;
