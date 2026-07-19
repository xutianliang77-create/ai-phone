ALTER TABLE enterprise.suppression_entries
  ADD COLUMN origin_campaign_id uuid,
  ADD COLUMN lead_id uuid,
  ADD COLUMN source_reference text,
  ADD COLUMN created_by text,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN version bigint,
  ADD COLUMN creation_key text,
  ADD COLUMN creation_request_hash text,
  ADD COLUMN cancelled_task_count integer,
  ADD CONSTRAINT suppression_entries_campaign_fk
    FOREIGN KEY (tenant_id, origin_campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id) NOT VALID,
  ADD CONSTRAINT suppression_entries_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id) NOT VALID,
  ADD CONSTRAINT suppression_entries_v2_shape_check CHECK (
    lead_id IS NULL OR (
      phone_hash ~ '^[a-f0-9]{64}$' AND
      scope IN ('tenant', 'global') AND
      char_length(reason) BETWEEN 1 AND 500 AND reason = btrim(reason) AND
      source IN ('manual', 'contact_request', 'consent_withdrawal',
        'complaint', 'global_registry') AND
      source_reference IS NOT NULL AND
      char_length(source_reference) BETWEEN 1 AND 200 AND
      source_reference = btrim(source_reference) AND
      created_by IS NOT NULL AND enterprise.is_actor_subject_id(created_by) AND
      updated_at IS NOT NULL AND version = 1 AND
      creation_key IS NOT NULL AND
      creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      creation_request_hash IS NOT NULL AND
      creation_request_hash ~ '^[a-f0-9]{64}$' AND
      cancelled_task_count IS NOT NULL AND cancelled_task_count >= 0 AND
      ((scope = 'tenant' AND origin_campaign_id IS NOT NULL AND
        enterprise.is_account_subject_id(created_by) AND source <> 'global_registry') OR
       (scope = 'global' AND origin_campaign_id IS NULL AND
        NOT enterprise.is_account_subject_id(created_by) AND source = 'global_registry'))
    )
  ) NOT VALID;

CREATE UNIQUE INDEX suppression_entries_tenant_creation_key_unique_idx
  ON enterprise.suppression_entries (tenant_id, created_by, creation_key)
  WHERE lead_id IS NOT NULL;
CREATE INDEX suppression_entries_tenant_phone_scope_idx
  ON enterprise.suppression_entries (tenant_id, phone_hash, scope, created_at, id)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_suppression_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cancelled_count integer;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'enterprise marketing suppression is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.lead_id IS NULL OR NEW.updated_at IS DISTINCT FROM NEW.created_at OR
    NEW.version <> 1 OR NEW.cancelled_task_count <> 0 OR
    NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_leads lead
      WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id
        AND lead.phone_hash = NEW.phone_hash
    ) OR (
      NEW.scope = 'tenant' AND NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_campaign_leads link
        WHERE link.tenant_id = NEW.tenant_id
          AND link.campaign_id = NEW.origin_campaign_id
          AND link.lead_id = NEW.lead_id AND link.status = 'active'
      )
    ) THEN
    RAISE EXCEPTION 'invalid enterprise marketing suppression creation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':marketing-suppression:' || NEW.phone_hash, 0));
  UPDATE enterprise.marketing_call_tasks task
  SET status = 'cancelled', outcome_code = 'suppressed',
      version = task.version + 1
  FROM enterprise.marketing_leads lead
  WHERE task.tenant_id = NEW.tenant_id
    AND lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
    AND lead.phone_hash = NEW.phone_hash
    AND task.status IN ('pending', 'scheduled', 'retry');
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  NEW.cancelled_task_count := cancelled_count;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suppression_entries_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.suppression_entries
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_suppression_mutation();

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
