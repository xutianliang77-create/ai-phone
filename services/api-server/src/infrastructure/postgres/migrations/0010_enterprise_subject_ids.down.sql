DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT user_id AS subject FROM enterprise.members
      UNION ALL
      SELECT user_id FROM enterprise.user_tenant_directory
      UNION ALL
      SELECT created_by FROM enterprise.knowledge_sources
      UNION ALL
      SELECT owner_user_id FROM enterprise.marketing_campaigns
      UNION ALL
      SELECT assigned_user_id FROM enterprise.support_sessions
      UNION ALL
      SELECT host_user_id FROM enterprise.meetings
      UNION ALL
      SELECT user_id FROM enterprise.meeting_participants
      UNION ALL
      SELECT actor_id FROM enterprise.tenant_jobs
      UNION ALL
      SELECT actor_id FROM enterprise.platform_pending_work
      UNION ALL
      SELECT actor_id FROM enterprise.policy_decisions
      UNION ALL
      SELECT actor_id FROM enterprise.audit_events
      UNION ALL
      SELECT actor_id FROM enterprise.idempotency_keys
    ) identity_subjects
    WHERE subject IS NOT NULL
      AND NOT enterprise.is_account_subject_id(subject)
  ) THEN
    RAISE EXCEPTION
      'cannot rollback enterprise subject IDs with non-account actors'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE enterprise.members
  DROP CONSTRAINT members_user_subject_check;
ALTER TABLE enterprise.user_tenant_directory
  DROP CONSTRAINT user_tenant_directory_user_subject_check;
ALTER TABLE enterprise.knowledge_sources
  DROP CONSTRAINT knowledge_sources_created_by_subject_check;
ALTER TABLE enterprise.marketing_campaigns
  DROP CONSTRAINT marketing_campaigns_owner_subject_check;
ALTER TABLE enterprise.support_sessions
  DROP CONSTRAINT support_sessions_assigned_subject_check;
ALTER TABLE enterprise.meetings
  DROP CONSTRAINT meetings_host_subject_check;
ALTER TABLE enterprise.meeting_participants
  DROP CONSTRAINT meeting_participants_user_subject_check;
ALTER TABLE enterprise.tenant_jobs
  DROP CONSTRAINT tenant_jobs_actor_subject_check;
ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_actor_subject_check;
ALTER TABLE enterprise.policy_decisions
  DROP CONSTRAINT policy_decisions_actor_subject_check;
ALTER TABLE enterprise.audit_events
  DROP CONSTRAINT audit_events_actor_subject_check;
ALTER TABLE enterprise.idempotency_keys
  DROP CONSTRAINT idempotency_keys_actor_subject_check;

DROP POLICY user_tenant_directory_self_read
  ON enterprise.user_tenant_directory;
DROP FUNCTION enterprise.current_user_id();

ALTER TABLE enterprise.members
  ALTER COLUMN user_id TYPE uuid USING (substring(user_id FROM 6)::uuid);
ALTER TABLE enterprise.user_tenant_directory
  ALTER COLUMN user_id TYPE uuid USING (substring(user_id FROM 6)::uuid);
ALTER TABLE enterprise.knowledge_sources
  ALTER COLUMN created_by TYPE uuid USING (substring(created_by FROM 6)::uuid);
ALTER TABLE enterprise.marketing_campaigns
  ALTER COLUMN owner_user_id TYPE uuid
    USING (substring(owner_user_id FROM 6)::uuid);
ALTER TABLE enterprise.support_sessions
  ALTER COLUMN assigned_user_id TYPE uuid
    USING (substring(assigned_user_id FROM 6)::uuid);
ALTER TABLE enterprise.meetings
  ALTER COLUMN host_user_id TYPE uuid
    USING (substring(host_user_id FROM 6)::uuid);
ALTER TABLE enterprise.meeting_participants
  ALTER COLUMN user_id TYPE uuid USING (substring(user_id FROM 6)::uuid);
ALTER TABLE enterprise.tenant_jobs
  ALTER COLUMN actor_id TYPE uuid USING (substring(actor_id FROM 6)::uuid);
ALTER TABLE enterprise.platform_pending_work
  ALTER COLUMN actor_id TYPE uuid USING (substring(actor_id FROM 6)::uuid);

ALTER TABLE enterprise.policy_decisions
  ALTER COLUMN actor_id TYPE uuid USING (substring(actor_id FROM 6)::uuid);
ALTER TABLE enterprise.audit_events
  ALTER COLUMN actor_id TYPE uuid USING (substring(actor_id FROM 6)::uuid);
ALTER TABLE enterprise.idempotency_keys
  ALTER COLUMN actor_id TYPE uuid USING (substring(actor_id FROM 6)::uuid);

CREATE OR REPLACE FUNCTION enterprise.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE POLICY user_tenant_directory_self_read
  ON enterprise.user_tenant_directory
  FOR SELECT
  USING (user_id = enterprise.current_user_id());

DROP FUNCTION enterprise.is_actor_subject_id(text);
DROP FUNCTION enterprise.is_account_subject_id(text);
