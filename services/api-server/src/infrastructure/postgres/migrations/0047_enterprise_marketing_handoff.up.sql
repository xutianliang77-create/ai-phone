CREATE TABLE enterprise.marketing_handoff_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  support_queue_id uuid NOT NULL,
  support_channel_id uuid NOT NULL,
  timeout_seconds integer NOT NULL CHECK (timeout_seconds BETWEEN 10 AND 86400),
  timeout_action text NOT NULL CHECK (timeout_action IN ('end_call', 'callback')),
  callback_delay_seconds integer CHECK (
    (timeout_action = 'end_call' AND callback_delay_seconds IS NULL) OR
    (timeout_action = 'callback' AND callback_delay_seconds BETWEEN 60 AND 604800)
  ),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  creation_key text NOT NULL CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
  last_command_key text NOT NULL CHECK (
    last_command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  last_command_hash text NOT NULL CHECK (last_command_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id),
  UNIQUE (tenant_id, created_by, creation_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, support_queue_id)
    REFERENCES enterprise.support_queues (tenant_id, id),
  FOREIGN KEY (tenant_id, support_channel_id)
    REFERENCES enterprise.support_channels (tenant_id, id),
  CHECK (updated_at >= created_at)
);

CREATE TABLE enterprise.marketing_handoffs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  marketing_agent_run_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  communication_session_id text NOT NULL CHECK (
    length(btrim(communication_session_id)) BETWEEN 1 AND 160
  ),
  support_session_id uuid NOT NULL,
  support_queue_id uuid NOT NULL,
  support_channel_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version bigint NOT NULL CHECK (policy_version > 0),
  timeout_action text NOT NULL CHECK (timeout_action IN ('end_call', 'callback')),
  callback_delay_seconds integer,
  status text NOT NULL CHECK (status IN (
    'queued', 'media_not_ready', 'active', 'timed_out',
    'callback_required', 'failed', 'completed'
  )),
  ai_fenced_at timestamptz NOT NULL,
  timeout_at timestamptz NOT NULL,
  media_requested_at timestamptz,
  media_ai_stopped_at timestamptz,
  media_completed_at timestamptz,
  provider_fingerprint text CHECK (
    provider_fingerprint IS NULL OR
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  provider_receipt_hash text CHECK (
    provider_receipt_hash IS NULL OR provider_receipt_hash ~ '^[a-f0-9]{64}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, marketing_agent_run_id),
  UNIQUE (tenant_id, dispatch_id),
  UNIQUE (tenant_id, support_session_id),
  FOREIGN KEY (tenant_id, marketing_agent_run_id)
    REFERENCES enterprise.marketing_agent_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, dispatch_id)
    REFERENCES enterprise.marketing_pstn_dispatches (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, support_queue_id)
    REFERENCES enterprise.support_queues (tenant_id, id),
  FOREIGN KEY (tenant_id, support_channel_id)
    REFERENCES enterprise.support_channels (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_id)
    REFERENCES enterprise.marketing_handoff_policies (tenant_id, id),
  CHECK (callback_delay_seconds IS NULL OR
    callback_delay_seconds BETWEEN 60 AND 604800),
  CHECK (timeout_at > ai_fenced_at AND updated_at >= created_at),
  CHECK (
    (status = 'queued' AND media_requested_at IS NULL AND
      media_ai_stopped_at IS NULL AND media_completed_at IS NULL AND
      provider_fingerprint IS NULL AND
      provider_receipt_hash IS NULL AND failure_code IS NULL) OR
    (status = 'media_not_ready' AND media_requested_at IS NOT NULL AND
      media_ai_stopped_at IS NULL AND media_completed_at IS NULL AND
      provider_receipt_hash IS NULL AND
      failure_code IS NOT NULL) OR
    (status = 'active' AND media_requested_at IS NOT NULL AND
      media_ai_stopped_at IS NOT NULL AND media_completed_at IS NOT NULL AND
      provider_fingerprint IS NOT NULL AND
      provider_receipt_hash IS NOT NULL AND failure_code IS NULL) OR
    (status IN ('timed_out', 'callback_required', 'failed') AND
      failure_code IS NOT NULL) OR
    (status = 'completed' AND media_ai_stopped_at IS NOT NULL AND
      media_completed_at IS NOT NULL)
  ),
  CHECK (media_ai_stopped_at IS NULL OR
    (media_requested_at IS NOT NULL AND media_ai_stopped_at >= media_requested_at)),
  CHECK (media_completed_at IS NULL OR
    (media_ai_stopped_at IS NOT NULL AND media_completed_at >= media_ai_stopped_at))
);
CREATE INDEX marketing_handoffs_recovery_idx ON enterprise.marketing_handoffs
  (tenant_id, status, timeout_at, id)
  WHERE status IN ('queued', 'media_not_ready');

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_handoff_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NOT enterprise.is_account_subject_id(enterprise.current_user_id()) OR NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
        AND campaign.status = 'draft' AND campaign.approval_status = 'not_submitted'
    ) OR NOT EXISTS (
      SELECT 1 FROM enterprise.support_queues queue_record
      JOIN enterprise.support_channels channel_record
        ON channel_record.tenant_id = queue_record.tenant_id
      WHERE queue_record.tenant_id = NEW.tenant_id
        AND queue_record.id = NEW.support_queue_id AND queue_record.status = 'active'
        AND channel_record.id = NEW.support_channel_id
        AND channel_record.status = 'active' AND channel_record.channel_type = 'pstn'
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing handoff policy mutation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR NEW.version <> 1 OR
      NEW.updated_at IS DISTINCT FROM NEW.created_at OR
      NEW.last_command_key IS DISTINCT FROM NEW.creation_key OR
      NEW.last_command_hash IS DISTINCT FROM NEW.creation_request_hash THEN
      RAISE EXCEPTION 'invalid enterprise marketing handoff policy creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.created_by,
      NEW.creation_key, NEW.creation_request_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.created_by,
      OLD.creation_key, OLD.creation_request_hash, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise marketing handoff policy version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_handoff_policies_guard
  BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_handoff_policies
  FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_handoff_policy();

CREATE OR REPLACE FUNCTION enterprise.marketing_handoff_policy_is_ready(
  target_campaign_id uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM enterprise.marketing_handoff_policies policy
    JOIN enterprise.support_queues queue_record
      ON queue_record.tenant_id = policy.tenant_id
      AND queue_record.id = policy.support_queue_id
    JOIN enterprise.support_channels channel_record
      ON channel_record.tenant_id = policy.tenant_id
      AND channel_record.id = policy.support_channel_id
    WHERE policy.tenant_id = enterprise.current_tenant_id()
      AND policy.campaign_id = target_campaign_id AND queue_record.status = 'active'
      AND channel_record.status = 'active' AND channel_record.channel_type = 'pstn'
  )
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_campaign_handoff_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((OLD.status = 'draft' AND NEW.status = 'validating') OR
      (OLD.status = 'pending_approval' AND NEW.status = 'approved') OR
      (OLD.status = 'approved' AND NEW.status = 'scheduled')) AND
    NOT enterprise.marketing_handoff_policy_is_ready(NEW.id) THEN
    RAISE EXCEPTION 'ready enterprise marketing handoff policy required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_campaigns_handoff_policy_guard
  BEFORE UPDATE ON enterprise.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_campaign_handoff_policy();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_handoff()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise marketing handoff cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF enterprise.current_user_id() <> 'system:enterprise-marketing-agent' OR
      NEW.status <> 'queued' OR NEW.version <> 1 OR
      NEW.updated_at IS DISTINCT FROM NEW.created_at OR NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_agent_runs run
        JOIN enterprise.marketing_agent_turns turn
          ON turn.tenant_id = run.tenant_id AND turn.run_id = run.id
        JOIN enterprise.support_sessions session_record
          ON session_record.tenant_id = run.tenant_id
          AND session_record.id = NEW.support_session_id
        WHERE run.tenant_id = NEW.tenant_id AND run.id = NEW.marketing_agent_run_id
          AND run.dispatch_id = NEW.dispatch_id AND run.campaign_id = NEW.campaign_id
          AND run.lead_id = NEW.lead_id
          AND run.communication_session_id = NEW.communication_session_id
          AND run.status = 'handoff_requested' AND turn.action = 'handoff'
          AND turn.status = 'delivered' AND turn.delivered_at = NEW.ai_fenced_at
          AND session_record.status = 'handoff_requested'
          AND session_record.queue_id = NEW.support_queue_id
          AND session_record.channel_id = NEW.support_channel_id
      ) THEN RAISE EXCEPTION 'invalid enterprise marketing handoff creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.marketing_agent_run_id, NEW.dispatch_id,
      NEW.campaign_id, NEW.lead_id, NEW.communication_session_id,
      NEW.support_session_id, NEW.support_queue_id, NEW.support_channel_id,
      NEW.policy_id, NEW.policy_version, NEW.timeout_action,
      NEW.callback_delay_seconds, NEW.ai_fenced_at, NEW.timeout_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.marketing_agent_run_id,
      OLD.dispatch_id, OLD.campaign_id, OLD.lead_id, OLD.communication_session_id,
      OLD.support_session_id, OLD.support_queue_id, OLD.support_channel_id,
      OLD.policy_id, OLD.policy_version, OLD.timeout_action,
      OLD.callback_delay_seconds, OLD.ai_fenced_at, OLD.timeout_at, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at OR NOT (
      NEW.status = OLD.status OR
      (OLD.status IN ('queued', 'media_not_ready') AND
        NEW.status IN ('media_not_ready', 'active', 'timed_out',
          'callback_required', 'failed')) OR
      (OLD.status = 'active' AND NEW.status IN ('completed', 'failed'))
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing handoff transition';
  END IF;
  IF enterprise.is_account_subject_id(enterprise.current_user_id()) THEN
    IF NOT EXISTS (
      SELECT 1 FROM enterprise.support_sessions session_record
      JOIN enterprise.support_agent_claims claim
        ON claim.tenant_id = session_record.tenant_id
        AND claim.id = session_record.active_agent_claim_id
      WHERE session_record.tenant_id = NEW.tenant_id
        AND session_record.id = NEW.support_session_id
        AND session_record.status = 'human_active' AND claim.status = 'active'
        AND (claim.agent_user_id = enterprise.current_user_id() OR EXISTS (
          SELECT 1 FROM enterprise.members member_record
          WHERE member_record.tenant_id = NEW.tenant_id
            AND member_record.user_id = enterprise.current_user_id()
            AND member_record.status = 'active'
            AND member_record.role IN ('owner', 'admin', 'support_manager')
        ))
    ) OR NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_agent_runs run
      WHERE run.tenant_id = NEW.tenant_id
        AND run.id = NEW.marketing_agent_run_id
        AND run.communication_session_id = NEW.communication_session_id
        AND run.status = 'handoff_requested'
    ) THEN RAISE EXCEPTION 'marketing handoff agent claim or AI fence is not active';
    END IF;
  ELSIF enterprise.current_user_id() = 'system:enterprise-marketing-handoff' THEN
    IF NEW.status NOT IN ('timed_out', 'callback_required') OR NOT EXISTS (
      SELECT 1 FROM enterprise.support_sessions session_record
      WHERE session_record.tenant_id = NEW.tenant_id
        AND session_record.id = NEW.support_session_id
        AND session_record.status = 'ended'
        AND session_record.active_agent_claim_id IS NULL
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing handoff timeout';
    END IF;
  ELSE RAISE EXCEPTION 'invalid enterprise marketing handoff actor';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_handoffs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_handoffs
  FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_handoff();

ALTER TABLE enterprise.marketing_handoff_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_handoff_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_handoff_policies_tenant_isolation
  ON enterprise.marketing_handoff_policies
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
ALTER TABLE enterprise.marketing_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.marketing_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY marketing_handoffs_tenant_isolation ON enterprise.marketing_handoffs
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
