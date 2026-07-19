CREATE TABLE enterprise.marketing_campaign_validation_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  source_campaign_version bigint NOT NULL CHECK (source_campaign_version >= 1),
  status text NOT NULL CHECK (status IN ('ready', 'blocked')),
  target_at timestamptz,
  campaign_snapshot jsonb NOT NULL CHECK (jsonb_typeof(campaign_snapshot) = 'object'),
  campaign_hash text NOT NULL CHECK (campaign_hash ~ '^[a-f0-9]{64}$'),
  policy_set jsonb NOT NULL CHECK (jsonb_typeof(policy_set) = 'array'),
  policy_set_hash text NOT NULL CHECK (policy_set_hash ~ '^[a-f0-9]{64}$'),
  lead_set jsonb NOT NULL CHECK (jsonb_typeof(lead_set) = 'array'),
  lead_set_hash text NOT NULL CHECK (lead_set_hash ~ '^[a-f0-9]{64}$'),
  consent_set jsonb NOT NULL CHECK (jsonb_typeof(consent_set) = 'array'),
  consent_set_hash text NOT NULL CHECK (consent_set_hash ~ '^[a-f0-9]{64}$'),
  suppression_set jsonb NOT NULL CHECK (jsonb_typeof(suppression_set) = 'array'),
  suppression_set_hash text NOT NULL CHECK (suppression_set_hash ~ '^[a-f0-9]{64}$'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  validated_by text NOT NULL CHECK (enterprise.is_account_subject_id(validated_by)),
  validated_at timestamptz NOT NULL,
  creation_key text NOT NULL CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  creation_request_hash text NOT NULL CHECK (
    creation_request_hash ~ '^[a-f0-9]{64}$'),
  version bigint NOT NULL CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, id),
  UNIQUE (tenant_id, validated_by, creation_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, validated_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  CHECK ((status = 'ready' AND target_at IS NOT NULL AND issues = '[]'::jsonb AND
      jsonb_array_length(lead_set) > 0 AND
      jsonb_array_length(lead_set) = jsonb_array_length(consent_set) AND
      suppression_set = '[]'::jsonb) OR
    (status = 'blocked' AND jsonb_array_length(issues) > 0))
);

CREATE TABLE enterprise.marketing_campaign_approval_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  validation_snapshot_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  rejection_reason text,
  decision_hash text NOT NULL CHECK (decision_hash ~ '^[a-f0-9]{64}$'),
  decided_by text NOT NULL CHECK (enterprise.is_account_subject_id(decided_by)),
  decided_at timestamptz NOT NULL,
  creation_key text NOT NULL CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  creation_request_hash text NOT NULL CHECK (
    creation_request_hash ~ '^[a-f0-9]{64}$'),
  version bigint NOT NULL CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, id),
  UNIQUE (tenant_id, decided_by, creation_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id, validation_snapshot_id)
    REFERENCES enterprise.marketing_campaign_validation_snapshots
      (tenant_id, campaign_id, id),
  FOREIGN KEY (tenant_id, decided_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  CHECK ((decision = 'approved' AND rejection_reason IS NULL) OR
    (decision = 'rejected' AND char_length(rejection_reason) BETWEEN 1 AND 1000
      AND rejection_reason = btrim(rejection_reason)))
);

CREATE INDEX marketing_campaign_validations_tenant_campaign_idx
  ON enterprise.marketing_campaign_validation_snapshots
    (tenant_id, campaign_id, validated_at DESC, id);
CREATE INDEX marketing_campaign_decisions_tenant_campaign_idx
  ON enterprise.marketing_campaign_approval_decisions
    (tenant_id, campaign_id, decided_at DESC, id);

