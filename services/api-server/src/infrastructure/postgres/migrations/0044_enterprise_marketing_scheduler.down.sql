DROP TRIGGER IF EXISTS marketing_call_tasks_scheduler_guard
  ON enterprise.marketing_call_tasks;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_scheduler_task();

CREATE OR REPLACE FUNCTION enterprise.cancel_tasks_after_marketing_consent_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enterprise.marketing_call_tasks task
  SET status = 'cancelled', outcome_code = 'consent_revoked',
      version = task.version + 1
  WHERE task.tenant_id = NEW.tenant_id AND task.campaign_id = NEW.campaign_id
    AND task.lead_id = NEW.lead_id
    AND task.status IN ('pending', 'scheduled', 'retry')
    AND NOT EXISTS (
      SELECT 1 FROM enterprise.contact_consents consent
      WHERE consent.tenant_id = task.tenant_id
        AND consent.campaign_id = task.campaign_id
        AND consent.lead_id = task.lead_id
        AND consent.purpose = 'automated_marketing_call'
        AND consent.granted_at <= task.scheduled_at
        AND (consent.expires_at IS NULL OR consent.expires_at > task.scheduled_at)
        AND consent.revoked_at IS NULL
    );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_suppression_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cancelled_count integer;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'enterprise marketing suppression is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.lead_id IS NULL OR NEW.updated_at IS DISTINCT FROM NEW.created_at OR
    NEW.version <> 1 OR NEW.cancelled_task_count <> 0 OR NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_leads lead
      WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id
        AND lead.phone_hash = NEW.phone_hash) OR (NEW.scope = 'tenant' AND NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaign_leads link
      WHERE link.tenant_id = NEW.tenant_id AND link.campaign_id = NEW.origin_campaign_id
        AND link.lead_id = NEW.lead_id AND link.status = 'active')) THEN
    RAISE EXCEPTION 'invalid enterprise marketing suppression creation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':marketing-suppression:' || NEW.phone_hash, 0));
  UPDATE enterprise.marketing_call_tasks task
  SET status = 'cancelled', outcome_code = 'suppressed',
      version = task.version + 1
  FROM enterprise.marketing_leads lead
  WHERE task.tenant_id = NEW.tenant_id AND lead.tenant_id = task.tenant_id
    AND lead.id = task.lead_id AND lead.phone_hash = NEW.phone_hash
    AND task.status IN ('pending', 'scheduled', 'retry');
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  NEW.cancelled_task_count := cancelled_count;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS enterprise.marketing_call_tasks_tenant_lease_idx;
ALTER TABLE enterprise.marketing_call_tasks
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_usage_hold_fk,
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_dispatch_generation_check,
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_claim_token_hash_check,
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_claim_owner_check,
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_generated_by_check,
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_generation_hash_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS dispatch_generation,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS claim_token_hash,
  DROP COLUMN IF EXISTS claim_owner,
  DROP COLUMN IF EXISTS usage_hold_id,
  DROP COLUMN IF EXISTS generated_at,
  DROP COLUMN IF EXISTS generated_by,
  DROP COLUMN IF EXISTS generation_hash;
