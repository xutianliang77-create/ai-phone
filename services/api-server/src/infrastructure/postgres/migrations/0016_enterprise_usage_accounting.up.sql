CREATE TABLE enterprise.tenant_usage_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  billing_account_id uuid NOT NULL,
  budget_id uuid,
  hold_id uuid,
  ledger_entry_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'meeting_audio_seconds', 'screen_share_seconds', 'screen_ocr_frames',
    'support_ai_seconds', 'support_human_seconds', 'marketing_call_seconds',
    'pstn_seconds', 'asr_seconds', 'tts_characters',
    'llm_input_tokens', 'llm_output_tokens'
  )),
  unit text NOT NULL CHECK (unit IN (
    'seconds', 'frames', 'characters', 'tokens'
  )),
  amount bigint NOT NULL CHECK (amount > 0),
  source_type text NOT NULL CHECK (length(btrim(source_type)) BETWEEN 1 AND 80),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, ledger_entry_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, budget_id)
    REFERENCES enterprise.usage_budgets (tenant_id, id),
  FOREIGN KEY (tenant_id, hold_id)
    REFERENCES enterprise.usage_holds (tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_entry_id)
    REFERENCES enterprise.usage_ledger (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (jsonb_typeof(metadata) = 'object'),
  CHECK (received_at >= occurred_at - interval '1 minute')
);
CREATE INDEX tenant_usage_events_period_idx
  ON enterprise.tenant_usage_events (
    tenant_id, billing_account_id, category, unit, occurred_at, id
  );

ALTER TABLE enterprise.usage_ledger
  ADD COLUMN usage_event_id uuid,
  ADD CONSTRAINT usage_ledger_event_fk
    FOREIGN KEY (tenant_id, usage_event_id)
    REFERENCES enterprise.tenant_usage_events (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX usage_ledger_event_unique_idx
  ON enterprise.usage_ledger (tenant_id, usage_event_id)
  WHERE usage_event_id IS NOT NULL;

CREATE TABLE enterprise.usage_adjustments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  billing_account_id uuid NOT NULL,
  target_ledger_entry_id uuid NOT NULL,
  adjustment_ledger_entry_id uuid NOT NULL,
  delta_amount bigint NOT NULL CHECK (delta_amount <> 0),
  reason_code text NOT NULL
    CHECK (reason_code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK (enterprise.is_actor_subject_id(actor_id)),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, adjustment_ledger_entry_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, target_ledger_entry_id)
    REFERENCES enterprise.usage_ledger (tenant_id, id),
  FOREIGN KEY (tenant_id, adjustment_ledger_entry_id)
    REFERENCES enterprise.usage_ledger (tenant_id, id)
);
CREATE INDEX usage_adjustments_target_idx
  ON enterprise.usage_adjustments (
    tenant_id, target_ledger_entry_id, created_at, id
  );

CREATE TABLE enterprise.usage_period_aggregates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  billing_account_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'meeting_audio_seconds', 'screen_share_seconds', 'screen_ocr_frames',
    'support_ai_seconds', 'support_human_seconds', 'marketing_call_seconds',
    'pstn_seconds', 'asr_seconds', 'tts_characters',
    'llm_input_tokens', 'llm_output_tokens'
  )),
  unit text NOT NULL CHECK (unit IN (
    'seconds', 'frames', 'characters', 'tokens'
  )),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  settled_amount bigint NOT NULL CHECK (settled_amount >= 0),
  adjustment_amount bigint NOT NULL,
  net_amount bigint NOT NULL CHECK (net_amount >= 0),
  settlement_count bigint NOT NULL CHECK (settlement_count >= 0),
  usage_event_count bigint NOT NULL CHECK (usage_event_count >= 0),
  adjustment_count bigint NOT NULL CHECK (adjustment_count >= 0),
  ledger_count bigint NOT NULL CHECK (ledger_count >= 0),
  ledger_hash text NOT NULL CHECK (ledger_hash ~ '^[a-f0-9]{64}$'),
  source_watermark timestamptz,
  computed_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (
    tenant_id, billing_account_id, category, unit, period_start, period_end
  ),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  CHECK (period_end > period_start),
  CHECK (net_amount = settled_amount + adjustment_amount),
  CHECK (usage_event_count <= settlement_count),
  CHECK (ledger_count = settlement_count + adjustment_count)
);
CREATE INDEX usage_period_aggregates_period_idx
  ON enterprise.usage_period_aggregates (
    tenant_id, billing_account_id, period_start DESC, category, unit, id
  );

