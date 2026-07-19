DROP TRIGGER IF EXISTS marketing_call_tasks_approval_guard
  ON enterprise.marketing_call_tasks;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_task_approval_snapshot();
ALTER TABLE enterprise.marketing_call_tasks
  DROP CONSTRAINT IF EXISTS marketing_call_tasks_approval_snapshot_fk,
  DROP COLUMN IF EXISTS approval_snapshot_id;

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
      NEW.policy_version IS NOT NULL OR
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
