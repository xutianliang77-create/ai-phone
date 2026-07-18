CREATE OR REPLACE FUNCTION enterprise.validate_usage_event_ledger_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_record enterprise.usage_ledger%ROWTYPE;
BEGIN
  SELECT * INTO ledger_record
  FROM enterprise.usage_ledger
  WHERE tenant_id = NEW.tenant_id AND id = NEW.ledger_entry_id;
  IF NOT FOUND OR ledger_record.entry_type <> 'settle'
    OR (ledger_record.billing_account_id, ledger_record.budget_id,
      ledger_record.hold_id, ledger_record.category, ledger_record.unit,
      ledger_record.amount, ledger_record.source_type, ledger_record.source_ref,
      ledger_record.idempotency_key, ledger_record.request_hash,
      ledger_record.occurred_at, ledger_record.recorded_at,
      ledger_record.metadata, ledger_record.usage_event_id)
    IS DISTINCT FROM
    (NEW.billing_account_id, NEW.budget_id, NEW.hold_id, NEW.category, NEW.unit,
      NEW.amount, NEW.source_type, NEW.source_ref, NEW.idempotency_key,
      NEW.request_hash, NEW.occurred_at, NEW.received_at, NEW.metadata, NEW.id)
  THEN
    RAISE EXCEPTION 'enterprise usage event ledger mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.reject_communication_binding_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.kind,
    NEW.meeting_id, NEW.support_session_id, NEW.marketing_call_task_id,
    NEW.home_region, NEW.cell_id, NEW.route_epoch,
    NEW.policy_version, NEW.entitlement_version, NEW.started_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.kind,
    OLD.meeting_id, OLD.support_session_id, OLD.marketing_call_task_id,
    OLD.home_region, OLD.cell_id, OLD.route_epoch,
    OLD.policy_version, OLD.entitlement_version, OLD.started_at
  ) THEN
    RAISE EXCEPTION 'enterprise communication binding identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS enterprise.outbox_events_trace_idx;
DROP INDEX IF EXISTS enterprise.inbox_events_trace_idx;
DROP INDEX IF EXISTS enterprise.audit_events_trace_idx;
DROP INDEX IF EXISTS enterprise.usage_ledger_trace_idx;
DROP INDEX IF EXISTS enterprise.tenant_usage_events_trace_idx;
DROP INDEX IF EXISTS enterprise.communication_session_bindings_trace_idx;

ALTER TABLE enterprise.usage_ledger DROP COLUMN trace_id;
ALTER TABLE enterprise.tenant_usage_events DROP COLUMN trace_id;
ALTER TABLE enterprise.communication_session_bindings DROP COLUMN trace_id;