CREATE OR REPLACE FUNCTION enterprise.reject_usage_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise usage event is append only';
END;
$$;
CREATE TRIGGER enterprise_usage_event_append_only
BEFORE UPDATE OR DELETE ON enterprise.tenant_usage_events
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_usage_event_mutation();

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
CREATE CONSTRAINT TRIGGER enterprise_usage_event_ledger_consistent
AFTER INSERT ON enterprise.tenant_usage_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enterprise.validate_usage_event_ledger_link();

CREATE OR REPLACE FUNCTION enterprise.reject_usage_adjustment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise usage adjustment is append only';
END;
$$;
CREATE TRIGGER enterprise_usage_adjustment_append_only
BEFORE UPDATE OR DELETE ON enterprise.usage_adjustments
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_usage_adjustment_mutation();

CREATE OR REPLACE FUNCTION enterprise.validate_usage_adjustment_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_record enterprise.usage_ledger%ROWTYPE;
DECLARE adjustment_record enterprise.usage_ledger%ROWTYPE;
DECLARE prior_amount bigint;
BEGIN
  SELECT * INTO target_record
  FROM enterprise.usage_ledger
  WHERE tenant_id = NEW.tenant_id AND id = NEW.target_ledger_entry_id
  FOR UPDATE;
  SELECT * INTO adjustment_record
  FROM enterprise.usage_ledger
  WHERE tenant_id = NEW.tenant_id AND id = NEW.adjustment_ledger_entry_id;
  IF target_record.entry_type <> 'settle' OR
    adjustment_record.entry_type <> 'adjustment'
    OR (adjustment_record.billing_account_id, adjustment_record.budget_id,
      adjustment_record.category, adjustment_record.unit,
      adjustment_record.amount, adjustment_record.source_type,
      adjustment_record.source_ref, adjustment_record.request_hash,
      adjustment_record.occurred_at, adjustment_record.recorded_at,
      adjustment_record.usage_event_id)
    IS DISTINCT FROM
    (target_record.billing_account_id, target_record.budget_id,
      target_record.category, target_record.unit, NEW.delta_amount,
      'billing_adjustment'::text, NEW.id::text, NEW.request_hash,
      target_record.occurred_at, NEW.created_at, NULL::uuid)
  THEN
    RAISE EXCEPTION 'enterprise usage adjustment ledger mismatch';
  END IF;
  SELECT COALESCE(sum(delta_amount), 0) INTO prior_amount
  FROM enterprise.usage_adjustments
  WHERE tenant_id = NEW.tenant_id
    AND target_ledger_entry_id = NEW.target_ledger_entry_id;
  IF target_record.amount + prior_amount + NEW.delta_amount < 0 THEN
    RAISE EXCEPTION 'enterprise usage adjustment creates negative net';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_usage_adjustment_valid
BEFORE INSERT ON enterprise.usage_adjustments
FOR EACH ROW EXECUTE FUNCTION enterprise.validate_usage_adjustment_insert();

CREATE OR REPLACE FUNCTION enterprise.guard_usage_period_aggregate_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (NEW.id, NEW.tenant_id, NEW.billing_account_id, NEW.category,
      NEW.unit, NEW.period_start, NEW.period_end)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.billing_account_id, OLD.category,
      OLD.unit, OLD.period_start, OLD.period_end)
    AND NEW.version = OLD.version + 1
    AND NEW.computed_at >= OLD.computed_at
    AND (OLD.source_watermark IS NULL OR
      (NEW.source_watermark IS NOT NULL AND
        NEW.source_watermark >= OLD.source_watermark)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid enterprise usage aggregate mutation';
END;
$$;
CREATE TRIGGER enterprise_usage_period_aggregate_guard
BEFORE UPDATE OR DELETE ON enterprise.usage_period_aggregates
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_usage_period_aggregate_change();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_usage_events', 'usage_adjustments', 'usage_period_aggregates'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON enterprise.%I USING (tenant_id = enterprise.current_tenant_id()) WITH CHECK (tenant_id = enterprise.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;
