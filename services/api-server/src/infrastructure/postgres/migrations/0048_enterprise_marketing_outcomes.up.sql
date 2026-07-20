ALTER TABLE enterprise.marketing_outcomes
  ADD COLUMN campaign_id uuid,
  ADD COLUMN lead_id uuid,
  ADD COLUMN dispatch_id uuid,
  ADD COLUMN agent_run_id uuid,
  ADD COLUMN communication_session_id text,
  ADD COLUMN evidence_document jsonb,
  ADD COLUMN evidence_hash text,
  ADD COLUMN source_hash text,
  ADD COLUMN evidence_status text,
  ADD COLUMN created_by text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN version bigint;

UPDATE enterprise.marketing_outcomes outcome
SET campaign_id = task.campaign_id,
  lead_id = task.lead_id,
  evidence_document = jsonb_build_object(
    'selected', jsonb_build_array(jsonb_build_object(
      'type', 'dispatch', 'id', outcome.task_id::text,
      'contentHash', repeat('0', 64)
    )),
    'legacy', true
  ),
  evidence_hash = repeat('0', 64),
  source_hash = repeat('0', 64),
  evidence_status = 'legacy_unverified',
  created_by = 'system:legacy-import',
  idempotency_key = 'legacy:' || outcome.id::text,
  request_hash = repeat('0', 64),
  updated_at = outcome.created_at,
  version = 1
FROM enterprise.marketing_call_tasks task
WHERE task.tenant_id = outcome.tenant_id AND task.id = outcome.task_id;

UPDATE enterprise.marketing_outcomes outcome
SET dispatch_id = dispatch.id,
  communication_session_id = dispatch.communication_session_id
FROM enterprise.marketing_pstn_dispatches dispatch
WHERE dispatch.tenant_id = outcome.tenant_id
  AND dispatch.task_id = outcome.task_id
  AND dispatch.id = (
    SELECT candidate.id FROM enterprise.marketing_pstn_dispatches candidate
    WHERE candidate.tenant_id = outcome.tenant_id
      AND candidate.task_id = outcome.task_id
    ORDER BY candidate.dispatch_generation DESC, candidate.id DESC LIMIT 1
  );

UPDATE enterprise.marketing_outcomes outcome
SET agent_run_id = run.id
FROM enterprise.marketing_agent_runs run
WHERE run.tenant_id = outcome.tenant_id
  AND run.dispatch_id = outcome.dispatch_id;

