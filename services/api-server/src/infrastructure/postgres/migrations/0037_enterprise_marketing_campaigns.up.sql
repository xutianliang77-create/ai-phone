ALTER TABLE enterprise.marketing_campaigns
  ADD COLUMN creation_key text,
  ADD COLUMN creation_request_hash text;

UPDATE enterprise.marketing_campaigns
SET creation_key = 'legacy:' || id::text,
    creation_request_hash = md5('campaign:' || id::text) ||
      md5('campaign:' || id::text || ':2');

ALTER TABLE enterprise.marketing_campaigns
  ALTER COLUMN creation_key SET NOT NULL,
  ALTER COLUMN creation_request_hash SET NOT NULL,
  ADD CONSTRAINT marketing_campaigns_creation_key_check CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  ADD CONSTRAINT marketing_campaigns_creation_hash_check CHECK (
    creation_request_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT marketing_campaigns_name_check CHECK (
    char_length(name) BETWEEN 1 AND 200 AND name = btrim(name)
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_objective_check CHECK (
    char_length(objective) BETWEEN 1 AND 2000 AND objective = btrim(objective)
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_country_codes_check CHECK (
    cardinality(country_codes) BETWEEN 1 AND 32 AND
    array_to_string(country_codes, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_language_codes_check CHECK (
    cardinality(language_codes) BETWEEN 1 AND 32 AND
    array_to_string(language_codes, ',') ~
      '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)*$'
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_status_check CHECK (status IN (
    'draft', 'validating', 'pending_approval', 'approved', 'scheduled',
    'running', 'paused', 'completed', 'cancelled', 'failed'
  )) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_approval_status_check CHECK (
    approval_status IN ('not_submitted', 'pending', 'approved', 'rejected', 'expired')
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_schedule_check CHECK (
    jsonb_typeof(schedule) = 'object' AND
    schedule ? 'timezone' AND
    jsonb_typeof(schedule -> 'timezone') = 'string' AND
    char_length(schedule ->> 'timezone') BETWEEN 1 AND 64 AND
    (NOT (schedule ? 'startAt') OR jsonb_typeof(schedule -> 'startAt') = 'string') AND
    (NOT (schedule ? 'endAt') OR jsonb_typeof(schedule -> 'endAt') = 'string') AND
    schedule - ARRAY['timezone', 'startAt', 'endAt'] = '{}'::jsonb
  ) NOT VALID,
  ADD CONSTRAINT marketing_campaigns_owner_member_fk
    FOREIGN KEY (tenant_id, owner_user_id)
    REFERENCES enterprise.members (tenant_id, user_id) NOT VALID;

CREATE UNIQUE INDEX marketing_campaigns_tenant_creation_key_unique_idx
  ON enterprise.marketing_campaigns (tenant_id, creation_key);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing campaign cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.owner_user_id IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.status <> 'draft' OR NEW.approval_status <> 'not_submitted' OR
      NEW.policy_version IS NOT NULL OR NEW.version <> 1 OR
      NEW.created_at IS DISTINCT FROM NEW.updated_at THEN
      RAISE EXCEPTION 'invalid enterprise marketing campaign creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.owner_user_id, NEW.creation_key,
    NEW.creation_request_hash, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.owner_user_id, OLD.creation_key,
    OLD.creation_request_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'enterprise marketing campaign identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign version';
  END IF;
  IF ROW(NEW.name, NEW.objective, NEW.country_codes, NEW.language_codes,
    NEW.schedule, NEW.concurrency_limit) IS DISTINCT FROM
    ROW(OLD.name, OLD.objective, OLD.country_codes, OLD.language_codes,
    OLD.schedule, OLD.concurrency_limit) AND
    (OLD.status <> 'draft' OR OLD.approval_status <> 'not_submitted') THEN
    RAISE EXCEPTION 'enterprise marketing campaign draft is immutable';
  END IF;
  allowed := NEW.status = OLD.status OR CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('validating', 'cancelled')
    WHEN 'validating' THEN NEW.status IN ('draft', 'pending_approval', 'failed', 'cancelled')
    WHEN 'pending_approval' THEN NEW.status IN ('draft', 'approved', 'cancelled')
    WHEN 'approved' THEN NEW.status IN ('scheduled', 'cancelled')
    WHEN 'scheduled' THEN NEW.status IN ('running', 'cancelled', 'failed')
    WHEN 'running' THEN NEW.status IN ('paused', 'completed', 'cancelled', 'failed')
    WHEN 'paused' THEN NEW.status IN ('running', 'completed', 'cancelled', 'failed')
    ELSE false END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign transition';
  END IF;
  IF NEW.status IN ('approved', 'scheduled', 'running', 'paused', 'completed') AND
    (NEW.approval_status <> 'approved' OR NEW.policy_version IS NULL) THEN
    RAISE EXCEPTION 'enterprise marketing campaign approval required';
  END IF;
  IF NEW.status = 'scheduled' AND NOT (NEW.schedule ? 'startAt') THEN
    RAISE EXCEPTION 'enterprise marketing campaign schedule required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_campaigns_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_campaigns
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_mutation();
