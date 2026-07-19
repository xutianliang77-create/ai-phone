DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.contact_consents WHERE campaign_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'cannot roll back enterprise marketing consent evidence';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS contact_consents_cancel_tasks_after_revocation
  ON enterprise.contact_consents;
DROP TRIGGER IF EXISTS marketing_call_tasks_consent_guard
  ON enterprise.marketing_call_tasks;
DROP TRIGGER IF EXISTS contact_consents_guard ON enterprise.contact_consents;

DROP FUNCTION IF EXISTS enterprise.cancel_tasks_after_marketing_consent_revocation();
DROP FUNCTION IF EXISTS enterprise.guard_marketing_task_consent();
DROP FUNCTION IF EXISTS enterprise.guard_marketing_consent_mutation();

DROP INDEX IF EXISTS enterprise.contact_consents_campaign_lead_validity_idx;
DROP INDEX IF EXISTS enterprise.contact_consents_tenant_revocation_key_unique_idx;
DROP INDEX IF EXISTS enterprise.contact_consents_tenant_creation_key_unique_idx;
DROP INDEX IF EXISTS enterprise.contact_consents_tenant_evidence_unique_idx;

ALTER TABLE enterprise.contact_consents
  DROP CONSTRAINT IF EXISTS contact_consents_v2_shape_check,
  DROP CONSTRAINT IF EXISTS contact_consents_revoked_by_fk,
  DROP CONSTRAINT IF EXISTS contact_consents_created_by_fk,
  DROP CONSTRAINT IF EXISTS contact_consents_campaign_fk,
  DROP COLUMN IF EXISTS revocation_request_hash,
  DROP COLUMN IF EXISTS revocation_key,
  DROP COLUMN IF EXISTS revocation_reason,
  DROP COLUMN IF EXISTS revoked_by,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_key,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS source_reference,
  DROP COLUMN IF EXISTS evidence_content_type,
  DROP COLUMN IF EXISTS evidence_size_bytes,
  DROP COLUMN IF EXISTS evidence_sha256,
  DROP COLUMN IF EXISTS campaign_id;
