CREATE TABLE enterprise.marketing_country_policy_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  policy_version text NOT NULL CHECK (
    policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  calling_windows jsonb NOT NULL,
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  frequency_window_hours integer NOT NULL CHECK (
    frequency_window_hours BETWEEN 1 AND 720
  ),
  min_retry_interval_minutes integer NOT NULL CHECK (
    min_retry_interval_minutes BETWEEN 1 AND 10080
  ),
  disclosure_version text NOT NULL CHECK (
    disclosure_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  brand_disclosure text NOT NULL CHECK (
    char_length(brand_disclosure) BETWEEN 1 AND 500 AND
    brand_disclosure = btrim(brand_disclosure)
  ),
  ai_identity_disclosure text NOT NULL CHECK (
    char_length(ai_identity_disclosure) BETWEEN 1 AND 500 AND
    ai_identity_disclosure = btrim(ai_identity_disclosure)
  ),
  marketing_purpose_disclosure text NOT NULL CHECK (
    char_length(marketing_purpose_disclosure) BETWEEN 1 AND 500 AND
    marketing_purpose_disclosure = btrim(marketing_purpose_disclosure)
  ),
  voicemail_mode text NOT NULL CHECK (
    voicemail_mode IN ('disabled', 'compliant_message', 'human_only')
  ),
  voicemail_version text,
  voicemail_message text,
  compliance_reference text NOT NULL CHECK (
    char_length(compliance_reference) BETWEEN 1 AND 500 AND
    compliance_reference = btrim(compliance_reference)
  ),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  effective_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > effective_from),
  published_by text NOT NULL CHECK (enterprise.is_account_subject_id(published_by)),
  published_at timestamptz NOT NULL,
  creation_key text NOT NULL CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  creation_request_hash text NOT NULL CHECK (
    creation_request_hash ~ '^[a-f0-9]{64}$'
  ),
  version bigint NOT NULL CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, country_code, policy_version),
  UNIQUE (tenant_id, published_by, creation_key),
  FOREIGN KEY (tenant_id, published_by)
    REFERENCES enterprise.members (tenant_id, user_id),
  CHECK (effective_from >= published_at - interval '5 minutes'),
  CHECK ((voicemail_mode = 'compliant_message' AND
      voicemail_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      char_length(voicemail_message) BETWEEN 1 AND 1000 AND
      voicemail_message = btrim(voicemail_message)) OR
    (voicemail_mode IN ('disabled', 'human_only') AND
      voicemail_version IS NULL AND voicemail_message IS NULL))
);

CREATE INDEX marketing_country_policy_versions_tenant_resolution_idx
  ON enterprise.marketing_country_policy_versions
    (tenant_id, country_code, effective_from, expires_at, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_country_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'enterprise marketing country policy is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.published_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.version <> 1 OR jsonb_typeof(NEW.calling_windows) <> 'array' OR
    jsonb_array_length(NEW.calling_windows) NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'invalid enterprise marketing country policy publication';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.calling_windows) AS item(value)
    WHERE jsonb_typeof(value) <> 'object' OR
      NOT (value ?& ARRAY['weekday', 'startMinute', 'endMinute']) OR
      value - ARRAY['weekday', 'startMinute', 'endMinute'] <> '{}'::jsonb OR
      value ->> 'weekday' !~ '^[0-9]+$' OR
      value ->> 'startMinute' !~ '^[0-9]+$' OR
      value ->> 'endMinute' !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'invalid enterprise marketing country policy calling window';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.calling_windows) AS item(value)
    WHERE (value ->> 'weekday')::integer NOT BETWEEN 1 AND 7 OR
      (value ->> 'startMinute')::integer NOT BETWEEN 0 AND 1439 OR
      (value ->> 'endMinute')::integer NOT BETWEEN 1 AND 1440 OR
      (value ->> 'endMinute')::integer <= (value ->> 'startMinute')::integer
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.calling_windows) WITH ORDINALITY left_item(value, n)
    JOIN jsonb_array_elements(NEW.calling_windows) WITH ORDINALITY right_item(value, n)
      ON left_item.n < right_item.n
      AND left_item.value ->> 'weekday' = right_item.value ->> 'weekday'
      AND (left_item.value ->> 'startMinute')::integer <
        (right_item.value ->> 'endMinute')::integer
      AND (right_item.value ->> 'startMinute')::integer <
        (left_item.value ->> 'endMinute')::integer
  ) THEN
    RAISE EXCEPTION 'overlapping enterprise marketing country policy window';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':marketing-country-policy:' || NEW.country_code, 0));
  IF EXISTS (
    SELECT 1 FROM enterprise.marketing_country_policy_versions policy
    WHERE policy.tenant_id = NEW.tenant_id
      AND policy.country_code = NEW.country_code
      AND policy.effective_from < NEW.expires_at
      AND policy.expires_at > NEW.effective_from
  ) THEN
    RAISE EXCEPTION 'overlapping enterprise marketing country policy version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_country_policy_versions_guard
BEFORE INSERT OR UPDATE OR DELETE
ON enterprise.marketing_country_policy_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_country_policy_mutation();

ALTER TABLE enterprise.marketing_country_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_country_policy_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_country_policy_versions_tenant_isolation
  ON enterprise.marketing_country_policy_versions
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

