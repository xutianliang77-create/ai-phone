CREATE TABLE enterprise.usage_budgets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  category text NOT NULL CHECK (category IN (
    'meeting_audio_seconds', 'screen_share_seconds', 'screen_ocr_frames',
    'support_ai_seconds', 'support_human_seconds', 'marketing_call_seconds',
    'pstn_seconds', 'asr_seconds', 'tts_characters',
    'llm_input_tokens', 'llm_output_tokens'
  )),
  unit text NOT NULL CHECK (unit IN (
    'seconds', 'frames', 'characters', 'tokens'
  )),
  limit_amount bigint NOT NULL CHECK (limit_amount >= 0),
  alert_threshold_percent integer NOT NULL
    CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('active', 'paused')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, category, unit, period_start),
  CHECK (period_end > period_start)
);
CREATE INDEX usage_budgets_tenant_active_idx
  ON enterprise.usage_budgets (
    tenant_id, category, unit, period_start, period_end, id
  ) WHERE status = 'active';

CREATE TABLE enterprise.usage_holds (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  budget_id uuid NOT NULL,
  category text NOT NULL,
  unit text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  settled_amount bigint CHECK (settled_amount >= 0),
  status text NOT NULL CHECK (status IN (
    'held', 'settled', 'released', 'expired'
  )),
  source_type text NOT NULL CHECK (length(btrim(source_type)) BETWEEN 1 AND 80),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  held_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, budget_id)
    REFERENCES enterprise.usage_budgets (tenant_id, id),
  CHECK (expires_at > held_at),
  CHECK (
    (status = 'held' AND settled_amount IS NULL
      AND settled_at IS NULL AND released_at IS NULL)
    OR (status = 'settled' AND settled_amount IS NOT NULL
      AND settled_at IS NOT NULL AND released_at IS NULL)
    OR (status IN ('released', 'expired') AND settled_amount IS NULL
      AND settled_at IS NULL AND released_at IS NOT NULL)
  )
);
CREATE INDEX usage_holds_tenant_active_idx
  ON enterprise.usage_holds (
    tenant_id, budget_id, status, expires_at, id
  ) WHERE status = 'held';

ALTER TABLE enterprise.usage_ledger
  ADD COLUMN entry_type text NOT NULL DEFAULT 'settle'
    CHECK (entry_type IN ('settle', 'adjustment')),
  ADD COLUMN budget_id uuid,
  ADD COLUMN hold_id uuid,
  ADD COLUMN source_ref text,
  ADD COLUMN request_hash text,
  ADD COLUMN recorded_at timestamptz;
UPDATE enterprise.usage_ledger
SET source_ref = COALESCE(source_id::text, id::text),
  request_hash = md5(tenant_id::text || ':' || id::text) ||
    md5('legacy:' || tenant_id::text || ':' || id::text),
  recorded_at = occurred_at;
ALTER TABLE enterprise.usage_ledger
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL,
  ALTER COLUMN recorded_at SET NOT NULL,
  ADD CONSTRAINT usage_ledger_request_hash_format
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT usage_ledger_budget_fk
    FOREIGN KEY (tenant_id, budget_id)
    REFERENCES enterprise.usage_budgets (tenant_id, id),
  ADD CONSTRAINT usage_ledger_hold_fk
    FOREIGN KEY (tenant_id, hold_id)
    REFERENCES enterprise.usage_holds (tenant_id, id);
ALTER TABLE enterprise.usage_ledger
  ALTER COLUMN entry_type DROP DEFAULT;

CREATE TABLE enterprise.usage_budget_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  budget_id uuid NOT NULL,
  threshold_percent integer NOT NULL CHECK (threshold_percent BETWEEN 1 AND 100),
  projected_amount bigint NOT NULL CHECK (projected_amount >= 0),
  limit_amount bigint NOT NULL CHECK (limit_amount >= 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, budget_id, threshold_percent),
  FOREIGN KEY (tenant_id, budget_id)
    REFERENCES enterprise.usage_budgets (tenant_id, id)
);

CREATE OR REPLACE FUNCTION enterprise.reject_usage_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise usage ledger is append only';
END;
$$;
CREATE TRIGGER enterprise_usage_ledger_append_only
BEFORE UPDATE OR DELETE ON enterprise.usage_ledger
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_usage_ledger_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_usage_budget_alert_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise usage budget alert is append only';
END;
$$;
CREATE TRIGGER enterprise_usage_budget_alert_append_only
BEFORE UPDATE OR DELETE ON enterprise.usage_budget_alerts
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_usage_budget_alert_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_usage_hold_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.id, NEW.tenant_id, NEW.budget_id, NEW.category, NEW.unit,
    NEW.amount, NEW.source_type, NEW.source_ref, NEW.idempotency_key,
    NEW.request_hash, NEW.held_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.id, OLD.tenant_id, OLD.budget_id, OLD.category, OLD.unit,
    OLD.amount, OLD.source_type, OLD.source_ref, OLD.idempotency_key,
    OLD.request_hash, OLD.held_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise usage hold identity is immutable';
  END IF;
  IF OLD.status <> 'held' OR NEW.status NOT IN ('settled', 'released', 'expired')
    OR NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise usage hold transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_usage_hold_identity_immutable
BEFORE UPDATE ON enterprise.usage_holds
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_usage_hold_identity_change();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'usage_budgets', 'usage_holds', 'usage_budget_alerts'
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
