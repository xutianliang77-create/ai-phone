CREATE TABLE enterprise.billing_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  status text NOT NULL CHECK (status IN (
    'active', 'past_due', 'suspended', 'closed'
  )),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_contact_subject_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id),
  UNIQUE (tenant_id, id),
  CHECK (
    billing_contact_subject_id IS NULL
    OR enterprise.is_account_subject_id(billing_contact_subject_id)
  )
);

INSERT INTO enterprise.billing_accounts(
  id, tenant_id, status, currency, billing_contact_subject_id,
  created_at, updated_at, version
)
SELECT id, id,
  CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END,
  'CNY', NULL, created_at, updated_at, 1
FROM enterprise.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE enterprise.billing_plan_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  plan_code text NOT NULL CHECK (length(btrim(plan_code)) BETWEEN 1 AND 80),
  plan_version text NOT NULL
    CHECK (length(btrim(plan_version)) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('published', 'retired')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  seat_limit integer NOT NULL CHECK (seat_limit >= 0),
  entitlements jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz NOT NULL,
  retired_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, plan_code, plan_version),
  CHECK (jsonb_typeof(entitlements) = 'object'),
  CHECK (
    (status = 'published' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  ),
  CHECK (retired_at IS NULL OR retired_at >= published_at)
);

INSERT INTO enterprise.billing_plan_versions(
  id, tenant_id, plan_code, plan_version, status, currency,
  billing_cycle, seat_limit, entitlements, published_at, retired_at
)
SELECT md5('enterprise-plan:' || source.tenant_id::text || ':' ||
    source.plan_code || ':migration-v1')::uuid,
  source.tenant_id, source.plan_code, 'migration-v1', 'published',
  'CNY', 'monthly', 0,
  COALESCE((
    SELECT jsonb_object_agg(entitlement_key, jsonb_build_object(
      'enabled', enabled, 'limit', limit_value
    ))
    FROM enterprise.entitlements entitlement
    WHERE entitlement.tenant_id = source.tenant_id
  ), '{}'::jsonb),
  source.published_at, NULL
FROM (
  SELECT tenant.id AS tenant_id, tenant.plan_code, tenant.created_at AS published_at
  FROM enterprise.tenants tenant
  UNION
  SELECT subscription.tenant_id, subscription.plan_code,
    min(subscription.current_period_start) AS published_at
  FROM enterprise.subscriptions subscription
  GROUP BY subscription.tenant_id, subscription.plan_code
) source
ON CONFLICT (tenant_id, plan_code, plan_version) DO NOTHING;

ALTER TABLE enterprise.subscriptions
  ADD COLUMN billing_account_id uuid,
  ADD COLUMN plan_version text,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz;
UPDATE enterprise.subscriptions
SET billing_account_id = tenant_id,
  plan_version = 'migration-v1',
  created_at = current_period_start,
  updated_at = current_period_start;
ALTER TABLE enterprise.subscriptions
  ALTER COLUMN billing_account_id SET NOT NULL,
  ALTER COLUMN plan_version SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT subscriptions_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  ADD CONSTRAINT subscriptions_plan_version_fk
    FOREIGN KEY (tenant_id, plan_code, plan_version)
    REFERENCES enterprise.billing_plan_versions (
      tenant_id, plan_code, plan_version
    );

INSERT INTO enterprise.subscriptions(
  id, tenant_id, billing_account_id, plan_code, plan_version,
  status, seats, billing_cycle, current_period_start, current_period_end,
  created_at, updated_at, version
)
SELECT md5('enterprise-subscription:' || tenant.id::text || ':migration-v1')::uuid,
  tenant.id, tenant.id, tenant.plan_code, 'migration-v1', 'active', 0,
  'monthly', transaction_timestamp(), transaction_timestamp() + interval '1 month',
  transaction_timestamp(), transaction_timestamp(), 1
FROM enterprise.tenants tenant
WHERE NOT EXISTS (
  SELECT 1 FROM enterprise.subscriptions subscription
  WHERE subscription.tenant_id = tenant.id
)
ON CONFLICT DO NOTHING;

WITH ranked AS (
  SELECT id, tenant_id, row_number() OVER (
    PARTITION BY tenant_id, billing_account_id
    ORDER BY current_period_start DESC, id DESC
  ) AS position
  FROM enterprise.subscriptions
  WHERE status = 'active'
)
UPDATE enterprise.subscriptions subscription
SET status = 'superseded', updated_at = transaction_timestamp(),
  version = subscription.version + 1
FROM ranked
WHERE subscription.tenant_id = ranked.tenant_id
  AND subscription.id = ranked.id AND ranked.position > 1;
CREATE UNIQUE INDEX subscriptions_one_active_account_idx
  ON enterprise.subscriptions (tenant_id, billing_account_id)
  WHERE status = 'active';

ALTER TABLE enterprise.entitlements
  ADD COLUMN billing_account_id uuid,
  ADD COLUMN entitlement_version text,
  ADD COLUMN updated_at timestamptz;
