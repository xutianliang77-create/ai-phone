COMMENT ON COLUMN enterprise.marketing_call_tasks.translation_session_id IS NULL;
COMMENT ON COLUMN enterprise.support_sessions.translation_session_id IS NULL;
COMMENT ON COLUMN enterprise.meetings.translation_session_id IS NULL;

DROP TRIGGER IF EXISTS communication_binding_identity_immutable
  ON enterprise.communication_session_bindings;
DROP FUNCTION IF EXISTS enterprise.reject_communication_binding_identity_change();
DROP TABLE IF EXISTS enterprise.communication_session_bindings;
