DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.subscriptions
    WHERE status NOT IN ('active', 'superseded')
  ) THEN
    RAISE EXCEPTION 'unsupported subscription status before lifecycle migration';
  END IF;
END
$$;

ALTER TABLE enterprise.subscriptions
  ADD CONSTRAINT subscriptions_lifecycle_status_check CHECK (
    status IN (
      'active', 'past_due', 'suspended', 'superseded', 'cancelled'
    )
  );

CREATE TABLE enterprise.billing_provider_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  billing_account_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider ~ '^[a-z][a-z0-9._-]{0,63}$'
  ),
  provider_event_id text NOT NULL CHECK (
    length(btrim(provider_event_id)) BETWEEN 1 AND 200
  ),
  event_type text NOT NULL CHECK (event_type IN (
    'renewed', 'payment_failed', 'grace_expired',
    'payment_recovered', 'cancelled'
  )),
  provider_payload_hash text NOT NULL CHECK (
    provider_payload_hash ~ '^[a-f0-9]{64}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  received_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_event_id),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES enterprise.subscriptions (tenant_id, id),
  CHECK (
    (event_type = 'renewed' AND period_start IS NOT NULL AND
      period_end > period_start AND effective_at = period_start)
    OR
    (event_type = 'payment_recovered' AND period_start IS NOT NULL AND
      period_end > period_start AND effective_at >= period_start AND
      effective_at < period_end)
    OR
    (event_type NOT IN ('renewed', 'payment_recovered') AND
      period_start IS NULL AND period_end IS NULL)
  )
);