UPDATE enterprise.entitlements
SET billing_account_id = tenant_id,
  entitlement_version = 'migration-v1',
  updated_at = effective_from;
ALTER TABLE enterprise.entitlements
  ALTER COLUMN billing_account_id SET NOT NULL,
  ALTER COLUMN entitlement_version SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT entitlements_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id);

CREATE TABLE enterprise.entitlement_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  billing_account_id uuid NOT NULL,
  subscription_id uuid,
  entitlement_version text NOT NULL
    CHECK (length(btrim(entitlement_version)) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  plan_code text NOT NULL,
  plan_version text NOT NULL,
  entitlements jsonb NOT NULL DEFAULT '{}',
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entitlement_version),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES enterprise.subscriptions (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_code, plan_version)
    REFERENCES enterprise.billing_plan_versions (
      tenant_id, plan_code, plan_version
    ),
  CHECK (jsonb_typeof(entitlements) = 'object'),
  CHECK (
    (status = 'active' AND subscription_id IS NOT NULL
      AND effective_until IS NULL)
    OR (status = 'retired' AND effective_until IS NOT NULL)
  ),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE UNIQUE INDEX entitlement_snapshots_one_active_idx
  ON enterprise.entitlement_snapshots (tenant_id)
  WHERE status = 'active';

INSERT INTO enterprise.entitlement_snapshots(
  id, tenant_id, billing_account_id, subscription_id,
  entitlement_version, status, plan_code, plan_version, entitlements,
  effective_from, effective_until, created_at
)
SELECT md5('enterprise-entitlement:' || tenant.id::text || ':migration-v1')::uuid,
  tenant.id, tenant.id,
  (SELECT subscription.id FROM enterprise.subscriptions subscription
    WHERE subscription.tenant_id = tenant.id
    ORDER BY subscription.current_period_start DESC, subscription.id DESC
    LIMIT 1),
  'migration-v1', 'active', tenant.plan_code, 'migration-v1',
  COALESCE((
    SELECT jsonb_object_agg(entitlement_key, jsonb_build_object(
      'enabled', enabled, 'limit', limit_value
    ))
    FROM enterprise.entitlements entitlement
    WHERE entitlement.tenant_id = tenant.id
  ), '{}'::jsonb),
  tenant.created_at, NULL, tenant.created_at
FROM enterprise.tenants tenant
ON CONFLICT (tenant_id, entitlement_version) DO NOTHING;

ALTER TABLE enterprise.entitlements
  ADD CONSTRAINT entitlements_snapshot_version_fk
  FOREIGN KEY (tenant_id, entitlement_version)
  REFERENCES enterprise.entitlement_snapshots (
    tenant_id, entitlement_version
  );

INSERT INTO enterprise.entitlement_snapshots(
  id, tenant_id, billing_account_id, subscription_id,
  entitlement_version, status, plan_code, plan_version, entitlements,
  effective_from, effective_until, created_at
)
SELECT md5('enterprise-entitlement:' || binding.tenant_id::text || ':' ||
    binding.entitlement_version)::uuid,
  binding.tenant_id, binding.tenant_id, NULL, binding.entitlement_version,
  'retired', tenant.plan_code, 'migration-v1', '{}',
  binding.started_at, binding.started_at, binding.started_at
FROM enterprise.communication_session_bindings binding
JOIN enterprise.tenants tenant ON tenant.id = binding.tenant_id
WHERE binding.entitlement_version <> 'migration-v1'
ON CONFLICT (tenant_id, entitlement_version) DO NOTHING;

ALTER TABLE enterprise.communication_session_bindings
  ADD CONSTRAINT communication_bindings_entitlement_version_fk
  FOREIGN KEY (tenant_id, entitlement_version)
  REFERENCES enterprise.entitlement_snapshots (
    tenant_id, entitlement_version
  );

CREATE TABLE enterprise.billing_subscription_changes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  billing_account_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  entitlement_snapshot_id uuid NOT NULL,
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK (enterprise.is_actor_subject_id(actor_id)),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES enterprise.subscriptions (tenant_id, id),
  FOREIGN KEY (tenant_id, entitlement_snapshot_id)
    REFERENCES enterprise.entitlement_snapshots (tenant_id, id)
);

ALTER TABLE enterprise.usage_budgets
  ADD COLUMN billing_account_id uuid;
UPDATE enterprise.usage_budgets SET billing_account_id = tenant_id;
ALTER TABLE enterprise.usage_budgets
  ALTER COLUMN billing_account_id SET NOT NULL,
  ADD CONSTRAINT usage_budgets_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id);

ALTER TABLE enterprise.usage_holds
  ADD COLUMN billing_account_id uuid;
UPDATE enterprise.usage_holds hold_record
SET billing_account_id = budget.billing_account_id
FROM enterprise.usage_budgets budget
WHERE budget.tenant_id = hold_record.tenant_id
  AND budget.id = hold_record.budget_id;
