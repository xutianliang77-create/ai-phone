DROP TRIGGER IF EXISTS enterprise_usage_ledger_append_only
  ON enterprise.usage_ledger;
DROP TRIGGER IF EXISTS enterprise_usage_budget_alert_append_only
  ON enterprise.usage_budget_alerts;
DROP TRIGGER IF EXISTS enterprise_usage_hold_identity_immutable
  ON enterprise.usage_holds;
DROP FUNCTION IF EXISTS enterprise.reject_usage_ledger_mutation();
DROP FUNCTION IF EXISTS enterprise.reject_usage_budget_alert_mutation();
DROP FUNCTION IF EXISTS enterprise.reject_usage_hold_identity_change();

ALTER TABLE enterprise.usage_ledger
  DROP CONSTRAINT IF EXISTS usage_ledger_hold_fk,
  DROP CONSTRAINT IF EXISTS usage_ledger_budget_fk,
  DROP CONSTRAINT IF EXISTS usage_ledger_request_hash_format,
  DROP COLUMN IF EXISTS recorded_at,
  DROP COLUMN IF EXISTS request_hash,
  DROP COLUMN IF EXISTS source_ref,
  DROP COLUMN IF EXISTS hold_id,
  DROP COLUMN IF EXISTS budget_id,
  DROP COLUMN IF EXISTS entry_type;

DROP TABLE IF EXISTS enterprise.usage_budget_alerts;
DROP TABLE IF EXISTS enterprise.usage_holds;
DROP TABLE IF EXISTS enterprise.usage_budgets;
