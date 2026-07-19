CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing campaign cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.owner_user_id IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.status <> 'draft' OR NEW.approval_status <> 'not_submitted' OR
      NEW.policy_version IS NOT NULL OR NEW.approval_snapshot_id IS NOT NULL OR
      NEW.version <> 1 OR NEW.created_at IS DISTINCT FROM NEW.updated_at THEN
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
    (OLD.status <> 'draft' OR OLD.approval_status NOT IN ('not_submitted', 'rejected')) THEN
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
  IF NEW.status = 'draft' AND (NEW.approval_status NOT IN ('not_submitted', 'rejected') OR
    NEW.approval_snapshot_id IS NOT NULL OR NEW.policy_version IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign draft approval';
  END IF;
  IF NEW.status = 'validating' AND (NEW.approval_status <> 'not_submitted' OR
    NEW.approval_snapshot_id IS NOT NULL OR NEW.policy_version IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign validation state';
  END IF;
  IF NEW.status = 'pending_approval' AND (NEW.approval_status <> 'pending' OR
    NEW.approval_snapshot_id IS NOT NULL OR NEW.policy_version IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign pending approval';
  END IF;
  IF NEW.status = 'validating' AND OLD.status = 'draft' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_campaign_validation_snapshots validation
    WHERE validation.tenant_id = NEW.tenant_id AND validation.campaign_id = NEW.id
      AND validation.source_campaign_version = OLD.version
      AND validation.status = 'ready'
      AND validation.validated_by = enterprise.current_user_id()
      AND validation.validated_at = NEW.updated_at
      AND enterprise.marketing_campaign_validation_matches(validation.id)
  ) THEN
    RAISE EXCEPTION 'valid enterprise marketing campaign validation required';
  END IF;
  IF NEW.status = 'pending_approval' AND OLD.status = 'validating' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_campaign_validation_snapshots validation
    WHERE validation.tenant_id = NEW.tenant_id AND validation.campaign_id = NEW.id
      AND validation.source_campaign_version = OLD.version - 1
      AND validation.status = 'ready'
      AND validation.validated_by = enterprise.current_user_id()
      AND NEW.updated_at = validation.validated_at + interval '1 millisecond'
      AND enterprise.marketing_campaign_validation_matches(validation.id)
  ) THEN
    RAISE EXCEPTION 'valid enterprise marketing campaign submission required';
  END IF;
  IF NEW.status IN ('approved', 'scheduled', 'running', 'paused', 'completed') AND
    (NEW.approval_status <> 'approved' OR NEW.policy_version IS NULL OR
      NEW.approval_snapshot_id IS NULL) THEN
    RAISE EXCEPTION 'enterprise marketing campaign approval required';
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'approved' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_campaign_approval_decisions decision
    JOIN enterprise.marketing_campaign_validation_snapshots validation
      ON validation.tenant_id = decision.tenant_id
      AND validation.id = decision.validation_snapshot_id
    WHERE decision.tenant_id = NEW.tenant_id AND decision.id = NEW.approval_snapshot_id
      AND decision.campaign_id = NEW.id AND decision.decision = 'approved'
      AND decision.decided_by = enterprise.current_user_id()
      AND decision.decided_at = NEW.updated_at
      AND validation.status = 'ready' AND NEW.policy_version = validation.snapshot_hash
      AND enterprise.marketing_campaign_validation_matches(validation.id)
  ) THEN
    RAISE EXCEPTION 'valid enterprise marketing campaign approval snapshot required';
  END IF;
  IF NEW.status = 'draft' AND NEW.approval_status = 'rejected' AND
    OLD.status = 'pending_approval' AND NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaign_approval_decisions decision
      WHERE decision.tenant_id = NEW.tenant_id AND decision.campaign_id = NEW.id
        AND decision.decision = 'rejected'
        AND decision.decided_by = enterprise.current_user_id()
        AND decision.decided_at = NEW.updated_at
  ) THEN
    RAISE EXCEPTION 'valid enterprise marketing campaign rejection required';
  END IF;
  IF NEW.status = OLD.status AND NEW.approval_status IS DISTINCT FROM
    OLD.approval_status AND NOT (OLD.status = 'draft' AND
      OLD.approval_status = 'rejected' AND NEW.approval_status = 'not_submitted') THEN
    RAISE EXCEPTION 'invalid enterprise marketing campaign approval transition';
  END IF;
  IF OLD.approval_snapshot_id IS NOT NULL AND
    NEW.approval_snapshot_id IS DISTINCT FROM OLD.approval_snapshot_id THEN
    RAISE EXCEPTION 'enterprise marketing campaign approval snapshot is immutable';
  END IF;
  IF NEW.status = 'scheduled' AND (NOT (NEW.schedule ? 'startAt') OR
    NOT enterprise.marketing_campaign_approval_is_current(
      NEW.id, NEW.approval_snapshot_id)) THEN
    RAISE EXCEPTION 'current enterprise marketing campaign approval required';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE enterprise.marketing_call_tasks ADD COLUMN approval_snapshot_id uuid,
  ADD CONSTRAINT marketing_call_tasks_approval_snapshot_fk
    FOREIGN KEY (tenant_id, approval_snapshot_id)
    REFERENCES enterprise.marketing_campaign_approval_decisions (tenant_id, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_task_approval_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.approval_snapshot_id IS NULL OR
    NOT enterprise.marketing_campaign_approval_is_current(
      NEW.campaign_id, NEW.approval_snapshot_id) OR
    NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaign_approval_decisions decision
      JOIN enterprise.marketing_campaign_validation_snapshots validation
        ON validation.tenant_id = decision.tenant_id
        AND validation.id = decision.validation_snapshot_id
      WHERE decision.tenant_id = NEW.tenant_id AND decision.id = NEW.approval_snapshot_id
        AND decision.campaign_id = NEW.campaign_id AND decision.decision = 'approved'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(validation.lead_set) item
          WHERE item ->> 'leadId' = NEW.lead_id::text)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(validation.consent_set) item
          WHERE item ->> 'leadId' = NEW.lead_id::text)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(validation.policy_set) item
          WHERE item ->> 'policyId' = NEW.country_policy_version_id::text)
    ) THEN
    RAISE EXCEPTION 'valid enterprise marketing task approval snapshot required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_call_tasks_approval_guard
BEFORE INSERT OR UPDATE OF tenant_id, campaign_id, lead_id, scheduled_at,
  country_policy_version_id, approval_snapshot_id
ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_task_approval_snapshot();