ALTER TABLE enterprise.marketing_outcomes
  ALTER COLUMN evidence_document SET DEFAULT '{"selected":[]}'::jsonb,
  ADD CONSTRAINT marketing_outcomes_campaign_fk
    FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  ADD CONSTRAINT marketing_outcomes_lead_fk
    FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  ADD CONSTRAINT marketing_outcomes_dispatch_fk
    FOREIGN KEY (tenant_id, dispatch_id)
    REFERENCES enterprise.marketing_pstn_dispatches (tenant_id, id),
  ADD CONSTRAINT marketing_outcomes_agent_run_fk
    FOREIGN KEY (tenant_id, agent_run_id)
    REFERENCES enterprise.marketing_agent_runs (tenant_id, id),
  ADD CONSTRAINT marketing_outcomes_evidence_status_check
    CHECK (evidence_status IN ('verified', 'legacy_unverified')),
  ADD CONSTRAINT marketing_outcomes_evidence_document_check
    CHECK (evidence_document IS NULL OR (
      jsonb_typeof(evidence_document) = 'object' AND
      jsonb_typeof(evidence_document -> 'selected') = 'array' AND
      octet_length(evidence_document::text) <= 32768
    )),
  ADD CONSTRAINT marketing_outcomes_evidence_hash_check
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT marketing_outcomes_source_hash_check
    CHECK (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT marketing_outcomes_request_hash_check
    CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT marketing_outcomes_version_check
    CHECK (version IS NULL OR version > 0),
  ADD CONSTRAINT marketing_outcomes_updated_check
    CHECK (updated_at IS NULL OR updated_at >= created_at);

CREATE UNIQUE INDEX marketing_outcomes_actor_command_unique_idx
  ON enterprise.marketing_outcomes (tenant_id, created_by, idempotency_key)
  WHERE created_by IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX marketing_outcomes_campaign_created_idx
  ON enterprise.marketing_outcomes (tenant_id, campaign_id, created_at DESC, id)
  WHERE campaign_id IS NOT NULL;

CREATE TABLE enterprise.marketing_next_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  outcome_id uuid NOT NULL,
  task_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'callback', 'appointment_request', 'send_material', 'manual_review'
  )),
  status text NOT NULL CHECK (status = 'requested'),
  due_at timestamptz,
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, outcome_id),
  UNIQUE (tenant_id, task_id),
  UNIQUE (tenant_id, created_by, idempotency_key),
  FOREIGN KEY (tenant_id, outcome_id)
    REFERENCES enterprise.marketing_outcomes (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES enterprise.marketing_call_tasks (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  CHECK ((kind IN ('callback', 'appointment_request') AND due_at IS NOT NULL) OR
    (kind IN ('send_material', 'manual_review')))
);
CREATE INDEX marketing_next_actions_campaign_status_idx
  ON enterprise.marketing_next_actions
    (tenant_id, campaign_id, status, due_at, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_outcome()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_count integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'enterprise marketing outcome is append-only';
  END IF;
  IF NEW.evidence_document IS NULL OR
    jsonb_typeof(NEW.evidence_document) <> 'object' OR
    jsonb_typeof(NEW.evidence_document -> 'selected') <> 'array' THEN
    RAISE EXCEPTION 'invalid enterprise marketing outcome evidence document';
  END IF;
  selected_count := jsonb_array_length(NEW.evidence_document -> 'selected');
  IF NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NOT enterprise.is_account_subject_id(enterprise.current_user_id()) OR
    NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.evidence_status <> 'verified' OR NEW.version <> 1 OR
    NEW.updated_at IS DISTINCT FROM NEW.created_at OR
    NEW.campaign_id IS NULL OR NEW.lead_id IS NULL OR NEW.dispatch_id IS NULL OR
    NEW.communication_session_id IS NULL OR NEW.evidence_hash IS NULL OR
    NEW.source_hash IS NULL OR NEW.request_hash IS NULL OR
    selected_count < 1 OR selected_count > 32 OR
    NEW.disposition NOT IN ('no_interest', 'potential_lead',
      'appointment_requested', 'follow_up_required', 'do_not_contact',
      'invalid_number', 'call_failed', 'completed_unclassified') OR
    NEW.intent_level NOT IN ('none', 'low', 'medium', 'high', 'unknown') OR
    NEW.summary IS NULL OR octet_length(btrim(NEW.summary)) NOT BETWEEN 1 AND 2000 OR
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        NEW.evidence_document -> 'selected') item
      WHERE item ->> 'type' IS NULL OR item ->> 'type' NOT IN (
          'transcript_segment', 'agent_turn',
          'dispatch', 'agent_run', 'suppression', 'handoff')
        OR item ->> 'id' IS NULL
        OR item ->> 'id' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        OR item ->> 'contentHash' IS NULL
        OR item ->> 'contentHash' !~ '^[a-f0-9]{64}$'
    ) OR
    (NEW.disposition IN ('no_interest', 'do_not_contact', 'invalid_number') AND
      NEW.next_action IS NOT NULL) OR
    (NEW.disposition = 'appointment_requested' AND
      (NEW.intent_level NOT IN ('medium', 'high') OR
        NEW.next_action <> 'appointment_request')) OR
    (NEW.disposition = 'potential_lead' AND
      NEW.intent_level NOT IN ('low', 'medium', 'high')) OR
    (NEW.disposition = 'follow_up_required' AND NEW.next_action IS NULL) OR
    (NEW.disposition = 'call_failed' AND NEW.next_action IS NOT NULL AND
      NEW.next_action <> 'manual_review') OR
    (NEW.disposition IN ('no_interest', 'do_not_contact', 'invalid_number',
      'call_failed') AND NEW.intent_level NOT IN ('none', 'unknown')) OR
    (NEW.next_action IN ('callback', 'appointment_request') AND
      NEW.follow_up_at IS NULL) OR
    NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_call_tasks task
      JOIN enterprise.marketing_pstn_dispatches dispatch
        ON dispatch.tenant_id = task.tenant_id AND dispatch.task_id = task.id
      WHERE task.tenant_id = NEW.tenant_id AND task.id = NEW.task_id
        AND task.campaign_id = NEW.campaign_id AND task.lead_id = NEW.lead_id
        AND task.status IN ('completed', 'failed')
        AND dispatch.id = NEW.dispatch_id
        AND dispatch.campaign_id = NEW.campaign_id
        AND dispatch.communication_session_id = NEW.communication_session_id
        AND dispatch.status IN ('completed', 'failed')
        AND dispatch.ended_at IS NOT NULL
    ) OR
    (NEW.agent_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_agent_runs run
      LEFT JOIN enterprise.marketing_handoffs handoff
        ON handoff.tenant_id = run.tenant_id
        AND handoff.marketing_agent_run_id = run.id
      WHERE run.tenant_id = NEW.tenant_id AND run.id = NEW.agent_run_id
        AND run.dispatch_id = NEW.dispatch_id AND run.task_id = NEW.task_id
        AND run.campaign_id = NEW.campaign_id AND run.lead_id = NEW.lead_id
        AND run.communication_session_id = NEW.communication_session_id
        AND (run.status IN ('completed', 'failed', 'cancelled') OR
          (run.status = 'handoff_requested' AND handoff.status IN
            ('completed', 'timed_out', 'callback_required', 'failed')))
    )) THEN
    RAISE EXCEPTION 'invalid enterprise marketing outcome evidence';
  END IF;
  IF NEW.disposition = 'do_not_contact' AND NOT EXISTS (
    SELECT 1 FROM enterprise.suppression_entries suppression
    WHERE suppression.tenant_id = NEW.tenant_id
      AND suppression.lead_id = NEW.lead_id
  ) THEN RAISE EXCEPTION 'marketing outcome suppression evidence required';
  END IF;
  IF NEW.disposition = 'invalid_number' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
    WHERE dispatch.tenant_id = NEW.tenant_id AND dispatch.id = NEW.dispatch_id
      AND dispatch.status = 'failed' AND dispatch.failure_code IN
        ('invalid_number', 'invalid_phone_number', 'unallocated_number',
          'number_not_in_service', 'number_unreachable')
  ) THEN RAISE EXCEPTION 'marketing outcome invalid number evidence required';
  END IF;
  IF NEW.disposition IN ('no_interest', 'potential_lead',
      'appointment_requested') AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      NEW.evidence_document -> 'selected') item
    WHERE item ->> 'type' = 'transcript_segment'
  ) THEN RAISE EXCEPTION 'marketing outcome customer evidence required';
  END IF;
  IF NEW.disposition = 'follow_up_required' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      NEW.evidence_document -> 'selected') item
    WHERE item ->> 'type' = 'transcript_segment'
  ) AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_handoffs handoff
    WHERE handoff.tenant_id = NEW.tenant_id
      AND handoff.dispatch_id = NEW.dispatch_id
      AND handoff.status = 'callback_required'
  ) THEN RAISE EXCEPTION 'marketing outcome follow-up evidence required';
  END IF;
  IF NEW.disposition = 'call_failed' AND NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
    LEFT JOIN enterprise.marketing_agent_runs run
      ON run.tenant_id = dispatch.tenant_id
      AND run.dispatch_id = dispatch.id
    WHERE dispatch.tenant_id = NEW.tenant_id AND dispatch.id = NEW.dispatch_id
      AND (dispatch.status = 'failed' OR run.status IN ('failed', 'cancelled'))
  ) THEN RAISE EXCEPTION 'marketing outcome failure evidence required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_outcomes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_outcomes
  FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_outcome();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR
    NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NOT enterprise.is_account_subject_id(enterprise.current_user_id()) OR
    NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR
    NEW.status <> 'requested' OR
    NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_outcomes outcome
      WHERE outcome.tenant_id = NEW.tenant_id AND outcome.id = NEW.outcome_id
        AND outcome.task_id = NEW.task_id AND outcome.campaign_id = NEW.campaign_id
        AND outcome.lead_id = NEW.lead_id
        AND outcome.created_by = NEW.created_by
        AND outcome.evidence_hash = NEW.evidence_hash
        AND outcome.next_action = NEW.kind
        AND outcome.follow_up_at IS NOT DISTINCT FROM NEW.due_at
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing next action';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_next_actions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_next_actions
  FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_next_action();

CREATE OR REPLACE FUNCTION enterprise.validate_marketing_outcome_next_action()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.next_action IS NULL AND EXISTS (
      SELECT 1 FROM enterprise.marketing_next_actions action_record
      WHERE action_record.tenant_id = NEW.tenant_id
        AND action_record.outcome_id = NEW.id
    )) OR (NEW.next_action IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_next_actions action_record
      WHERE action_record.tenant_id = NEW.tenant_id
        AND action_record.outcome_id = NEW.id
        AND action_record.kind = NEW.next_action
        AND action_record.due_at IS NOT DISTINCT FROM NEW.follow_up_at
    )) THEN RAISE EXCEPTION 'marketing outcome next action is incomplete';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER marketing_outcomes_next_action_consistency
  AFTER INSERT ON enterprise.marketing_outcomes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enterprise.validate_marketing_outcome_next_action();

ALTER TABLE enterprise.marketing_next_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_next_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_next_actions_tenant_isolation
  ON enterprise.marketing_next_actions
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
