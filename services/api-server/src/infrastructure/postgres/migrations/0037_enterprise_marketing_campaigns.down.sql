DROP TRIGGER IF EXISTS marketing_campaigns_guard
  ON enterprise.marketing_campaigns;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_mutation();
DROP INDEX IF EXISTS enterprise.marketing_campaigns_tenant_creation_key_unique_idx;

ALTER TABLE enterprise.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_owner_member_fk,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_schedule_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_approval_status_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_status_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_language_codes_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_country_codes_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_objective_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_name_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_creation_hash_check,
  DROP CONSTRAINT IF EXISTS marketing_campaigns_creation_key_check,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_key;
