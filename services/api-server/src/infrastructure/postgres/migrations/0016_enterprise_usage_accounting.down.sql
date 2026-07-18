DROP TRIGGER IF EXISTS enterprise_usage_period_aggregate_guard
  ON enterprise.usage_period_aggregates;
DROP TRIGGER IF EXISTS enterprise_usage_adjustment_append_only
  ON enterprise.usage_adjustments;
DROP TRIGGER IF EXISTS enterprise_usage_adjustment_valid
  ON enterprise.usage_adjustments;
DROP TRIGGER IF EXISTS enterprise_usage_event_append_only
  ON enterprise.tenant_usage_events;
DROP TRIGGER IF EXISTS enterprise_usage_event_ledger_consistent
  ON enterprise.tenant_usage_events;
DROP FUNCTION IF EXISTS enterprise.guard_usage_period_aggregate_change();
DROP FUNCTION IF EXISTS enterprise.reject_usage_adjustment_mutation();
DROP FUNCTION IF EXISTS enterprise.reject_usage_event_mutation();
DROP FUNCTION IF EXISTS enterprise.validate_usage_adjustment_insert();
DROP FUNCTION IF EXISTS enterprise.validate_usage_event_ledger_link();

DROP TABLE IF EXISTS enterprise.usage_period_aggregates;
DROP TABLE IF EXISTS enterprise.usage_adjustments;

DROP INDEX IF EXISTS enterprise.usage_ledger_event_unique_idx;
ALTER TABLE enterprise.usage_ledger
  DROP CONSTRAINT IF EXISTS usage_ledger_event_fk,
  DROP COLUMN IF EXISTS usage_event_id;

DROP TABLE IF EXISTS enterprise.tenant_usage_events;
