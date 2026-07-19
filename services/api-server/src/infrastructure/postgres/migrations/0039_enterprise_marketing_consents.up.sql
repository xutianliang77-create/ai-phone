ALTER TABLE enterprise.contact_consents
  ADD COLUMN campaign_id uuid,
  ADD COLUMN evidence_sha256 text,
  ADD COLUMN evidence_size_bytes bigint,
  ADD COLUMN evidence_content_type text,
  ADD COLUMN source_reference text,
  ADD COLUMN created_by text,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN version bigint,
  ADD COLUMN creation_key text,
  ADD COLUMN creation_request_hash text,
  ADD COLUMN revoked_by text,
  ADD COLUMN revocation_reason text,
  ADD COLUMN revocation_key text,
  ADD COLUMN revocation_request_hash text,
  ADD CONSTRAINT contact_consents_campaign_fk
    FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id) NOT VALID,
  ADD CONSTRAINT contact_consents_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES enterprise.members (tenant_id, user_id) NOT VALID,
  ADD CONSTRAINT contact_consents_revoked_by_fk
    FOREIGN KEY (tenant_id, revoked_by)
    REFERENCES enterprise.members (tenant_id, user_id) NOT VALID,
  ADD CONSTRAINT contact_consents_v2_shape_check CHECK (
    campaign_id IS NULL OR (
      purpose = 'automated_marketing_call' AND
      channel IN ('web_form', 'signed_document', 'recorded_call', 'crm_attestation') AND
      evidence_sha256 IS NOT NULL AND
      evidence_sha256 ~ '^[a-f0-9]{64}$' AND
      evidence_size_bytes IS NOT NULL AND
      evidence_size_bytes BETWEEN 1 AND 26214400 AND
      evidence_content_type IS NOT NULL AND
      evidence_content_type IN ('application/pdf', 'image/jpeg', 'image/png',
        'audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/json', 'text/plain') AND
      source_reference IS NOT NULL AND
      char_length(source_reference) BETWEEN 1 AND 200 AND
      source_reference = btrim(source_reference) AND
      char_length(policy_version) BETWEEN 1 AND 160 AND
      policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      created_by IS NOT NULL AND enterprise.is_account_subject_id(created_by) AND
      created_at IS NOT NULL AND updated_at IS NOT NULL AND
      granted_at <= created_at AND (expires_at IS NULL OR expires_at > granted_at) AND
      version IS NOT NULL AND version >= 1 AND creation_key IS NOT NULL AND
      creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      creation_request_hash IS NOT NULL AND
      creation_request_hash ~ '^[a-f0-9]{64}$' AND
      ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL AND
        revocation_key IS NULL AND revocation_request_hash IS NULL) OR
       (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND
        enterprise.is_account_subject_id(revoked_by) AND
        char_length(revocation_reason) BETWEEN 1 AND 500 AND
        revocation_reason = btrim(revocation_reason) AND
        revocation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
        revocation_request_hash ~ '^[a-f0-9]{64}$'))
    )
  ) NOT VALID;

CREATE UNIQUE INDEX contact_consents_tenant_evidence_unique_idx
  ON enterprise.contact_consents (tenant_id, evidence_object_id)
  WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX contact_consents_tenant_creation_key_unique_idx
  ON enterprise.contact_consents (tenant_id, created_by, creation_key)
  WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX contact_consents_tenant_revocation_key_unique_idx
  ON enterprise.contact_consents (tenant_id, revoked_by, revocation_key)
  WHERE revocation_key IS NOT NULL;
CREATE INDEX contact_consents_campaign_lead_validity_idx
  ON enterprise.contact_consents (
    tenant_id, campaign_id, lead_id, purpose, revoked_at, expires_at, granted_at, id
  ) WHERE campaign_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing consent cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.campaign_id IS NULL OR
      NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.purpose <> 'automated_marketing_call' OR NEW.revoked_at IS NOT NULL OR
      NEW.revoked_by IS NOT NULL OR NEW.revocation_reason IS NOT NULL OR
      NEW.revocation_key IS NOT NULL OR NEW.revocation_request_hash IS NOT NULL OR
      NEW.version <> 1 OR NEW.created_at IS DISTINCT FROM NEW.updated_at OR
      NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_campaigns campaign
        JOIN enterprise.marketing_campaign_leads link
          ON link.tenant_id = campaign.tenant_id AND link.campaign_id = campaign.id
        JOIN enterprise.marketing_leads lead
          ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
        WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
          AND campaign.status = 'draft' AND campaign.approval_status = 'not_submitted'
          AND link.lead_id = NEW.lead_id AND link.status = 'active'
          AND lead.status = 'active'
      ) THEN
      RAISE EXCEPTION 'invalid enterprise marketing consent creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.lead_id, NEW.purpose,
    NEW.channel, NEW.evidence_object_id, NEW.evidence_sha256,
    NEW.evidence_size_bytes, NEW.evidence_content_type, NEW.source_reference,
    NEW.granted_at, NEW.expires_at, NEW.policy_version, NEW.created_by,
    NEW.created_at, NEW.creation_key, NEW.creation_request_hash) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.lead_id, OLD.purpose,
    OLD.channel, OLD.evidence_object_id, OLD.evidence_sha256,
    OLD.evidence_size_bytes, OLD.evidence_content_type, OLD.source_reference,
    OLD.granted_at, OLD.expires_at, OLD.policy_version, OLD.created_by,
    OLD.created_at, OLD.creation_key, OLD.creation_request_hash) OR
    OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
    NEW.revoked_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.revoked_at < NEW.granted_at OR NEW.revoked_at < NEW.created_at OR
    NEW.updated_at <= OLD.updated_at OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'enterprise marketing consent is immutable except revocation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contact_consents_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.contact_consents
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_consent_mutation();

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

CREATE TRIGGER marketing_call_tasks_consent_guard
BEFORE INSERT OR UPDATE OF tenant_id, campaign_id, lead_id, scheduled_at
ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_task_consent();

CREATE OR REPLACE FUNCTION enterprise.cancel_tasks_after_marketing_consent_revocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

CREATE TRIGGER contact_consents_cancel_tasks_after_revocation
AFTER UPDATE OF revoked_at ON enterprise.contact_consents
FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION enterprise.cancel_tasks_after_marketing_consent_revocation();
