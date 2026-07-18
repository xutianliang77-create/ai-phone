DROP INDEX IF EXISTS enterprise.meetings_tenant_recovery_idx;

ALTER TABLE enterprise.meeting_artifacts
  DROP CONSTRAINT IF EXISTS meeting_artifacts_publish_check,
  DROP CONSTRAINT IF EXISTS meeting_artifacts_status_check,
  DROP CONSTRAINT IF EXISTS meeting_artifacts_type_check;

DROP INDEX IF EXISTS enterprise.meeting_participants_tenant_external_unique_idx;
DROP INDEX IF EXISTS enterprise.meeting_participants_tenant_user_unique_idx;

ALTER TABLE enterprise.meeting_participants
  DROP CONSTRAINT IF EXISTS meeting_participants_presence_time_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_display_name_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_role_identity_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_role_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_identity_xor_check;

ALTER TABLE enterprise.meetings
  DROP CONSTRAINT IF EXISTS meetings_time_check,
  DROP CONSTRAINT IF EXISTS meetings_policy_object_check,
  DROP CONSTRAINT IF EXISTS meetings_status_check,
  DROP CONSTRAINT IF EXISTS meetings_title_check,
  DROP COLUMN IF EXISTS ended_at,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at;
