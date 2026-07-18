DROP POLICY IF EXISTS meeting_screen_share_commands_tenant_isolation
  ON enterprise.meeting_screen_share_commands;
DROP TRIGGER IF EXISTS meeting_screen_share_pending_work
  ON enterprise.meeting_screen_shares;
DROP FUNCTION IF EXISTS enterprise.sync_meeting_screen_share_pending_work();
ALTER TABLE enterprise.platform_pending_work DISABLE ROW LEVEL SECURITY;
DELETE FROM enterprise.platform_pending_work WHERE work_kind = 'screen_share';
ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT IF EXISTS platform_pending_work_check,
  DROP CONSTRAINT IF EXISTS platform_pending_work_work_kind_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox', 'audit_export')
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind = 'outbox' AND actor_id IS NULL)
  );
ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS meeting_screen_share_identity_immutable
  ON enterprise.meeting_screen_shares;
DROP FUNCTION IF EXISTS enterprise.reject_meeting_screen_share_identity_change();
DROP TRIGGER IF EXISTS meeting_screen_share_commands_append_only
  ON enterprise.meeting_screen_share_commands;
DROP FUNCTION IF EXISTS enterprise.reject_meeting_screen_share_command_mutation();
DROP TABLE IF EXISTS enterprise.meeting_screen_share_commands;
DROP INDEX IF EXISTS enterprise.meeting_screen_shares_recovery_idx;

ALTER TABLE enterprise.meeting_screen_shares
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_time_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_lifecycle_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_request_hash_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_track_sid_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_route_epoch_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_generation_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_status_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_quality_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_source_check,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_participant_meeting_fk,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_binding_fk,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_acquire_key,
  DROP CONSTRAINT IF EXISTS meeting_screen_shares_scope_key,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS request_hash,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS generation,
  DROP COLUMN IF EXISTS route_epoch,
  DROP COLUMN IF EXISTS communication_session_id;

ALTER TABLE enterprise.communication_session_bindings
  DROP CONSTRAINT IF EXISTS communication_bindings_meeting_session_key;

ALTER TABLE enterprise.meeting_participants
  DROP CONSTRAINT IF EXISTS meeting_participants_scope_key;
