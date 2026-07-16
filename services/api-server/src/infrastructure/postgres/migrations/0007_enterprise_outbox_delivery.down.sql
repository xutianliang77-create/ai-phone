DROP TRIGGER IF EXISTS enterprise_outbox_delivery_content_immutable
  ON enterprise.outbox_events;
DROP FUNCTION IF EXISTS enterprise.enterprise_enforce_outbox_delivery_update();

DROP INDEX IF EXISTS enterprise.outbox_events_tenant_recovery_idx;

ALTER TABLE enterprise.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_events_last_error_code_check,
  DROP COLUMN IF EXISTS last_error_code,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS trace_id;

ALTER TABLE enterprise.inbox_events
  DROP COLUMN IF EXISTS trace_id;
