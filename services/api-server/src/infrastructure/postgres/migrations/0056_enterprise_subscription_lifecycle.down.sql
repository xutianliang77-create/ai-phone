DROP TRIGGER IF EXISTS enterprise_billing_lifecycle_pending_work
  ON enterprise.billing_lifecycle_commands;
DROP FUNCTION IF EXISTS enterprise.sync_billing_lifecycle_pending_work();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.subscriptions
    WHERE status NOT IN ('active', 'superseded')
  ) THEN
    RAISE EXCEPTION 'subscription lifecycle state must be remediated before rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM enterprise.billing_lifecycle_commands
    WHERE status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'active billing lifecycle commands block rollback';
  END IF;
END
$$;

ALTER TABLE enterprise.platform_pending_work DISABLE ROW LEVEL SECURITY;
DELETE FROM enterprise.platform_pending_work WHERE work_kind = 'billing_lifecycle';
ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT IF EXISTS platform_pending_work_work_kind_check,
  DROP CONSTRAINT IF EXISTS platform_pending_work_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN (
      'tenant_lifecycle', 'outbox', 'audit_export', 'screen_share',
      'data_lifecycle'
    )
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind IN ('outbox', 'screen_share', 'data_lifecycle')
      AND actor_id IS NULL)
  );

DROP TRIGGER IF EXISTS billing_account_lifecycle_guard
  ON enterprise.billing_accounts;
DROP FUNCTION IF EXISTS enterprise.guard_billing_account_lifecycle();

CREATE OR REPLACE FUNCTION enterprise.reject_subscription_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'active' AND NEW.status = 'superseded'
    AND NEW.updated_at >= OLD.updated_at
    AND NEW.version = OLD.version + 1
    AND (NEW.id, NEW.tenant_id, NEW.billing_account_id,
      NEW.plan_code, NEW.plan_version, NEW.seats, NEW.billing_cycle,
      NEW.current_period_start, NEW.current_period_end, NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.billing_account_id,
      OLD.plan_code, OLD.plan_version, OLD.seats, OLD.billing_cycle,
      OLD.current_period_start, OLD.current_period_end, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise subscription is immutable';
END;
$$;

DROP TRIGGER IF EXISTS billing_lifecycle_command_guard
  ON enterprise.billing_lifecycle_commands;
DROP FUNCTION IF EXISTS enterprise.guard_billing_lifecycle_command();
DROP TRIGGER IF EXISTS billing_lifecycle_decision_append_only
  ON enterprise.billing_lifecycle_decisions;
DROP FUNCTION IF EXISTS enterprise.reject_billing_lifecycle_decision_mutation();
DROP TRIGGER IF EXISTS billing_provider_event_append_only
  ON enterprise.billing_provider_events;
DROP FUNCTION IF EXISTS enterprise.reject_billing_provider_event_mutation();
DROP TABLE IF EXISTS enterprise.billing_lifecycle_decisions;
DROP TABLE IF EXISTS enterprise.billing_lifecycle_commands;
DROP TABLE IF EXISTS enterprise.billing_provider_events;
ALTER TABLE enterprise.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_lifecycle_status_check;
