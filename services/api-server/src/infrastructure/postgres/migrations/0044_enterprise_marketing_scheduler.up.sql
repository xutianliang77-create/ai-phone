ALTER TABLE enterprise.marketing_call_tasks
  ADD COLUMN generation_hash text,
  ADD COLUMN generated_by text,
  ADD COLUMN generated_at timestamptz,
  ADD COLUMN usage_hold_id uuid,
  ADD COLUMN claim_owner text,
  ADD COLUMN claim_token_hash text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN dispatch_generation bigint,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz;

UPDATE enterprise.marketing_call_tasks
SET generation_hash = md5(tenant_id::text || ':' || id::text) ||
    md5('scheduler-migration:' || tenant_id::text || ':' || id::text),
  generated_by = 'system:migration', generated_at = scheduled_at,
  dispatch_generation = 0, created_at = scheduled_at, updated_at = scheduled_at;

ALTER TABLE enterprise.marketing_call_tasks
  ALTER COLUMN generation_hash SET NOT NULL,
  ALTER COLUMN generated_by SET NOT NULL,
  ALTER COLUMN generated_at SET NOT NULL,
  ALTER COLUMN dispatch_generation SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT marketing_call_tasks_generation_hash_check
    CHECK (generation_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT marketing_call_tasks_generated_by_check
    CHECK (enterprise.is_actor_subject_id(generated_by)),
  ADD CONSTRAINT marketing_call_tasks_claim_owner_check
    CHECK (claim_owner IS NULL OR claim_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  ADD CONSTRAINT marketing_call_tasks_claim_token_hash_check
    CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT marketing_call_tasks_dispatch_generation_check
    CHECK (dispatch_generation >= 0),
  ADD CONSTRAINT marketing_call_tasks_usage_hold_fk
    FOREIGN KEY (tenant_id, usage_hold_id)
    REFERENCES enterprise.usage_holds (tenant_id, id);

CREATE INDEX marketing_call_tasks_tenant_lease_idx
  ON enterprise.marketing_call_tasks
    (tenant_id, status, lease_expires_at, id)
  WHERE status = 'dispatching';

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_scheduler_task()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  campaign enterprise.marketing_campaigns%ROWTYPE;
  tenant_limit integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing task cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
      NEW.generated_by IS DISTINCT FROM enterprise.current_user_id() OR
      NEW.status <> 'scheduled' OR NEW.attempt <> 1 OR NEW.version <> 1 OR
      NEW.translation_session_id IS NOT NULL OR NEW.outcome_code IS NOT NULL OR
      NEW.claimed_at IS NOT NULL OR NEW.usage_hold_id IS NOT NULL OR
      NEW.claim_owner IS NOT NULL OR NEW.claim_token_hash IS NOT NULL OR
      NEW.lease_expires_at IS NOT NULL OR NEW.dispatch_generation <> 0 OR
      NEW.generated_at IS DISTINCT FROM NEW.created_at OR
      NEW.created_at IS DISTINCT FROM NEW.updated_at OR
      NEW.generation_hash !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'invalid enterprise marketing task generation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.lead_id, NEW.scheduled_at,
    NEW.attempt, NEW.idempotency_key, NEW.country_policy_version_id,
    NEW.approval_snapshot_id, NEW.generation_hash, NEW.generated_by,
    NEW.generated_at, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.lead_id, OLD.scheduled_at,
    OLD.attempt, OLD.idempotency_key, OLD.country_policy_version_id,
    OLD.approval_snapshot_id, OLD.generation_hash, OLD.generated_by,
    OLD.generated_at, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'enterprise marketing task identity is immutable';
  END IF;
  IF NOT ((OLD.status IN ('pending', 'scheduled', 'retry') AND
      NEW.status IN ('dispatching', 'cancelled')) OR
    (OLD.status = 'dispatching' AND NEW.status IN ('retry', 'cancelled'))) THEN
    RAISE EXCEPTION 'invalid enterprise marketing task transition';
  END IF;
  IF NEW.status = 'dispatching' AND OLD.status IN ('pending', 'scheduled', 'retry') THEN
    IF enterprise.current_user_id() <> 'system:enterprise-marketing-scheduler' OR
      NEW.claimed_at IS DISTINCT FROM NEW.updated_at OR NEW.claim_owner IS NULL OR
      NEW.claim_token_hash IS NULL OR NEW.lease_expires_at <= NEW.updated_at OR
      NEW.usage_hold_id IS NULL OR NEW.dispatch_generation <> OLD.dispatch_generation + 1 OR
      NEW.scheduled_at > NEW.updated_at THEN
      RAISE EXCEPTION 'invalid enterprise marketing scheduler claim';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.tenant_id::text || ':marketing-scheduler', 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.tenant_id::text || ':marketing-scheduler:' || NEW.campaign_id::text, 0));
    SELECT * INTO campaign FROM enterprise.marketing_campaigns
    WHERE tenant_id = NEW.tenant_id AND id = NEW.campaign_id;
    SELECT (snapshot.entitlements -> 'worker.voice_agent_runtime.concurrent' ->> 'limit')::integer
    INTO tenant_limit FROM enterprise.entitlement_snapshots snapshot
    JOIN enterprise.billing_accounts account
      ON account.tenant_id = snapshot.tenant_id
      AND account.id = snapshot.billing_account_id AND account.status = 'active'
    JOIN enterprise.subscriptions subscription
      ON subscription.tenant_id = snapshot.tenant_id
      AND subscription.id = snapshot.subscription_id AND subscription.status = 'active'
    WHERE snapshot.tenant_id = NEW.tenant_id AND snapshot.status = 'active'
      AND snapshot.effective_from <= NEW.updated_at
      AND (snapshot.effective_until IS NULL OR snapshot.effective_until > NEW.updated_at)
      AND subscription.current_period_start <= NEW.updated_at
      AND subscription.current_period_end > NEW.updated_at
      AND snapshot.entitlements -> 'worker.voice_agent_runtime.concurrent' ->> 'enabled' = 'true'
      AND snapshot.entitlements -> 'worker.voice_agent_runtime.concurrent' ->> 'limit'
        ~ '^[1-9][0-9]*$';
    IF campaign.id IS NULL OR campaign.status NOT IN ('scheduled', 'running') OR
      tenant_limit IS NULL OR NOT enterprise.marketing_campaign_approval_is_current(
        campaign.id, NEW.approval_snapshot_id) OR NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_leads lead
        JOIN enterprise.marketing_campaign_leads link
          ON link.tenant_id = lead.tenant_id AND link.lead_id = lead.id
          AND link.campaign_id = NEW.campaign_id AND link.status = 'active'
        JOIN enterprise.marketing_country_policy_versions policy
          ON policy.tenant_id = lead.tenant_id
          AND policy.id = NEW.country_policy_version_id
          AND policy.effective_from <= NEW.updated_at AND policy.expires_at > NEW.updated_at
        WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id
          AND lead.status = 'active' AND EXISTS (
            SELECT 1 FROM enterprise.contact_consents consent
            WHERE consent.tenant_id = NEW.tenant_id
              AND consent.campaign_id = NEW.campaign_id AND consent.lead_id = NEW.lead_id
              AND consent.purpose = 'automated_marketing_call'
              AND consent.granted_at <= NEW.scheduled_at AND consent.revoked_at IS NULL
              AND (consent.expires_at IS NULL OR consent.expires_at > NEW.updated_at))
          AND NOT EXISTS (SELECT 1 FROM enterprise.suppression_entries suppression
            WHERE suppression.tenant_id = NEW.tenant_id
              AND suppression.phone_hash = lead.phone_hash
              AND suppression.scope IN ('tenant', 'global'))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(policy.calling_windows) calling_window(item)
            WHERE (calling_window.item ->> 'weekday')::integer = extract(isodow FROM
                NEW.updated_at AT TIME ZONE lead.timezone)::integer
              AND (calling_window.item ->> 'startMinute')::integer <=
                extract(hour FROM NEW.updated_at AT TIME ZONE lead.timezone)::integer * 60 +
                extract(minute FROM NEW.updated_at AT TIME ZONE lead.timezone)::integer
              AND (calling_window.item ->> 'endMinute')::integer >
                extract(hour FROM NEW.updated_at AT TIME ZONE lead.timezone)::integer * 60 +
                extract(minute FROM NEW.updated_at AT TIME ZONE lead.timezone)::integer)
      ) OR NOT EXISTS (
        SELECT 1 FROM enterprise.usage_holds hold_record
        WHERE hold_record.tenant_id = NEW.tenant_id AND hold_record.id = NEW.usage_hold_id
          AND hold_record.status = 'held' AND hold_record.category = 'marketing_call_seconds'
          AND hold_record.unit = 'seconds' AND hold_record.amount = 60
          AND hold_record.source_type = 'marketing_call_task'
          AND hold_record.source_ref = NEW.id::text
          AND hold_record.expires_at = NEW.lease_expires_at
      ) OR (SELECT count(*) FROM enterprise.marketing_call_tasks task
        WHERE task.tenant_id = NEW.tenant_id AND task.id <> NEW.id
          AND task.status IN ('dispatching', 'dispatched', 'answered')) >= tenant_limit OR
      (SELECT count(*) FROM enterprise.marketing_call_tasks task
        WHERE task.tenant_id = NEW.tenant_id AND task.campaign_id = NEW.campaign_id
          AND task.id <> NEW.id AND task.status IN
            ('dispatching', 'dispatched', 'answered')) >= campaign.concurrency_limit THEN
      RAISE EXCEPTION 'enterprise marketing scheduler capacity or fence rejected';
    END IF;
  END IF;
  IF NEW.status = 'retry' AND OLD.status = 'dispatching' AND
    (enterprise.current_user_id() <> 'system:enterprise-marketing-scheduler' OR
      NEW.outcome_code <> 'scheduler_lease_expired' OR NEW.claimed_at IS NOT NULL OR
      NEW.claim_owner IS NOT NULL OR NEW.claim_token_hash IS NOT NULL OR
      NEW.lease_expires_at IS NOT NULL OR NEW.usage_hold_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid enterprise marketing scheduler retry';
  END IF;
  IF NEW.status = 'cancelled' AND (NEW.outcome_code NOT IN
      ('consent_revoked', 'suppressed') OR NEW.claimed_at IS NOT NULL OR
      NEW.claim_owner IS NOT NULL OR NEW.claim_token_hash IS NOT NULL OR
      NEW.lease_expires_at IS NOT NULL OR NEW.usage_hold_id IS NOT NULL OR
      (NEW.outcome_code = 'consent_revoked' AND EXISTS (
        SELECT 1 FROM enterprise.contact_consents consent
        WHERE consent.tenant_id = NEW.tenant_id AND consent.campaign_id = NEW.campaign_id
          AND consent.lead_id = NEW.lead_id
          AND consent.purpose = 'automated_marketing_call'
          AND consent.granted_at <= NEW.scheduled_at
          AND (consent.expires_at IS NULL OR consent.expires_at > NEW.scheduled_at)
          AND consent.revoked_at IS NULL))) THEN
    RAISE EXCEPTION 'invalid enterprise marketing scheduler cancellation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marketing_call_tasks_scheduler_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_scheduler_task();

CREATE OR REPLACE FUNCTION enterprise.cancel_tasks_after_marketing_consent_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enterprise.usage_holds hold_record
  SET status = 'released',
    released_at = GREATEST(NEW.revoked_at, hold_record.updated_at),
    updated_at = GREATEST(NEW.revoked_at, hold_record.updated_at),
    version = hold_record.version + 1
  FROM enterprise.marketing_call_tasks task
  WHERE hold_record.tenant_id = NEW.tenant_id AND task.tenant_id = hold_record.tenant_id
    AND task.campaign_id = NEW.campaign_id AND task.lead_id = NEW.lead_id
    AND task.status = 'dispatching' AND task.usage_hold_id = hold_record.id
    AND hold_record.status = 'held';
  UPDATE enterprise.marketing_call_tasks task
  SET status = 'cancelled', outcome_code = 'consent_revoked',
    claimed_at = NULL, claim_owner = NULL, claim_token_hash = NULL,
    lease_expires_at = NULL, usage_hold_id = NULL,
    updated_at = GREATEST(NEW.revoked_at, task.updated_at + interval '1 millisecond'),
    version = task.version + 1
  WHERE task.tenant_id = NEW.tenant_id AND task.campaign_id = NEW.campaign_id
    AND task.lead_id = NEW.lead_id
    AND task.status IN ('pending', 'scheduled', 'retry', 'dispatching')
    AND NOT EXISTS (
      SELECT 1 FROM enterprise.contact_consents consent
      WHERE consent.tenant_id = task.tenant_id AND consent.campaign_id = task.campaign_id
        AND consent.lead_id = task.lead_id
        AND consent.purpose = 'automated_marketing_call'
        AND consent.granted_at <= task.scheduled_at
        AND (consent.expires_at IS NULL OR consent.expires_at > task.scheduled_at)
        AND consent.revoked_at IS NULL);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_suppression_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cancelled_count integer;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    RAISE EXCEPTION 'enterprise marketing suppression is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.lead_id IS NULL OR NEW.updated_at IS DISTINCT FROM NEW.created_at OR
    NEW.version <> 1 OR NEW.cancelled_task_count <> 0 OR NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_leads lead
      WHERE lead.tenant_id = NEW.tenant_id AND lead.id = NEW.lead_id
        AND lead.phone_hash = NEW.phone_hash) OR (NEW.scope = 'tenant' AND NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaign_leads link
      WHERE link.tenant_id = NEW.tenant_id AND link.campaign_id = NEW.origin_campaign_id
        AND link.lead_id = NEW.lead_id AND link.status = 'active')) THEN
    RAISE EXCEPTION 'invalid enterprise marketing suppression creation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':marketing-suppression:' || NEW.phone_hash, 0));
  UPDATE enterprise.usage_holds hold_record
  SET status = 'released',
    released_at = GREATEST(NEW.created_at, hold_record.updated_at),
    updated_at = GREATEST(NEW.created_at, hold_record.updated_at),
    version = hold_record.version + 1
  FROM enterprise.marketing_call_tasks task
  JOIN enterprise.marketing_leads lead
    ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
  WHERE hold_record.tenant_id = NEW.tenant_id AND task.usage_hold_id = hold_record.id
    AND lead.phone_hash = NEW.phone_hash AND task.status = 'dispatching'
    AND hold_record.status = 'held';
  UPDATE enterprise.marketing_call_tasks task
  SET status = 'cancelled', outcome_code = 'suppressed', claimed_at = NULL,
    claim_owner = NULL, claim_token_hash = NULL, lease_expires_at = NULL,
    usage_hold_id = NULL,
    updated_at = GREATEST(NEW.created_at, task.updated_at + interval '1 millisecond')
  FROM enterprise.marketing_leads lead
  WHERE task.tenant_id = NEW.tenant_id AND lead.tenant_id = task.tenant_id
    AND lead.id = task.lead_id AND lead.phone_hash = NEW.phone_hash
    AND task.status IN ('pending', 'scheduled', 'retry', 'dispatching');
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  NEW.cancelled_task_count := cancelled_count;
  RETURN NEW;
END;
$$;