ALTER TABLE enterprise.marketing_call_tasks
  ADD COLUMN country_policy_version_id uuid,
  ADD CONSTRAINT marketing_call_tasks_country_policy_fk
    FOREIGN KEY (tenant_id, country_policy_version_id)
    REFERENCES enterprise.marketing_country_policy_versions (tenant_id, id);
CREATE INDEX marketing_call_tasks_tenant_lead_frequency_idx
  ON enterprise.marketing_call_tasks
    (tenant_id, lead_id, scheduled_at, status, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_country_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_at timestamptz;
BEGIN
  IF NEW.status = 'scheduled' AND (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.country_codes IS DISTINCT FROM NEW.country_codes OR
    OLD.schedule IS DISTINCT FROM NEW.schedule
  ) THEN
    IF NOT (NEW.schedule ? 'startAt') THEN
      RAISE EXCEPTION 'enterprise marketing country policy required';
    END IF;
    target_at := (NEW.schedule ->> 'startAt')::timestamptz;
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.country_codes) AS country(code)
      WHERE NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_country_policy_versions policy
        WHERE policy.tenant_id = NEW.tenant_id
          AND policy.country_code = country.code
          AND policy.effective_from <= target_at AND policy.expires_at > target_at
      )
    ) THEN
      RAISE EXCEPTION 'enterprise marketing country policy missing or expired';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_campaigns_country_policy_guard
BEFORE UPDATE OF status, country_codes, schedule
ON enterprise.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_country_policy();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_task_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_phone_hash text;
  target_country_code text;
  target_timezone text;
  target_policy enterprise.marketing_country_policy_versions%ROWTYPE;
  target_local timestamp;
  target_weekday integer;
  target_minute integer;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    (TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'valid automated marketing call consent required';
  END IF;
  SELECT lead.phone_hash, lead.country_code, lead.timezone
  INTO target_phone_hash, target_country_code, target_timezone
  FROM enterprise.marketing_leads lead
  WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id;
  IF target_phone_hash IS NULL OR target_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names zone WHERE zone.name = target_timezone
  ) THEN
    RAISE EXCEPTION 'valid marketing lead timezone required';
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
      AND link.campaign_id = consent.campaign_id AND link.lead_id = consent.lead_id
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    WHERE consent.tenant_id = NEW.tenant_id
      AND consent.campaign_id = NEW.campaign_id AND consent.lead_id = NEW.lead_id
      AND consent.purpose = 'automated_marketing_call'
      AND consent.granted_at <= NEW.scheduled_at
      AND (consent.expires_at IS NULL OR consent.expires_at > NEW.scheduled_at)
      AND consent.revoked_at IS NULL
      AND link.status = 'active' AND lead.status = 'active'
  ) THEN
    RAISE EXCEPTION 'valid automated marketing call consent required';
  END IF;
  SELECT * INTO target_policy
  FROM enterprise.marketing_country_policy_versions policy
  WHERE policy.tenant_id = NEW.tenant_id
    AND policy.id = NEW.country_policy_version_id
    AND policy.country_code = target_country_code
    AND policy.effective_from <= NEW.scheduled_at
    AND policy.expires_at > NEW.scheduled_at;
  IF target_policy.id IS NULL THEN
    RAISE EXCEPTION 'valid enterprise marketing country policy required';
  END IF;
  target_local := NEW.scheduled_at AT TIME ZONE target_timezone;
  target_weekday := extract(isodow FROM target_local)::integer;
  target_minute := extract(hour FROM target_local)::integer * 60 +
    extract(minute FROM target_local)::integer;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(target_policy.calling_windows) item
    WHERE (item ->> 'weekday')::integer = target_weekday
      AND (item ->> 'startMinute')::integer <= target_minute
      AND (item ->> 'endMinute')::integer > target_minute
  ) THEN
    RAISE EXCEPTION 'enterprise marketing task outside local calling window';
  END IF;
  IF EXISTS (
    SELECT 1 FROM enterprise.marketing_call_tasks prior
    WHERE prior.tenant_id = NEW.tenant_id AND prior.lead_id = NEW.lead_id
      AND prior.id <> NEW.id AND prior.status <> 'cancelled'
      AND prior.scheduled_at <= NEW.scheduled_at
      AND prior.scheduled_at > NEW.scheduled_at -
        make_interval(mins => target_policy.min_retry_interval_minutes)
  ) THEN
    RAISE EXCEPTION 'enterprise marketing retry interval exceeded';
  END IF;
  IF (
    SELECT count(*) FROM enterprise.marketing_call_tasks prior
    WHERE prior.tenant_id = NEW.tenant_id AND prior.lead_id = NEW.lead_id
      AND prior.id <> NEW.id AND prior.status <> 'cancelled'
      AND prior.scheduled_at <= NEW.scheduled_at
      AND prior.scheduled_at > NEW.scheduled_at -
        make_interval(hours => target_policy.frequency_window_hours)
  ) >= target_policy.max_attempts THEN
    RAISE EXCEPTION 'enterprise marketing frequency limit exceeded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER marketing_call_tasks_consent_guard
  ON enterprise.marketing_call_tasks;
CREATE TRIGGER marketing_call_tasks_consent_guard
BEFORE INSERT OR UPDATE OF tenant_id, campaign_id, lead_id, scheduled_at,
  country_policy_version_id
ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_task_consent();
