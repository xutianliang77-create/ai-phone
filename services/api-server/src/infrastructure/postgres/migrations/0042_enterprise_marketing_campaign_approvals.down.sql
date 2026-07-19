DROP FUNCTION IF EXISTS enterprise.marketing_campaign_approval_is_current(uuid, uuid);
ALTER TABLE enterprise.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_approval_snapshot_fk,
  DROP COLUMN IF EXISTS approval_snapshot_id;
DROP TRIGGER IF EXISTS marketing_campaign_decisions_guard
  ON enterprise.marketing_campaign_approval_decisions;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_decision();
DROP TRIGGER IF EXISTS marketing_campaign_validations_verify
  ON enterprise.marketing_campaign_validation_snapshots;
DROP FUNCTION IF EXISTS enterprise.verify_marketing_campaign_validation();
DROP TRIGGER IF EXISTS marketing_campaign_validations_guard
  ON enterprise.marketing_campaign_validation_snapshots;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_validation();
DROP FUNCTION IF EXISTS enterprise.marketing_campaign_validation_matches(uuid);
DROP FUNCTION IF EXISTS enterprise.marketing_iso(timestamptz);
DROP TABLE IF EXISTS enterprise.marketing_campaign_approval_decisions;
DROP TABLE IF EXISTS enterprise.marketing_campaign_validation_snapshots;
