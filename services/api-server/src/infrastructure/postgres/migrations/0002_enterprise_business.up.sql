CREATE TABLE enterprise.marketing_campaigns (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL,
  objective text NOT NULL,
  owner_user_id uuid NOT NULL,
  country_codes text[] NOT NULL,
  language_codes text[] NOT NULL,
  status text NOT NULL,
  approval_status text NOT NULL,
  policy_version text,
  schedule jsonb NOT NULL DEFAULT '{}',
  concurrency_limit integer NOT NULL CHECK (concurrency_limit > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE INDEX marketing_campaigns_tenant_status_idx
  ON enterprise.marketing_campaigns (tenant_id, status, updated_at, id);

CREATE TABLE enterprise.marketing_leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  external_id text,
  phone_e164_encrypted bytea NOT NULL,
  phone_hash text NOT NULL,
  country_code text NOT NULL,
  timezone text,
  language text,
  attributes jsonb NOT NULL DEFAULT '{}',
  source_id uuid,
  status text NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX marketing_leads_tenant_external_unique_idx
  ON enterprise.marketing_leads (tenant_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX marketing_leads_tenant_status_idx
  ON enterprise.marketing_leads (tenant_id, status, id);

CREATE TABLE enterprise.contact_consents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  lead_id uuid NOT NULL,
  purpose text NOT NULL,
  channel text NOT NULL,
  evidence_object_id uuid NOT NULL,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  policy_version text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id)
);
CREATE INDEX contact_consents_tenant_lead_idx
  ON enterprise.contact_consents (tenant_id, lead_id, revoked_at, expires_at, id);

CREATE TABLE enterprise.suppression_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  phone_hash text NOT NULL,
  scope text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, phone_hash, scope)
);
CREATE INDEX suppression_entries_tenant_created_idx
  ON enterprise.suppression_entries (tenant_id, created_at, id);

CREATE TABLE enterprise.marketing_call_tasks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  translation_session_id uuid,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  idempotency_key text NOT NULL,
  outcome_code text,
  claimed_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, campaign_id, lead_id, attempt),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id)
);
CREATE INDEX marketing_call_tasks_tenant_due_idx
  ON enterprise.marketing_call_tasks (tenant_id, status, scheduled_at, id);

CREATE TABLE enterprise.marketing_outcomes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  task_id uuid NOT NULL,
  intent_level text,
  disposition text NOT NULL,
  summary text,
  next_action text,
  follow_up_at timestamptz,
  evidence_segment_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, task_id),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES enterprise.marketing_call_tasks (tenant_id, id)
);
CREATE INDEX marketing_outcomes_tenant_created_idx
  ON enterprise.marketing_outcomes (tenant_id, created_at, id);

CREATE TABLE enterprise.support_channels (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  channel_type text NOT NULL,
  provider text NOT NULL,
  config_ref text NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE INDEX support_channels_tenant_status_idx
  ON enterprise.support_channels (tenant_id, status, id);

CREATE TABLE enterprise.customer_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  external_id text,
  phone_hash text,
  display_name text,
  locale text,
  attributes jsonb NOT NULL DEFAULT '{}',
  consent_scope text[] NOT NULL DEFAULT '{}',
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX customer_profiles_tenant_external_unique_idx
  ON enterprise.customer_profiles (tenant_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX customer_profiles_tenant_external_idx
  ON enterprise.customer_profiles (tenant_id, external_id, id);

CREATE TABLE enterprise.support_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  customer_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  translation_session_id uuid,
  status text NOT NULL,
  queue_id uuid,
  assigned_user_id uuid,
  intent text,
  priority integer NOT NULL DEFAULT 0,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)
    REFERENCES enterprise.customer_profiles (tenant_id, id),
  FOREIGN KEY (tenant_id, channel_id)
    REFERENCES enterprise.support_channels (tenant_id, id)
);
CREATE INDEX support_sessions_tenant_queue_idx
  ON enterprise.support_sessions (tenant_id, status, queue_id, priority DESC, id);

CREATE TABLE enterprise.support_cases (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  customer_id uuid NOT NULL,
  session_id uuid,
  subject text NOT NULL,
  status text NOT NULL,
  summary text,
  resolution text,
  external_ticket_id text,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)
    REFERENCES enterprise.customer_profiles (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id)
);
CREATE INDEX support_cases_tenant_status_idx
  ON enterprise.support_cases (tenant_id, status, id);

CREATE TABLE enterprise.tool_executions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  session_id uuid NOT NULL,
  tool_name text NOT NULL,
  risk_level text NOT NULL,
  request_hash text NOT NULL,
  confirmation_status text NOT NULL,
  status text NOT NULL,
  external_result_ref text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id)
);
CREATE INDEX tool_executions_tenant_status_idx
  ON enterprise.tool_executions (tenant_id, status, created_at, id);

CREATE TABLE enterprise.meetings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  title text NOT NULL,
  host_user_id uuid NOT NULL,
  translation_session_id uuid,
  scheduled_at timestamptz,
  status text NOT NULL,
  policy jsonb NOT NULL DEFAULT '{}',
  retention_until timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE INDEX meetings_tenant_status_idx
  ON enterprise.meetings (tenant_id, status, scheduled_at, id);

CREATE TABLE enterprise.meeting_participants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  user_id uuid,
  external_identity text,
  role text NOT NULL,
  language text,
  display_name text NOT NULL,
  joined_at timestamptz,
  left_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id),
  CHECK (user_id IS NOT NULL OR external_identity IS NOT NULL)
);
CREATE INDEX meeting_participants_tenant_meeting_idx
  ON enterprise.meeting_participants (tenant_id, meeting_id, joined_at, id);

CREATE TABLE enterprise.meeting_screen_shares (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  track_sid text,
  source_type text NOT NULL,
  includes_system_audio boolean NOT NULL DEFAULT false,
  quality_mode text NOT NULL,
  status text NOT NULL,
  lease_expires_at timestamptz,
  started_at timestamptz,
  paused_at timestamptz,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id),
  FOREIGN KEY (tenant_id, participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, id)
);
CREATE UNIQUE INDEX meeting_screen_shares_tenant_active_idx
  ON enterprise.meeting_screen_shares (tenant_id, meeting_id)
  WHERE status IN ('active', 'paused');

CREATE TABLE enterprise.meeting_artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  artifact_type text NOT NULL,
  object_id uuid NOT NULL,
  provider_fingerprint text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id)
);
CREATE INDEX meeting_artifacts_tenant_meeting_idx
  ON enterprise.meeting_artifacts (tenant_id, meeting_id, status, created_at, id);

CREATE TABLE enterprise.meeting_action_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  owner_participant_id uuid,
  item_text text NOT NULL,
  due_at timestamptz,
  status text NOT NULL,
  evidence_segment_ids uuid[] NOT NULL DEFAULT '{}',
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, id)
);
CREATE INDEX meeting_action_items_tenant_meeting_idx
  ON enterprise.meeting_action_items (tenant_id, meeting_id, status, due_at, id);
