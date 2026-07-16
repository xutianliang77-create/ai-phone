DROP TRIGGER IF EXISTS enterprise_audit_events_append_only
  ON enterprise.audit_events;
DROP FUNCTION IF EXISTS enterprise.enterprise_reject_audit_event_mutation();

DROP INDEX IF EXISTS enterprise.audit_events_tenant_action_created_idx;

ALTER TABLE enterprise.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_details_object_check,
  DROP CONSTRAINT IF EXISTS audit_events_result_check;
