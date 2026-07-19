DROP TRIGGER IF EXISTS marketing_lead_import_rows_append_only
  ON enterprise.marketing_lead_import_rows;
DROP TRIGGER IF EXISTS marketing_campaign_leads_guard
  ON enterprise.marketing_campaign_leads;
DROP TRIGGER IF EXISTS marketing_leads_guard
  ON enterprise.marketing_leads;
DROP TRIGGER IF EXISTS marketing_lead_import_batches_guard
  ON enterprise.marketing_lead_import_batches;

DROP FUNCTION IF EXISTS enterprise.reject_marketing_lead_import_row_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_lead_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_marketing_lead_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_marketing_lead_import_batch_mutation();

DROP TABLE IF EXISTS enterprise.marketing_lead_import_rows;
DROP TABLE IF EXISTS enterprise.marketing_campaign_leads;

DROP INDEX IF EXISTS enterprise.marketing_leads_tenant_phone_hash_unique_idx;
ALTER TABLE enterprise.marketing_leads
  DROP CONSTRAINT IF EXISTS marketing_leads_created_by_batch_fk,
  DROP CONSTRAINT IF EXISTS marketing_leads_timestamps_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_phone_hint_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_phone_cipher_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_attributes_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_status_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_country_code_check,
  DROP CONSTRAINT IF EXISTS marketing_leads_phone_hash_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS created_by_batch_id,
  DROP COLUMN IF EXISTS phone_hint,
  DROP COLUMN IF EXISTS phone_input_encrypted;

DROP TABLE IF EXISTS enterprise.marketing_lead_import_batches;