ALTER TABLE enterprise.marketing_campaign_validation_snapshots
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_campaign_validation_snapshots
  FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_campaign_approval_decisions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_campaign_approval_decisions
  FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_campaign_validations_tenant_isolation
  ON enterprise.marketing_campaign_validation_snapshots
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
CREATE POLICY marketing_campaign_decisions_tenant_isolation
  ON enterprise.marketing_campaign_approval_decisions
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.marketing_iso(value timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE OR REPLACE FUNCTION enterprise.marketing_campaign_validation_matches(
  snapshot_id uuid
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  snapshot enterprise.marketing_campaign_validation_snapshots%ROWTYPE;
  campaign enterprise.marketing_campaigns%ROWTYPE;
  expected jsonb;
BEGIN
  SELECT * INTO snapshot FROM enterprise.marketing_campaign_validation_snapshots
  WHERE tenant_id = enterprise.current_tenant_id() AND id = snapshot_id;
  IF snapshot.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO campaign FROM enterprise.marketing_campaigns
  WHERE tenant_id = snapshot.tenant_id AND id = snapshot.campaign_id;
  IF campaign.id IS NULL OR snapshot.campaign_snapshot <> jsonb_build_object(
    'name', campaign.name, 'objective', campaign.objective,
    'ownerUserId', campaign.owner_user_id, 'countryCodes', campaign.country_codes,
    'languageCodes', campaign.language_codes, 'schedule', campaign.schedule,
    'concurrencyLimit', campaign.concurrency_limit) THEN RETURN false; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'countryCode', policy.country_code, 'policyId', policy.id,
    'policyVersion', policy.policy_version, 'contentHash', policy.content_hash,
    'effectiveFrom', enterprise.marketing_iso(policy.effective_from),
    'expiresAt', enterprise.marketing_iso(policy.expires_at)
  ) ORDER BY policy.country_code, policy.effective_from, policy.id), '[]'::jsonb)
  INTO expected FROM enterprise.marketing_country_policy_versions policy
  WHERE policy.tenant_id = snapshot.tenant_id
    AND policy.country_code = ANY(campaign.country_codes)
    AND snapshot.target_at IS NOT NULL
    AND policy.effective_from <= snapshot.target_at
    AND policy.expires_at > snapshot.target_at;
  IF snapshot.policy_set <> expected THEN RETURN false; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'leadId', lead.id, 'leadVersion', lead.version, 'linkId', link.id,
    'linkVersion', link.version, 'batchId', batch.id,
    'batchVersion', batch.version, 'countryCode', lead.country_code,
    'timezone', lead.timezone, 'language', lead.language
  ) ORDER BY lead.id, link.id), '[]'::jsonb) INTO expected
  FROM enterprise.marketing_campaign_leads link
  JOIN enterprise.marketing_leads lead
    ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
  JOIN enterprise.marketing_lead_import_batches batch
    ON batch.tenant_id = link.tenant_id AND batch.id = link.import_batch_id
  WHERE link.tenant_id = snapshot.tenant_id AND link.campaign_id = snapshot.campaign_id
    AND link.status = 'active' AND lead.status = 'active' AND batch.status = 'committed';
  IF snapshot.lead_set <> expected THEN RETURN false; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'leadId', selected.lead_id, 'consentId', selected.id,
    'consentVersion', selected.version, 'evidenceSha256', selected.evidence_sha256,
    'grantedAt', enterprise.marketing_iso(selected.granted_at),
    'expiresAt', CASE WHEN selected.expires_at IS NULL THEN NULL
      ELSE enterprise.marketing_iso(selected.expires_at) END,
    'policyVersion', selected.policy_version
  ) ORDER BY selected.lead_id), '[]'::jsonb) INTO expected FROM (
    SELECT DISTINCT ON (consent.lead_id) consent.*
    FROM enterprise.contact_consents consent
    JOIN enterprise.marketing_campaign_leads link
      ON link.tenant_id = consent.tenant_id AND link.campaign_id = consent.campaign_id
      AND link.lead_id = consent.lead_id
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    WHERE consent.tenant_id = snapshot.tenant_id
      AND consent.campaign_id = snapshot.campaign_id
      AND snapshot.target_at IS NOT NULL
      AND consent.purpose = 'automated_marketing_call'
      AND consent.granted_at <= snapshot.target_at
      AND (consent.expires_at IS NULL OR consent.expires_at > snapshot.target_at)
      AND consent.revoked_at IS NULL AND link.status = 'active'
      AND lead.status = 'active'
    ORDER BY consent.lead_id, consent.granted_at DESC, consent.id DESC
  ) selected;
  IF snapshot.consent_set <> expected THEN RETURN false; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'leadId', lead.id, 'suppressionId', suppression.id,
    'scope', suppression.scope,
    'createdAt', enterprise.marketing_iso(suppression.created_at)
  ) ORDER BY lead.id, suppression.id), '[]'::jsonb) INTO expected
  FROM enterprise.marketing_campaign_leads link
  JOIN enterprise.marketing_leads lead
    ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
  JOIN enterprise.suppression_entries suppression
    ON suppression.tenant_id = lead.tenant_id
    AND suppression.phone_hash = lead.phone_hash
    AND suppression.scope IN ('tenant', 'global')
  WHERE link.tenant_id = snapshot.tenant_id AND link.campaign_id = snapshot.campaign_id
    AND link.status = 'active' AND lead.status = 'active';
  RETURN snapshot.suppression_set = expected;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'enterprise marketing campaign validation is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.validated_by IS DISTINCT FROM enterprise.current_user_id() OR NEW.version <> 1 OR
    NOT EXISTS (SELECT 1 FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
        AND campaign.version = NEW.source_campaign_version
        AND campaign.status = 'draft'
        AND campaign.approval_status IN ('not_submitted', 'rejected')) THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign validation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_campaign_validations_guard
