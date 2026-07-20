CREATE TABLE enterprise.marketing_crm_syncs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  outcome_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'salesforce'),
  status text NOT NULL CHECK (status IN ('pending', 'synced', 'failed')),
  external_record_key text NOT NULL CHECK (
    external_record_key ~ '^wujie_[a-f0-9]{48}$'
  ),
  object_api_name text NOT NULL CHECK (
    object_api_name ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  provider_fingerprint text NOT NULL CHECK (
    provider_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  outbox_event_id uuid NOT NULL,
  provider_record_id text CHECK (
    provider_record_id IS NULL OR provider_record_id ~ '^[A-Za-z0-9]{15,18}$'
  ),
  provider_record_url text CHECK (
    provider_record_url IS NULL OR
    (length(provider_record_url) BETWEEN 9 AND 2048 AND
      provider_record_url ~ '^https://')
  ),
  provider_response_hash text CHECK (
    provider_response_hash IS NULL OR provider_response_hash ~ '^[a-f0-9]{64}$'
  ),
  attempts integer NOT NULL CHECK (attempts >= 0),
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  synced_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, outcome_id),
  UNIQUE (tenant_id, provider, external_record_key),
  UNIQUE (tenant_id, created_by, idempotency_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, outcome_id)
    REFERENCES enterprise.marketing_outcomes (tenant_id, id),
  FOREIGN KEY (tenant_id, outbox_event_id)
    REFERENCES enterprise.outbox_events (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (updated_at >= created_at),
  CHECK (synced_at IS NULL OR synced_at >= created_at),
  CHECK (
    (status = 'pending' AND provider_record_id IS NULL AND
      provider_record_url IS NULL AND provider_response_hash IS NULL AND
      synced_at IS NULL) OR
    (status = 'synced' AND provider_record_id IS NOT NULL AND
      provider_record_url IS NOT NULL AND provider_response_hash IS NOT NULL AND
      last_error_code IS NULL AND synced_at IS NOT NULL) OR
    (status = 'failed' AND provider_record_id IS NULL AND
      provider_record_url IS NULL AND provider_response_hash IS NULL AND
      last_error_code IS NOT NULL AND synced_at IS NULL)
  )
);

CREATE INDEX marketing_crm_syncs_campaign_status_idx
  ON enterprise.marketing_crm_syncs
    (tenant_id, campaign_id, status, updated_at DESC, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_crm_sync_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing CRM sync cannot be deleted';
  END IF;
  IF ROW(NEW.tenant_id, NEW.id, NEW.campaign_id, NEW.outcome_id, NEW.provider,
    NEW.external_record_key, NEW.object_api_name, NEW.payload_hash,
    NEW.provider_fingerprint, NEW.request_hash, NEW.idempotency_key,
    NEW.outbox_event_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.tenant_id, OLD.id, OLD.campaign_id, OLD.outcome_id, OLD.provider,
    OLD.external_record_key, OLD.object_api_name, OLD.payload_hash,
    OLD.provider_fingerprint, OLD.request_hash, OLD.idempotency_key,
    OLD.outbox_event_id, OLD.created_by, OLD.created_at) OR
    OLD.status <> 'pending' OR NEW.status NOT IN ('pending', 'synced', 'failed') OR
    NEW.attempts <= OLD.attempts OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid enterprise marketing CRM sync transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_crm_syncs_guard
BEFORE UPDATE OR DELETE ON enterprise.marketing_crm_syncs
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_crm_sync_mutation();

ALTER TABLE enterprise.marketing_crm_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_crm_syncs FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_crm_syncs_tenant_isolation
  ON enterprise.marketing_crm_syncs
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