ALTER TABLE enterprise.usage_holds
  ALTER COLUMN billing_account_id SET NOT NULL,
  ADD CONSTRAINT usage_holds_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id);

ALTER TABLE enterprise.usage_ledger
  ADD COLUMN billing_account_id uuid;
UPDATE enterprise.usage_ledger SET billing_account_id = tenant_id;
ALTER TABLE enterprise.usage_ledger
  ALTER COLUMN billing_account_id SET NOT NULL,
  ADD CONSTRAINT usage_ledger_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id);

ALTER TABLE enterprise.worker_dispatch_grants
  ADD COLUMN billing_account_id uuid,
  ADD COLUMN entitlement_version text;
UPDATE enterprise.worker_dispatch_grants grant_record
SET billing_account_id = grant_record.tenant_id,
  entitlement_version = binding.entitlement_version
FROM enterprise.communication_session_bindings binding
WHERE binding.tenant_id = grant_record.tenant_id
  AND binding.communication_session_id = grant_record.communication_session_id;
ALTER TABLE enterprise.worker_dispatch_grants
  ALTER COLUMN billing_account_id SET NOT NULL,
  ALTER COLUMN entitlement_version SET NOT NULL,
  ADD CONSTRAINT worker_dispatch_grants_billing_account_fk
    FOREIGN KEY (tenant_id, billing_account_id)
    REFERENCES enterprise.billing_accounts (tenant_id, id),
  ADD CONSTRAINT worker_dispatch_grants_entitlement_version_fk
    FOREIGN KEY (tenant_id, entitlement_version)
    REFERENCES enterprise.entitlement_snapshots (
      tenant_id, entitlement_version
    );

CREATE OR REPLACE FUNCTION enterprise.reject_billing_plan_version_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'retired' AND OLD.status = 'published'
    AND NEW.retired_at IS NOT NULL
    AND (NEW.id, NEW.tenant_id, NEW.plan_code, NEW.plan_version,
      NEW.currency, NEW.billing_cycle, NEW.seat_limit,
      NEW.entitlements, NEW.published_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.plan_code, OLD.plan_version,
      OLD.currency, OLD.billing_cycle, OLD.seat_limit,
      OLD.entitlements, OLD.published_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise billing plan version is immutable';
END;
$$;
CREATE TRIGGER enterprise_billing_plan_version_immutable
BEFORE UPDATE OR DELETE ON enterprise.billing_plan_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_billing_plan_version_change();

CREATE OR REPLACE FUNCTION enterprise.reject_subscription_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'active' AND NEW.status = 'superseded'
    AND NEW.updated_at >= OLD.updated_at
    AND NEW.version = OLD.version + 1
    AND (NEW.id, NEW.tenant_id, NEW.billing_account_id,
      NEW.plan_code, NEW.plan_version, NEW.seats, NEW.billing_cycle,
      NEW.current_period_start, NEW.current_period_end, NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.billing_account_id,
      OLD.plan_code, OLD.plan_version, OLD.seats, OLD.billing_cycle,
      OLD.current_period_start, OLD.current_period_end, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise subscription is immutable';
END;
$$;
CREATE TRIGGER enterprise_subscription_immutable
BEFORE UPDATE OR DELETE ON enterprise.subscriptions
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_subscription_change();

CREATE OR REPLACE FUNCTION enterprise.reject_entitlement_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'retired' AND OLD.status = 'active'
    AND NEW.effective_until IS NOT NULL
    AND (NEW.id, NEW.tenant_id, NEW.billing_account_id,
      NEW.subscription_id, NEW.entitlement_version, NEW.plan_code,
      NEW.plan_version, NEW.entitlements, NEW.effective_from, NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.billing_account_id,
      OLD.subscription_id, OLD.entitlement_version, OLD.plan_code,
      OLD.plan_version, OLD.entitlements, OLD.effective_from, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise entitlement snapshot is immutable';
END;
$$;
CREATE TRIGGER enterprise_entitlement_snapshot_immutable
BEFORE UPDATE OR DELETE ON enterprise.entitlement_snapshots
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_entitlement_snapshot_change();

CREATE OR REPLACE FUNCTION enterprise.reject_billing_change_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise billing subscription change is append only';
END;
$$;
CREATE TRIGGER enterprise_billing_subscription_change_append_only
BEFORE UPDATE OR DELETE ON enterprise.billing_subscription_changes
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_billing_change_mutation();

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.policy_snapshot_id,
    NEW.policy_version, NEW.billing_account_id, NEW.entitlement_version,
    NEW.idempotency_key, NEW.request_hash, NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.policy_snapshot_id,
    OLD.policy_version, OLD.billing_account_id, OLD.entitlement_version,
    OLD.idempotency_key, OLD.request_hash, OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_accounts', 'billing_plan_versions',
    'entitlement_snapshots', 'billing_subscription_changes'
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