CREATE TABLE enterprise.billing_lifecycle_commands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES enterprise.billing_provider_events (tenant_id, id),
  CHECK (
    (status = 'processing' AND lease_owner IS NOT NULL AND
      lease_generation > 0 AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (lease_owner IS NULL OR
    lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$'),
  CHECK (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  CHECK (
    (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
    OR (status NOT IN ('completed', 'failed') AND completed_at IS NULL)
  )
);

CREATE TABLE enterprise.billing_lifecycle_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  command_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('applied', 'ignored')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  from_account_status text NOT NULL,
  to_account_status text NOT NULL,
  from_subscription_id uuid NOT NULL,
  from_subscription_status text NOT NULL,
  to_subscription_status text NOT NULL,
  resulting_subscription_id uuid,
  resulting_entitlement_snapshot_id uuid,
  closed_period_start timestamptz,
  closed_period_end timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, event_id)
    REFERENCES enterprise.billing_provider_events (tenant_id, id),
  FOREIGN KEY (tenant_id, command_id)
    REFERENCES enterprise.billing_lifecycle_commands (tenant_id, id),
  FOREIGN KEY (tenant_id, from_subscription_id)
    REFERENCES enterprise.subscriptions (tenant_id, id),
  FOREIGN KEY (tenant_id, resulting_subscription_id)
    REFERENCES enterprise.subscriptions (tenant_id, id),
  FOREIGN KEY (tenant_id, resulting_entitlement_snapshot_id)
    REFERENCES enterprise.entitlement_snapshots (tenant_id, id),
  CHECK (
    (closed_period_start IS NULL AND closed_period_end IS NULL) OR
    closed_period_end > closed_period_start
  ),
  CHECK (from_account_status IN ('active', 'past_due', 'suspended', 'closed')),
  CHECK (to_account_status IN ('active', 'past_due', 'suspended', 'closed')),
  CHECK (from_subscription_status IN (
    'active', 'past_due', 'suspended', 'superseded', 'cancelled'
  )),
  CHECK (to_subscription_status IN (
    'active', 'past_due', 'suspended', 'superseded', 'cancelled'
  ))
);

CREATE INDEX billing_provider_events_tenant_effective_idx
  ON enterprise.billing_provider_events (
    tenant_id, effective_at, provider, provider_event_id
  );
CREATE INDEX billing_lifecycle_commands_due_idx
  ON enterprise.billing_lifecycle_commands (
    tenant_id, status, due_at, lease_expires_at, id
  );
CREATE INDEX billing_lifecycle_decisions_tenant_created_idx
  ON enterprise.billing_lifecycle_decisions (tenant_id, created_at DESC, id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_provider_events', 'billing_lifecycle_commands',
    'billing_lifecycle_decisions'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON enterprise.%I USING (tenant_id = enterprise.current_tenant_id()) WITH CHECK (tenant_id = enterprise.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.reject_billing_provider_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise billing provider event is append only';
END
$$;
CREATE TRIGGER billing_provider_event_append_only
BEFORE UPDATE OR DELETE ON enterprise.billing_provider_events
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_billing_provider_event_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_billing_lifecycle_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise billing lifecycle decision is append only';
END
$$;
CREATE TRIGGER billing_lifecycle_decision_append_only
BEFORE UPDATE OR DELETE ON enterprise.billing_lifecycle_decisions
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_billing_lifecycle_decision_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_billing_lifecycle_command()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
      (NEW.id, NEW.tenant_id, NEW.event_id, NEW.due_at, NEW.created_at)
        IS DISTINCT FROM
      (OLD.id, OLD.tenant_id, OLD.event_id, OLD.due_at, OLD.created_at) OR
      NEW.attempts < OLD.attempts OR NEW.lease_generation < OLD.lease_generation THEN
    RAISE EXCEPTION 'billing lifecycle command identity is immutable';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'processing' AND
      NEW.attempts = OLD.attempts + 1 AND
      NEW.lease_generation = OLD.lease_generation + 1 AND
      NEW.version = OLD.version + 1 AND
      NEW.lease_owner IS NOT NULL AND NEW.lease_expires_at > clock_timestamp()
      AND NEW.completed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'processing' AND NEW.status = 'processing' AND
      OLD.lease_expires_at <= clock_timestamp() AND
      NEW.attempts = OLD.attempts + 1 AND
      NEW.lease_generation = OLD.lease_generation + 1 AND
      NEW.version = OLD.version + 1 AND
      NEW.lease_owner IS NOT NULL AND NEW.lease_expires_at > clock_timestamp()
      AND NEW.completed_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'processing' AND NEW.status IN ('completed', 'failed') AND
      NEW.attempts = OLD.attempts AND
      NEW.lease_generation = OLD.lease_generation AND
      NEW.version = OLD.version + 1 AND
      NEW.lease_owner IS NULL AND NEW.lease_expires_at IS NULL AND
      NEW.completed_at IS NOT NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid billing lifecycle command transition';
END
$$;
CREATE TRIGGER billing_lifecycle_command_guard
BEFORE UPDATE OR DELETE ON enterprise.billing_lifecycle_commands
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_billing_lifecycle_command();

CREATE OR REPLACE FUNCTION enterprise.guard_billing_account_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.currency, NEW.billing_contact_subject_id,
      NEW.created_at) IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.currency, OLD.billing_contact_subject_id,
      OLD.created_at) OR NEW.version <> OLD.version + 1 OR
      NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'billing account identity is immutable';
  END IF;
  IF (OLD.status, NEW.status) IN (
    ('active', 'past_due'), ('past_due', 'suspended'),
    ('past_due', 'active'), ('suspended', 'active'),
    ('active', 'closed'), ('past_due', 'closed'), ('suspended', 'closed')
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid billing account lifecycle transition';
END
$$;
CREATE TRIGGER billing_account_lifecycle_guard
BEFORE UPDATE ON enterprise.billing_accounts
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_billing_account_lifecycle();

CREATE OR REPLACE FUNCTION enterprise.reject_subscription_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
      (NEW.id, NEW.tenant_id, NEW.billing_account_id,
        NEW.plan_code, NEW.plan_version, NEW.seats, NEW.billing_cycle,
        NEW.current_period_start, NEW.current_period_end, NEW.created_at)
      IS NOT DISTINCT FROM
      (OLD.id, OLD.tenant_id, OLD.billing_account_id,
        OLD.plan_code, OLD.plan_version, OLD.seats, OLD.billing_cycle,
        OLD.current_period_start, OLD.current_period_end, OLD.created_at)
      AND NEW.updated_at >= OLD.updated_at AND NEW.version = OLD.version + 1
      AND (OLD.status, NEW.status) IN (
        ('active', 'past_due'), ('active', 'superseded'),
        ('active', 'cancelled'), ('past_due', 'suspended'),
        ('past_due', 'superseded'), ('past_due', 'cancelled'),
        ('suspended', 'superseded'), ('suspended', 'cancelled')
      ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'enterprise subscription is immutable';
END
$$;

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_work_kind_check,
  DROP CONSTRAINT platform_pending_work_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN (
      'tenant_lifecycle', 'outbox', 'audit_export', 'screen_share',
      'data_lifecycle', 'billing_lifecycle'
    )
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind IN (
      'outbox', 'screen_share', 'data_lifecycle', 'billing_lifecycle'
    ) AND actor_id IS NULL)
  );

CREATE OR REPLACE FUNCTION enterprise.sync_billing_lifecycle_pending_work()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id AND work_kind = 'billing_lifecycle'
      AND resource_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.status IN ('pending', 'processing') THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    ) SELECT tenant.cell_id, NEW.tenant_id, 'billing_lifecycle', NEW.id,
      NULL, NEW.due_at, NEW.lease_expires_at
    FROM enterprise.tenants tenant WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id, due_at = excluded.due_at,
      lease_expires_at = excluded.lease_expires_at;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id AND work_kind = 'billing_lifecycle'
      AND resource_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER enterprise_billing_lifecycle_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.billing_lifecycle_commands
FOR EACH ROW EXECUTE FUNCTION enterprise.sync_billing_lifecycle_pending_work();