BEFORE INSERT OR UPDATE OR DELETE
ON enterprise.marketing_campaign_validation_snapshots
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_validation();
CREATE OR REPLACE FUNCTION enterprise.verify_marketing_campaign_validation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT enterprise.marketing_campaign_validation_matches(NEW.id) THEN
    RAISE EXCEPTION 'enterprise marketing campaign validation snapshot mismatch';
  END IF;
  IF NEW.status = 'ready' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_campaigns campaign
    WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
      AND campaign.schedule ? 'startAt'
      AND NEW.target_at = (campaign.schedule ->> 'startAt')::timestamptz
      AND NEW.target_at > NEW.validated_at
      AND jsonb_array_length(NEW.policy_set) = cardinality(campaign.country_codes)
      AND (SELECT count(DISTINCT item ->> 'countryCode')
        FROM jsonb_array_elements(NEW.policy_set) item) =
        cardinality(campaign.country_codes)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.lead_set) item
        WHERE NOT ((item ->> 'countryCode') = ANY(campaign.country_codes)) OR
          NOT EXISTS (SELECT 1 FROM pg_timezone_names zone
            WHERE zone.name = item ->> 'timezone')
      )
  ) THEN
    RAISE EXCEPTION 'enterprise marketing campaign validation is not ready';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_campaign_validations_verify
AFTER INSERT ON enterprise.marketing_campaign_validation_snapshots
FOR EACH ROW EXECUTE FUNCTION enterprise.verify_marketing_campaign_validation();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE validation enterprise.marketing_campaign_validation_snapshots%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'enterprise marketing campaign approval decision is immutable';
  END IF;
  SELECT * INTO validation FROM enterprise.marketing_campaign_validation_snapshots
  WHERE tenant_id = NEW.tenant_id AND id = NEW.validation_snapshot_id;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.decided_by IS DISTINCT FROM enterprise.current_user_id() OR NEW.version <> 1 OR
    validation.id IS NULL OR validation.campaign_id <> NEW.campaign_id OR
    validation.status <> 'ready' OR
    (NEW.decision = 'approved' AND
      NOT enterprise.marketing_campaign_validation_matches(validation.id)) OR
    NOT EXISTS (SELECT 1 FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
        AND campaign.status = 'pending_approval' AND campaign.approval_status = 'pending'
        AND campaign.version = validation.source_campaign_version + 2) THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign approval decision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_campaign_decisions_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_campaign_approval_decisions
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_decision();

ALTER TABLE enterprise.marketing_campaigns ADD COLUMN approval_snapshot_id uuid,
  ADD CONSTRAINT marketing_campaigns_approval_snapshot_fk
    FOREIGN KEY (tenant_id, approval_snapshot_id)
    REFERENCES enterprise.marketing_campaign_approval_decisions (tenant_id, id);

CREATE OR REPLACE FUNCTION enterprise.marketing_campaign_approval_is_current(
  campaign_id uuid, decision_id uuid
) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM enterprise.marketing_campaigns campaign
    JOIN enterprise.marketing_campaign_approval_decisions decision
      ON decision.tenant_id = campaign.tenant_id AND decision.id = decision_id
      AND decision.campaign_id = campaign.id AND decision.decision = 'approved'
    JOIN enterprise.marketing_campaign_validation_snapshots validation
      ON validation.tenant_id = decision.tenant_id
      AND validation.id = decision.validation_snapshot_id
    WHERE campaign.tenant_id = enterprise.current_tenant_id()
      AND campaign.id = campaign_id AND campaign.approval_snapshot_id = decision.id
      AND campaign.policy_version = validation.snapshot_hash
      AND validation.status = 'ready'
      AND enterprise.marketing_campaign_validation_matches(validation.id)
  )
$$;
