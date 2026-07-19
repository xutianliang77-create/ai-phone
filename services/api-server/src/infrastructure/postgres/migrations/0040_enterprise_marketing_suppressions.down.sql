DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.suppression_entries WHERE lead_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cannot roll back enterprise marketing suppression evidence';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS suppression_entries_guard
  ON enterprise.suppression_entries;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_suppression_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_task_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    (TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) OR
    NOT EXISTS (
      SELECT 1 FROM enterprise.contact_consents consent
      JOIN enterprise.marketing_campaign_leads link
        ON link.tenant_id = consent.tenant_id
        AND link.campaign_id = consent.campaign_id
        AND link.lead_id = consent.lead_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
      WHERE consent.tenant_id = NEW.tenant_id
        AND consent.campaign_id = NEW.campaign_id
        AND consent.lead_id = NEW.lead_id
        AND consent.purpose = 'automated_marketing_call'
        AND consent.granted_at <= NEW.scheduled_at
        AND (consent.expires_at IS NULL OR consent.expires_at > NEW.scheduled_at)
        AND consent.revoked_at IS NULL
        AND link.status = 'active' AND lead.status = 'active'
    ) THEN
    RAISE EXCEPTION 'valid automated marketing call consent required';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS enterprise.suppression_entries_tenant_phone_scope_idx;
DROP INDEX IF EXISTS enterprise.suppression_entries_tenant_creation_key_unique_idx;

ALTER TABLE enterprise.suppression_entries
  DROP CONSTRAINT IF EXISTS suppression_entries_v2_shape_check,
  DROP CONSTRAINT IF EXISTS suppression_entries_lead_fk,
  DROP CONSTRAINT IF EXISTS suppression_entries_campaign_fk,
  DROP COLUMN IF EXISTS cancelled_task_count,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_key,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS source_reference,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS origin_campaign_id;
