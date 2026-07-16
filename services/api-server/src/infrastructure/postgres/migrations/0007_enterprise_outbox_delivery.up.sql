ALTER TABLE enterprise.inbox_events
  ADD COLUMN trace_id text NOT NULL DEFAULT 'legacy';

ALTER TABLE enterprise.inbox_events
  ALTER COLUMN trace_id DROP DEFAULT;

ALTER TABLE enterprise.outbox_events
  ADD COLUMN trace_id text NOT NULL DEFAULT 'legacy',
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_error_code text,
  ADD CONSTRAINT outbox_events_last_error_code_check
    CHECK (
      last_error_code IS NULL OR
      last_error_code ~ '^[a-z][a-z0-9_]{1,63}$'
    );

ALTER TABLE enterprise.outbox_events
  ALTER COLUMN trace_id DROP DEFAULT;

CREATE INDEX outbox_events_tenant_recovery_idx
  ON enterprise.outbox_events (
    tenant_id,
    published_at,
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION enterprise.enterprise_enforce_outbox_delivery_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type OR
    NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id OR
    NEW.event_type IS DISTINCT FROM OLD.event_type OR
    NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
    NEW.payload IS DISTINCT FROM OLD.payload OR
    NEW.trace_id IS DISTINCT FROM OLD.trace_id OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'enterprise outbox delivery content is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_outbox_delivery_content_immutable
BEFORE UPDATE ON enterprise.outbox_events
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_enforce_outbox_delivery_update();
