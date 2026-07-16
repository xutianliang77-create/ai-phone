CREATE OR REPLACE FUNCTION enterprise.is_account_subject_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value ~
    '^user_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE OR REPLACE FUNCTION enterprise.is_actor_subject_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT enterprise.is_account_subject_id(value) OR value ~
    '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
$$;

DROP POLICY user_tenant_directory_self_read
  ON enterprise.user_tenant_directory;
DROP FUNCTION enterprise.current_user_id();

ALTER TABLE enterprise.members
  ALTER COLUMN user_id TYPE text USING ('user_' || user_id::text);
ALTER TABLE enterprise.user_tenant_directory
  ALTER COLUMN user_id TYPE text USING ('user_' || user_id::text);
ALTER TABLE enterprise.knowledge_sources
  ALTER COLUMN created_by TYPE text USING ('user_' || created_by::text);
ALTER TABLE enterprise.marketing_campaigns
  ALTER COLUMN owner_user_id TYPE text
    USING ('user_' || owner_user_id::text);
ALTER TABLE enterprise.support_sessions
  ALTER COLUMN assigned_user_id TYPE text
    USING (
      CASE WHEN assigned_user_id IS NULL
        THEN NULL
        ELSE 'user_' || assigned_user_id::text
      END
    );
ALTER TABLE enterprise.meetings
  ALTER COLUMN host_user_id TYPE text
    USING ('user_' || host_user_id::text);
ALTER TABLE enterprise.meeting_participants
  ALTER COLUMN user_id TYPE text
    USING (
      CASE WHEN user_id IS NULL THEN NULL ELSE 'user_' || user_id::text END
    );
ALTER TABLE enterprise.tenant_jobs
  ALTER COLUMN actor_id TYPE text USING ('user_' || actor_id::text);
ALTER TABLE enterprise.platform_pending_work
  ALTER COLUMN actor_id TYPE text
    USING (
      CASE WHEN actor_id IS NULL THEN NULL ELSE 'user_' || actor_id::text END
    );

ALTER TABLE enterprise.policy_decisions
  ALTER COLUMN actor_id TYPE text
    USING (
      CASE WHEN actor_id IS NULL THEN NULL ELSE 'user_' || actor_id::text END
    );
ALTER TABLE enterprise.audit_events
  ALTER COLUMN actor_id TYPE text
    USING (
      CASE WHEN actor_id IS NULL THEN NULL ELSE 'user_' || actor_id::text END
    );
ALTER TABLE enterprise.idempotency_keys
  ALTER COLUMN actor_id TYPE text USING ('user_' || actor_id::text);

CREATE OR REPLACE FUNCTION enterprise.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;

CREATE POLICY user_tenant_directory_self_read
  ON enterprise.user_tenant_directory
  FOR SELECT
  USING (user_id = enterprise.current_user_id());

ALTER TABLE enterprise.members
  ADD CONSTRAINT members_user_subject_check
    CHECK (enterprise.is_account_subject_id(user_id));
ALTER TABLE enterprise.user_tenant_directory
  ADD CONSTRAINT user_tenant_directory_user_subject_check
    CHECK (enterprise.is_account_subject_id(user_id));
ALTER TABLE enterprise.knowledge_sources
  ADD CONSTRAINT knowledge_sources_created_by_subject_check
    CHECK (enterprise.is_account_subject_id(created_by));
ALTER TABLE enterprise.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_owner_subject_check
    CHECK (enterprise.is_account_subject_id(owner_user_id));
ALTER TABLE enterprise.support_sessions
  ADD CONSTRAINT support_sessions_assigned_subject_check
    CHECK (
      assigned_user_id IS NULL OR
      enterprise.is_account_subject_id(assigned_user_id)
    );
ALTER TABLE enterprise.meetings
  ADD CONSTRAINT meetings_host_subject_check
    CHECK (enterprise.is_account_subject_id(host_user_id));
ALTER TABLE enterprise.meeting_participants
  ADD CONSTRAINT meeting_participants_user_subject_check
    CHECK (
      user_id IS NULL OR enterprise.is_account_subject_id(user_id)
    );
ALTER TABLE enterprise.tenant_jobs
  ADD CONSTRAINT tenant_jobs_actor_subject_check
    CHECK (enterprise.is_account_subject_id(actor_id));
ALTER TABLE enterprise.platform_pending_work
  ADD CONSTRAINT platform_pending_work_actor_subject_check
    CHECK (
      actor_id IS NULL OR enterprise.is_account_subject_id(actor_id)
    );

ALTER TABLE enterprise.policy_decisions
  ADD CONSTRAINT policy_decisions_actor_subject_check
    CHECK (
      actor_id IS NULL OR enterprise.is_actor_subject_id(actor_id)
    );
ALTER TABLE enterprise.audit_events
  ADD CONSTRAINT audit_events_actor_subject_check
    CHECK (
      actor_id IS NULL OR enterprise.is_actor_subject_id(actor_id)
    );
ALTER TABLE enterprise.idempotency_keys
  ADD CONSTRAINT idempotency_keys_actor_subject_check
    CHECK (enterprise.is_actor_subject_id(actor_id));
