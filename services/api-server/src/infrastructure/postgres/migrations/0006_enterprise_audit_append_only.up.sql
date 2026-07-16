ALTER TABLE enterprise.audit_events
  ADD CONSTRAINT audit_events_result_check CHECK (
    result IN ('accepted', 'completed', 'failed', 'denied')
  ),
  ADD CONSTRAINT audit_events_details_object_check CHECK (
    jsonb_typeof(details) = 'object'
  );

CREATE INDEX audit_events_tenant_action_created_idx
  ON enterprise.audit_events (
    tenant_id, action, created_at DESC, id DESC
  );

CREATE OR REPLACE FUNCTION enterprise.enterprise_reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'enterprise audit events are append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER enterprise_audit_events_append_only
BEFORE UPDATE OR DELETE ON enterprise.audit_events
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_reject_audit_event_mutation();
