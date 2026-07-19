CREATE TABLE enterprise.marketing_lead_import_batches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('api', 'csv')),
  source_reference text NOT NULL CHECK (
    char_length(source_reference) BETWEEN 1 AND 200 AND
    source_reference = btrim(source_reference)
  ),
  status text NOT NULL CHECK (status IN ('processing', 'committed', 'rolled_back')),
  total_rows integer NOT NULL CHECK (total_rows BETWEEN 1 AND 500),
  created_count integer NOT NULL CHECK (created_count >= 0),
  linked_count integer NOT NULL CHECK (linked_count >= 0),
  duplicate_count integer NOT NULL CHECK (duplicate_count >= 0),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  rollback_by text CHECK (
    rollback_by IS NULL OR enterprise.is_account_subject_id(rollback_by)
  ),
  rollback_key text CHECK (
    rollback_key IS NULL OR rollback_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  rollback_request_hash text CHECK (
    rollback_request_hash IS NULL OR rollback_request_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL,
  committed_at timestamptz,
  rolled_back_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, id),
  UNIQUE (tenant_id, campaign_id, idempotency_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  FOREIGN KEY (tenant_id, rollback_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  CHECK (created_count + linked_count + duplicate_count <= total_rows),
  CHECK (updated_at >= created_at),
  CHECK (committed_at IS NULL OR
    (committed_at >= created_at AND committed_at <= updated_at)),
  CHECK (rolled_back_at IS NULL OR
    (committed_at IS NOT NULL AND rolled_back_at >= committed_at AND
      rolled_back_at <= updated_at))
);

CREATE INDEX marketing_lead_import_batches_tenant_campaign_idx
  ON enterprise.marketing_lead_import_batches
    (tenant_id, campaign_id, created_at DESC, id);

ALTER TABLE enterprise.marketing_leads
  ADD COLUMN phone_input_encrypted bytea,
  ADD COLUMN phone_hint text,
  ADD COLUMN created_by_batch_id uuid,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz;

UPDATE enterprise.marketing_leads
SET created_at = clock_timestamp(), updated_at = clock_timestamp();

ALTER TABLE enterprise.marketing_leads
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT marketing_leads_phone_hash_check CHECK (
    phone_hash ~ '^[a-f0-9]{64}$'
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_country_code_check CHECK (
    country_code ~ '^[A-Z]{2}$'
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_status_check CHECK (
    status IN ('active', 'inactive')
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_attributes_check CHECK (
    jsonb_typeof(attributes) = 'object' AND octet_length(attributes::text) <= 8192
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_phone_cipher_check CHECK (
    octet_length(phone_e164_encrypted) BETWEEN 1 AND 1024 AND
    (phone_input_encrypted IS NULL OR
      octet_length(phone_input_encrypted) BETWEEN 1 AND 1024)
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_phone_hint_check CHECK (
    phone_hint IS NULL OR phone_hint ~ '^[+][0-9*]{5,20}$'
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_timestamps_check CHECK (
    updated_at >= created_at
  ) NOT VALID,
  ADD CONSTRAINT marketing_leads_created_by_batch_fk
    FOREIGN KEY (tenant_id, created_by_batch_id)
    REFERENCES enterprise.marketing_lead_import_batches (tenant_id, id) NOT VALID;

CREATE UNIQUE INDEX marketing_leads_tenant_phone_hash_unique_idx
  ON enterprise.marketing_leads (tenant_id, phone_hash);

CREATE TABLE enterprise.marketing_campaign_leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'rolled_back')),
  linked_by text NOT NULL CHECK (enterprise.is_account_subject_id(linked_by)),
  created_at timestamptz NOT NULL,
  rolled_back_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id, import_batch_id)
    REFERENCES enterprise.marketing_lead_import_batches (tenant_id, campaign_id, id),
  FOREIGN KEY (tenant_id, linked_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  CHECK ((status = 'active' AND rolled_back_at IS NULL) OR
    (status = 'rolled_back' AND rolled_back_at IS NOT NULL))
);

CREATE UNIQUE INDEX marketing_campaign_leads_tenant_active_unique_idx
  ON enterprise.marketing_campaign_leads (tenant_id, campaign_id, lead_id)
  WHERE status = 'active';
CREATE INDEX marketing_campaign_leads_tenant_batch_idx
  ON enterprise.marketing_campaign_leads (tenant_id, import_batch_id, status, id);

CREATE TABLE enterprise.marketing_lead_import_rows (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 1),
  result text NOT NULL CHECK (result IN ('created', 'linked', 'duplicate')),
  lead_id uuid NOT NULL,
  campaign_lead_id uuid NOT NULL,
  phone_hint text NOT NULL CHECK (phone_hint ~ '^[+][0-9*]{5,20}$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, batch_id, row_number),
  FOREIGN KEY (tenant_id, batch_id)
    REFERENCES enterprise.marketing_lead_import_batches (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_lead_id)
    REFERENCES enterprise.marketing_campaign_leads (tenant_id, id)
);

CREATE INDEX marketing_lead_import_rows_tenant_batch_idx
  ON enterprise.marketing_lead_import_rows (tenant_id, batch_id, row_number, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_lead_import_batch_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing lead import batch cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.status <> 'processing' OR NEW.version <> 1 OR
      NEW.created_count <> 0 OR NEW.linked_count <> 0 OR
      NEW.duplicate_count <> 0 OR NEW.committed_at IS NOT NULL OR
      NEW.rolled_back_at IS NOT NULL OR NEW.rollback_by IS NOT NULL OR
      NEW.rollback_key IS NOT NULL OR NEW.rollback_request_hash IS NOT NULL OR
      NEW.created_at IS DISTINCT FROM NEW.updated_at THEN
      RAISE EXCEPTION 'invalid enterprise marketing lead import batch creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.source_kind,
    NEW.source_reference, NEW.total_rows, NEW.created_by, NEW.idempotency_key,
    NEW.request_hash, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.source_kind,
    OLD.source_reference, OLD.total_rows, OLD.created_by, OLD.idempotency_key,
    OLD.request_hash, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'enterprise marketing lead import batch identity is immutable';
  END IF;
  IF OLD.status = 'processing' AND NEW.status = 'committed' THEN
    IF NEW.created_count + NEW.linked_count + NEW.duplicate_count <> NEW.total_rows OR
      NEW.committed_at IS NULL OR NEW.committed_at < NEW.created_at OR
      NEW.committed_at > NEW.updated_at OR
      NEW.rolled_back_at IS NOT NULL OR NEW.rollback_by IS NOT NULL OR
      NEW.rollback_key IS NOT NULL OR NEW.rollback_request_hash IS NOT NULL THEN
      RAISE EXCEPTION 'invalid enterprise marketing lead import commit';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'committed' AND NEW.status = 'rolled_back' THEN
    IF ROW(NEW.created_count, NEW.linked_count, NEW.duplicate_count,
      NEW.committed_at) IS DISTINCT FROM ROW(OLD.created_count, OLD.linked_count,
      OLD.duplicate_count, OLD.committed_at) OR
      NEW.rollback_by IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.rollback_key IS NULL OR NEW.rollback_request_hash IS NULL OR
      NEW.rolled_back_at IS NULL OR NEW.rolled_back_at < NEW.committed_at OR
      NEW.rolled_back_at > NEW.updated_at THEN
      RAISE EXCEPTION 'invalid enterprise marketing lead import rollback';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid enterprise marketing lead import batch transition';
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_lead_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing lead cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.created_by_batch_id IS NULL OR NEW.phone_input_encrypted IS NULL OR
      NEW.phone_hint IS NULL OR NEW.status <> 'active' OR NEW.version <> 1 OR
      NEW.created_at IS DISTINCT FROM NEW.updated_at THEN
      RAISE EXCEPTION 'invalid enterprise marketing lead creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.external_id, NEW.phone_e164_encrypted,
    NEW.phone_input_encrypted, NEW.phone_hash, NEW.phone_hint, NEW.country_code,
    NEW.timezone, NEW.language, NEW.attributes, NEW.source_id,
    NEW.created_by_batch_id, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.external_id, OLD.phone_e164_encrypted,
    OLD.phone_input_encrypted, OLD.phone_hash, OLD.phone_hint, OLD.country_code,
    OLD.timezone, OLD.language, OLD.attributes, OLD.source_id,
    OLD.created_by_batch_id, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at <= OLD.updated_at OR NEW.status = OLD.status OR
    NEW.status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'invalid enterprise marketing lead mutation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_lead_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing campaign lead cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.linked_by IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.status <> 'active' OR NEW.rolled_back_at IS NOT NULL OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'invalid enterprise marketing campaign lead creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.lead_id,
    NEW.import_batch_id, NEW.linked_by, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.lead_id,
    OLD.import_batch_id, OLD.linked_by, OLD.created_at) OR
    OLD.status <> 'active' OR NEW.status <> 'rolled_back' OR
    NEW.rolled_back_at IS NULL OR NEW.rolled_back_at < NEW.created_at OR
    NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign lead rollback';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.reject_marketing_lead_import_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR
    NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() THEN
    RAISE EXCEPTION 'enterprise marketing lead import row is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_lead_import_batches_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_lead_import_batches
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_lead_import_batch_mutation();
CREATE TRIGGER marketing_leads_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_leads
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_lead_mutation();
CREATE TRIGGER marketing_campaign_leads_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_campaign_leads
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_lead_mutation();
CREATE TRIGGER marketing_lead_import_rows_append_only
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_lead_import_rows
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_marketing_lead_import_row_mutation();

ALTER TABLE enterprise.marketing_lead_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_lead_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_campaign_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_lead_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_lead_import_rows FORCE ROW LEVEL SECURITY;

CREATE POLICY marketing_lead_import_batches_tenant_isolation
  ON enterprise.marketing_lead_import_batches
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
CREATE POLICY marketing_campaign_leads_tenant_isolation
  ON enterprise.marketing_campaign_leads
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
CREATE POLICY marketing_lead_import_rows_tenant_isolation
  ON enterprise.marketing_lead_import_rows
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
