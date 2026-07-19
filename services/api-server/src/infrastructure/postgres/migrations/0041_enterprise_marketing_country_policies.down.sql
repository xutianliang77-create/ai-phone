DROP TRIGGER IF EXISTS marketing_campaigns_country_policy_guard
  ON enterprise.marketing_campaigns;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_country_policy();

DROP TRIGGER IF EXISTS marketing_call_tasks_consent_guard
  ON enterprise.marketing_call_tasks;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_task_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_phone_hash text;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    (TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'valid automated marketing call consent required';
  END IF;
  SELECT lead.phone_hash INTO target_phone_hash
  FROM enterprise.marketing_leads lead
  WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id;
  IF target_phone_hash IS NULL THEN
    RAISE EXCEPTION 'valid automated marketing call consent required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':marketing-suppression:' || target_phone_hash, 0));
  IF EXISTS (
    SELECT 1 FROM enterprise.suppression_entries suppression
    WHERE suppression.tenant_id = NEW.tenant_id
      AND suppression.phone_hash = target_phone_hash
      AND suppression.scope IN ('tenant', 'global')
  ) THEN
    RAISE EXCEPTION 'enterprise marketing target is suppressed';
  END IF;
  IF NOT EXISTS (
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

CREATE TRIGGER marketing_call_tasks_consent_guard
BEFORE INSERT OR UPDATE OF tenant_id, campaign_id, lead_id, scheduled_at
ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_task_consent();

DROP INDEX IF EXISTS enterprise.marketing_call_tasks_tenant_lead_frequency_idx;
ALTER TABLE enterprise.marketing_call_tasks
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_country_policy_fk,
  DROP COLUMN IF EXISTS country_policy_version_id;

DROP TRIGGER IF EXISTS marketing_country_policy_versions_guard
  ON enterprise.marketing_country_policy_versions;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_country_policy_mutation();
DROP TABLE IF EXISTS enterprise.marketing_country_policy_versions;
