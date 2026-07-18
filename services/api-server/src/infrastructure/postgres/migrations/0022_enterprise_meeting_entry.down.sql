DROP INDEX IF EXISTS enterprise.meetings_tenant_creation_key_unique_idx;
DROP INDEX IF EXISTS enterprise.meeting_participants_invitation_key_unique_idx;

ALTER TABLE enterprise.meeting_participants
  DROP CONSTRAINT IF EXISTS meeting_participants_invitation_hash_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_invitation_key_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_invitation_role_check,
  DROP CONSTRAINT IF EXISTS meeting_participants_invitation_pair_check,
  DROP COLUMN IF EXISTS invitation_request_hash,
  DROP COLUMN IF EXISTS invitation_key;

ALTER TABLE enterprise.meetings
  DROP CONSTRAINT IF EXISTS meetings_entry_policy_check,
  DROP CONSTRAINT IF EXISTS meetings_creation_request_hash_check,
  DROP CONSTRAINT IF EXISTS meetings_creation_key_check,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_key;
