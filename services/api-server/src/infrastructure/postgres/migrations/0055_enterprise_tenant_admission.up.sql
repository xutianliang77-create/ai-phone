CREATE OR REPLACE FUNCTION enterprise.current_admission_operator_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.admission_operator_id', true), '')
$$;

CREATE TABLE enterprise.cell_admission_policies (
  cell_id text NOT NULL,
  capability text NOT NULL CHECK (capability IN (
    'translation_runtime', 'voice_agent_runtime', 'marketing_pstn',
    'screen_share'
  )),
  total_concurrency_limit integer NOT NULL CHECK (
    total_concurrency_limit BETWEEN 1 AND 10000
  ),
  default_tenant_concurrency_limit integer NOT NULL CHECK (
    default_tenant_concurrency_limit BETWEEN 1 AND 1000 AND
    default_tenant_concurrency_limit <= total_concurrency_limit
  ),
  default_rate_limit integer NOT NULL CHECK (
    default_rate_limit BETWEEN 1 AND 100000
  ),
  rate_window_seconds integer NOT NULL CHECK (
    rate_window_seconds BETWEEN 1 AND 3600
  ),
  total_queue_limit integer NOT NULL CHECK (
    total_queue_limit BETWEEN 1 AND 100000
  ),
  default_tenant_queue_limit integer NOT NULL CHECK (
    default_tenant_queue_limit BETWEEN 1 AND 10000 AND
    default_tenant_queue_limit <= total_queue_limit
  ),
  queue_ttl_seconds integer NOT NULL CHECK (
    queue_ttl_seconds BETWEEN 1 AND 3600
  ),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  version bigint NOT NULL CHECK (version > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (cell_id, capability),
  CHECK (cell_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'),
  CHECK (updated_by ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$')
);

CREATE TABLE enterprise.cell_admission_state (
  cell_id text NOT NULL,
  capability text NOT NULL,
  active_units integer NOT NULL DEFAULT 0 CHECK (active_units >= 0),
  queued_units integer NOT NULL DEFAULT 0 CHECK (queued_units >= 0),
  virtual_time numeric(30, 12) NOT NULL DEFAULT 0 CHECK (virtual_time >= 0),
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (cell_id, capability),
  FOREIGN KEY (cell_id, capability)
    REFERENCES enterprise.cell_admission_policies (cell_id, capability)
    ON DELETE RESTRICT
);

CREATE TABLE enterprise.cell_tenant_admission_state (
  cell_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  capability text NOT NULL,
  active_units integer NOT NULL DEFAULT 0 CHECK (active_units >= 0),
  queued_units integer NOT NULL DEFAULT 0 CHECK (queued_units >= 0),
  weight integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  last_virtual_finish numeric(30, 12) NOT NULL DEFAULT 0 CHECK (
    last_virtual_finish >= 0
  ),
  rate_window_started_at timestamptz NOT NULL,
  rate_admitted_units integer NOT NULL DEFAULT 0 CHECK (
    rate_admitted_units >= 0
  ),
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (cell_id, tenant_id, capability),
  FOREIGN KEY (cell_id, capability)
    REFERENCES enterprise.cell_admission_policies (cell_id, capability)
    ON DELETE RESTRICT
);

CREATE TABLE enterprise.tenant_admission_requests (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  cell_id text NOT NULL,
  capability text NOT NULL,
  resource_type text NOT NULL CHECK (
    resource_type IN ('worker_dispatch', 'marketing_pstn', 'screen_share')
  ),
  resource_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  tenant_limit integer NOT NULL CHECK (tenant_limit BETWEEN 1 AND 1000),
  units integer NOT NULL DEFAULT 1 CHECK (units BETWEEN 1 AND 1000),
  status text NOT NULL CHECK (
    status IN ('queued', 'admitted', 'released', 'expired', 'rejected')
  ),
  virtual_finish numeric(30, 12) NOT NULL CHECK (virtual_finish >= 0),
  lease_owner text,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  queue_expires_at timestamptz NOT NULL,
  queued_at timestamptz NOT NULL,
  admitted_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, capability, idempotency_key),
  UNIQUE (tenant_id, capability, resource_type, resource_id),
  FOREIGN KEY (cell_id, tenant_id, capability)
    REFERENCES enterprise.cell_tenant_admission_state (
      cell_id, tenant_id, capability
    ) ON DELETE RESTRICT,
  CHECK (length(resource_id) BETWEEN 1 AND 200),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (
    (status = 'admitted' AND lease_owner IS NOT NULL AND
      lease_generation > 0 AND lease_expires_at IS NOT NULL AND
      admitted_at IS NOT NULL) OR
    (status <> 'admitted')
  )
);

CREATE INDEX tenant_admission_requests_fair_queue_idx
  ON enterprise.tenant_admission_requests (
    cell_id, capability, status, virtual_finish, queued_at, tenant_id, id
  ) WHERE status = 'queued';
CREATE INDEX tenant_admission_requests_expiry_idx
  ON enterprise.tenant_admission_requests (
    cell_id, capability, status, lease_expires_at, queue_expires_at
  ) WHERE status IN ('queued', 'admitted');

ALTER TABLE enterprise.cell_admission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cell_admission_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cell_admission_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cell_admission_state FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cell_tenant_admission_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.cell_tenant_admission_state FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenant_admission_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenant_admission_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY cell_admission_policy_cell ON enterprise.cell_admission_policies
  USING (cell_id = enterprise.current_cell_id())
  WITH CHECK (cell_id = enterprise.current_cell_id());
CREATE POLICY cell_admission_state_cell ON enterprise.cell_admission_state
  USING (cell_id = enterprise.current_cell_id())
  WITH CHECK (cell_id = enterprise.current_cell_id());
CREATE POLICY cell_tenant_admission_state_cell
  ON enterprise.cell_tenant_admission_state
  USING (
    cell_id = enterprise.current_cell_id() OR
    tenant_id = enterprise.current_tenant_id()
  )
  WITH CHECK (
    cell_id = enterprise.current_cell_id() OR
    tenant_id = enterprise.current_tenant_id()
  );
CREATE POLICY tenant_admission_requests_cell
  ON enterprise.tenant_admission_requests
  USING (
    cell_id = enterprise.current_cell_id() OR
    tenant_id = enterprise.current_tenant_id()
  )
  WITH CHECK (
    cell_id = enterprise.current_cell_id() OR
    tenant_id = enterprise.current_tenant_id()
  );

CREATE OR REPLACE FUNCTION enterprise.configure_cell_admission_policy(
  p_cell_id text, p_capability text, p_total_concurrency integer,
  p_default_tenant_concurrency integer, p_default_rate_limit integer,
  p_rate_window_seconds integer, p_total_queue_limit integer,
  p_default_tenant_queue_limit integer, p_queue_ttl_seconds integer,
  p_status text, p_expected_version bigint, p_operator text,
  p_now timestamptz
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE result_version bigint;
BEGIN
  IF p_operator IS NULL OR p_operator <> enterprise.current_admission_operator_id() OR
      p_cell_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$' OR
      p_capability NOT IN ('translation_runtime', 'voice_agent_runtime',
        'marketing_pstn', 'screen_share') OR
      p_total_concurrency NOT BETWEEN 1 AND 10000 OR
      p_default_tenant_concurrency NOT BETWEEN 1 AND
        least(1000, p_total_concurrency) OR
      p_default_rate_limit NOT BETWEEN 1 AND 100000 OR
      p_rate_window_seconds NOT BETWEEN 1 AND 3600 OR
      p_total_queue_limit NOT BETWEEN 1 AND 100000 OR
      p_default_tenant_queue_limit NOT BETWEEN 1 AND
        least(10000, p_total_queue_limit) OR
      p_queue_ttl_seconds NOT BETWEEN 1 AND 3600 OR
      p_status NOT IN ('active', 'disabled') OR p_expected_version < 0 OR
      p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' OR
      p_operator !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$' THEN
    RAISE EXCEPTION 'invalid cell admission policy';
  END IF;
  PERFORM set_config('app.cell_id', p_cell_id, true);
  INSERT INTO enterprise.cell_admission_policies(
    cell_id, capability, total_concurrency_limit,
    default_tenant_concurrency_limit, default_rate_limit,
    rate_window_seconds, total_queue_limit, default_tenant_queue_limit,
    queue_ttl_seconds, status, version, updated_by, updated_at
  ) VALUES (
    p_cell_id, p_capability, p_total_concurrency,
    p_default_tenant_concurrency, p_default_rate_limit,
    p_rate_window_seconds, p_total_queue_limit,
    p_default_tenant_queue_limit, p_queue_ttl_seconds,
    p_status, 1, p_operator, p_now
  ) ON CONFLICT (cell_id, capability) DO UPDATE SET
    total_concurrency_limit = excluded.total_concurrency_limit,
    default_tenant_concurrency_limit = excluded.default_tenant_concurrency_limit,
    default_rate_limit = excluded.default_rate_limit,
    rate_window_seconds = excluded.rate_window_seconds,
    total_queue_limit = excluded.total_queue_limit,
    default_tenant_queue_limit = excluded.default_tenant_queue_limit,
    queue_ttl_seconds = excluded.queue_ttl_seconds,
    status = excluded.status,
    version = enterprise.cell_admission_policies.version + 1,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  WHERE enterprise.cell_admission_policies.version = p_expected_version
  RETURNING version INTO result_version;
  IF result_version IS NULL THEN
    RAISE EXCEPTION 'cell admission policy version conflict';
  END IF;
  INSERT INTO enterprise.cell_admission_state(
    cell_id, capability, updated_at
  ) VALUES (p_cell_id, p_capability, p_now)
  ON CONFLICT (cell_id, capability) DO NOTHING;
  RETURN result_version;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.configure_tenant_admission_weight(
  p_cell_id text, p_tenant_id uuid, p_capability text, p_weight integer,
  p_expected_version bigint, p_operator text, p_now timestamptz
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE result_version bigint;
BEGIN
  IF p_operator IS NULL OR p_operator <> enterprise.current_admission_operator_id() OR
      p_weight NOT BETWEEN 1 AND 100 OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'invalid tenant admission weight';
  END IF;
  IF p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid tenant admission weight time';
  END IF;
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM enterprise.tenants tenant
      WHERE tenant.id = p_tenant_id AND tenant.cell_id = p_cell_id
        AND tenant.status <> 'deleted') THEN
    RAISE EXCEPTION 'invalid tenant admission weight';
  END IF;
  PERFORM set_config('app.cell_id', p_cell_id, true);
  INSERT INTO enterprise.cell_tenant_admission_state(
    cell_id, tenant_id, capability, weight,
    rate_window_started_at, updated_at
  ) VALUES (
    p_cell_id, p_tenant_id, p_capability, p_weight, p_now, p_now
  ) ON CONFLICT (cell_id, tenant_id, capability) DO UPDATE SET
    weight = excluded.weight,
    updated_at = excluded.updated_at,
    version = enterprise.cell_tenant_admission_state.version + 1
  WHERE enterprise.cell_tenant_admission_state.version = p_expected_version
    AND enterprise.cell_tenant_admission_state.active_units = 0
    AND enterprise.cell_tenant_admission_state.queued_units = 0
  RETURNING version INTO result_version;
  IF result_version IS NULL THEN
    RAISE EXCEPTION 'tenant admission weight version or activity conflict';
  END IF;
  RETURN result_version;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.cell_admission_status(
  p_cell_id text, p_capability text, p_operator text
) RETURNS TABLE (
  policy_status text, policy_version bigint, total_limit integer,
  active_units integer, queued_units integer, active_tenants bigint,
  queued_tenants bigint
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
BEGIN
  IF p_operator IS NULL OR p_operator <> enterprise.current_admission_operator_id() THEN
    RAISE EXCEPTION 'admission operator identity is required';
  END IF;
  PERFORM set_config('app.cell_id', p_cell_id, true);
  RETURN QUERY
  SELECT policy.status, policy.version, policy.total_concurrency_limit,
    state.active_units, state.queued_units,
    count(*) FILTER (WHERE tenant_state.active_units > 0),
    count(*) FILTER (WHERE tenant_state.queued_units > 0)
  FROM enterprise.cell_admission_policies policy
  JOIN enterprise.cell_admission_state state
    ON state.cell_id = policy.cell_id AND state.capability = policy.capability
  LEFT JOIN enterprise.cell_tenant_admission_state tenant_state
    ON tenant_state.cell_id = policy.cell_id
    AND tenant_state.capability = policy.capability
  WHERE policy.cell_id = p_cell_id AND policy.capability = p_capability
  GROUP BY policy.status, policy.version, policy.total_concurrency_limit,
    state.active_units, state.queued_units;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.reconcile_cell_admission(
  p_cell_id text, p_capability text, p_operator text, p_now timestamptz
) RETURNS TABLE (active_units integer, queued_units integer, expired_count bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE changed bigint;
BEGIN
  IF p_operator IS NULL OR p_operator <> enterprise.current_admission_operator_id() THEN
    RAISE EXCEPTION 'admission operator identity is required';
  END IF;
  IF p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid admission reconcile time';
  END IF;
  PERFORM set_config('app.cell_id', p_cell_id, true);
  PERFORM 1 FROM enterprise.cell_admission_state
  WHERE cell_id = p_cell_id AND capability = p_capability FOR UPDATE;
  WITH expired AS (
    UPDATE enterprise.tenant_admission_requests
    SET status = 'expired', lease_owner = NULL, lease_expires_at = NULL,
      released_at = p_now, updated_at = p_now, version = version + 1
    WHERE cell_id = p_cell_id AND capability = p_capability AND (
      (status = 'admitted' AND lease_expires_at <= p_now) OR
      (status = 'queued' AND queue_expires_at <= p_now)
    ) RETURNING 1
  ) SELECT count(*) INTO changed FROM expired;
  UPDATE enterprise.cell_tenant_admission_state tenant_state
  SET active_units = (SELECT COALESCE(sum(request.units), 0)::integer
      FROM enterprise.tenant_admission_requests request
      WHERE request.cell_id = tenant_state.cell_id
        AND request.tenant_id = tenant_state.tenant_id
        AND request.capability = tenant_state.capability
        AND request.status = 'admitted' AND request.lease_expires_at > p_now),
    queued_units = (SELECT COALESCE(sum(request.units), 0)::integer
      FROM enterprise.tenant_admission_requests request
      WHERE request.cell_id = tenant_state.cell_id
        AND request.tenant_id = tenant_state.tenant_id
        AND request.capability = tenant_state.capability
        AND request.status = 'queued' AND request.queue_expires_at > p_now),
    updated_at = p_now, version = version + 1
  WHERE tenant_state.cell_id = p_cell_id
    AND tenant_state.capability = p_capability
    AND (tenant_state.active_units, tenant_state.queued_units) IS DISTINCT FROM (
      (SELECT COALESCE(sum(request.units), 0)::integer
        FROM enterprise.tenant_admission_requests request
        WHERE request.cell_id = tenant_state.cell_id
          AND request.tenant_id = tenant_state.tenant_id
          AND request.capability = tenant_state.capability
          AND request.status = 'admitted' AND request.lease_expires_at > p_now),
      (SELECT COALESCE(sum(request.units), 0)::integer
        FROM enterprise.tenant_admission_requests request
        WHERE request.cell_id = tenant_state.cell_id
          AND request.tenant_id = tenant_state.tenant_id
          AND request.capability = tenant_state.capability
          AND request.status = 'queued' AND request.queue_expires_at > p_now)
    );
  UPDATE enterprise.cell_admission_state state
  SET active_units = (SELECT COALESCE(sum(request.units), 0)::integer
      FROM enterprise.tenant_admission_requests request
      WHERE request.cell_id = state.cell_id AND request.capability = state.capability
        AND request.status = 'admitted' AND request.lease_expires_at > p_now),
    queued_units = (SELECT COALESCE(sum(request.units), 0)::integer
      FROM enterprise.tenant_admission_requests request
      WHERE request.cell_id = state.cell_id AND request.capability = state.capability
        AND request.status = 'queued' AND request.queue_expires_at > p_now),
    updated_at = p_now, version = version + 1
  WHERE state.cell_id = p_cell_id AND state.capability = p_capability
    AND (state.active_units, state.queued_units) IS DISTINCT FROM (
      (SELECT COALESCE(sum(request.units), 0)::integer
        FROM enterprise.tenant_admission_requests request
        WHERE request.cell_id = state.cell_id
          AND request.capability = state.capability
          AND request.status = 'admitted' AND request.lease_expires_at > p_now),
      (SELECT COALESCE(sum(request.units), 0)::integer
        FROM enterprise.tenant_admission_requests request
        WHERE request.cell_id = state.cell_id
          AND request.capability = state.capability
          AND request.status = 'queued' AND request.queue_expires_at > p_now)
    )
  RETURNING state.active_units, state.queued_units
    INTO active_units, queued_units;
  IF active_units IS NULL THEN
    SELECT state.active_units, state.queued_units
      INTO active_units, queued_units
    FROM enterprise.cell_admission_state state
    WHERE state.cell_id = p_cell_id AND state.capability = p_capability;
  END IF;
  UPDATE enterprise.cell_tenant_admission_state tenant_state
  SET last_virtual_finish = state.virtual_time,
    updated_at = p_now, version = tenant_state.version + 1
  FROM enterprise.cell_admission_state state
  WHERE tenant_state.cell_id = p_cell_id
    AND tenant_state.capability = p_capability
    AND state.cell_id = tenant_state.cell_id
    AND state.capability = tenant_state.capability
    AND tenant_state.active_units = 0 AND tenant_state.queued_units = 0
    AND tenant_state.last_virtual_finish > state.virtual_time;
  expired_count := changed;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.cell_admission_readiness(
  p_cell_id text, p_capability text
) RETURNS TABLE (
  policy_status text, policy_version bigint, total_limit integer,
  active_units integer, queued_units integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
BEGIN
  IF p_cell_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$' OR
      p_capability NOT IN ('translation_runtime', 'voice_agent_runtime',
        'marketing_pstn', 'screen_share') THEN
    RAISE EXCEPTION 'invalid admission readiness request';
  END IF;
  PERFORM set_config('app.cell_id', p_cell_id, true);
  RETURN QUERY SELECT policy.status, policy.version,
    policy.total_concurrency_limit, state.active_units, state.queued_units
  FROM enterprise.cell_admission_policies policy
  JOIN enterprise.cell_admission_state state
    ON state.cell_id = policy.cell_id AND state.capability = policy.capability
  WHERE policy.cell_id = p_cell_id AND policy.capability = p_capability;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.reserve_tenant_admission(
  p_expected_tenant uuid,
  p_request_id uuid,
  p_capability text,
  p_resource_type text,
  p_resource_id text,
  p_idempotency_key text,
  p_request_hash text,
  p_tenant_limit integer,
  p_units integer,
  p_lease_expires_at timestamptz,
  p_now timestamptz
) RETURNS TABLE (
  result_status text, admission_id uuid, used_cell integer,
  cell_limit integer, used_tenant integer, tenant_limit integer,
  queue_position integer, retry_after_ms integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE
  tenant_record record;
  policy_record record;
  cell_state record;
  tenant_state record;
  request_record record;
  head_id uuid;
  effective_tenant_limit integer;
  current_rate integer;
  position integer;
  new_virtual_finish numeric(30, 12);
  expired_record record;
BEGIN
  IF p_expected_tenant IS NULL OR
      p_expected_tenant <> enterprise.current_tenant_id() OR
      p_request_id IS NULL OR p_capability NOT IN (
        'translation_runtime', 'voice_agent_runtime',
        'marketing_pstn', 'screen_share'
      ) OR p_resource_type NOT IN (
        'worker_dispatch', 'marketing_pstn', 'screen_share'
      ) OR p_resource_id IS NULL OR length(p_resource_id) NOT BETWEEN 1 AND 200 OR
      p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 200 OR
      p_request_hash !~ '^[a-f0-9]{64}$' OR
      p_tenant_limit NOT BETWEEN 1 AND 1000 OR p_units NOT BETWEEN 1 AND 1000 OR
      p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' OR
      p_lease_expires_at <= p_now OR
      p_lease_expires_at > p_now + CASE
        WHEN p_capability = 'marketing_pstn' THEN interval '31 minutes'
        ELSE interval '5 minutes' END THEN
    RAISE EXCEPTION 'invalid tenant admission request';
  END IF;

  SELECT id, cell_id, status INTO tenant_record
  FROM enterprise.tenants
  WHERE id = p_expected_tenant FOR UPDATE;
  IF tenant_record.id IS NULL OR tenant_record.status <> 'active' OR
      tenant_record.cell_id IS NULL THEN
    RETURN QUERY SELECT 'not_ready', p_request_id, 0, 0, 0, 0, 0, 1000;
    RETURN;
  END IF;
  PERFORM set_config('app.cell_id', tenant_record.cell_id, true);

  SELECT * INTO policy_record FROM enterprise.cell_admission_policies
  WHERE cell_id = tenant_record.cell_id AND capability = p_capability
  FOR UPDATE;
  IF policy_record.cell_id IS NULL OR policy_record.status <> 'active' THEN
    RETURN QUERY SELECT 'not_ready', p_request_id, 0, 0, 0, 0, 0, 1000;
    RETURN;
  END IF;

  INSERT INTO enterprise.cell_admission_state(
    cell_id, capability, updated_at
  ) VALUES (tenant_record.cell_id, p_capability, p_now)
  ON CONFLICT (cell_id, capability) DO NOTHING;
  SELECT * INTO cell_state FROM enterprise.cell_admission_state
  WHERE cell_id = tenant_record.cell_id AND capability = p_capability
  FOR UPDATE;

  INSERT INTO enterprise.cell_tenant_admission_state(
    cell_id, tenant_id, capability, rate_window_started_at, updated_at
  ) VALUES (
    tenant_record.cell_id, p_expected_tenant, p_capability, p_now, p_now
  ) ON CONFLICT (cell_id, tenant_id, capability) DO NOTHING;

  FOR expired_record IN
    UPDATE enterprise.tenant_admission_requests
    SET status = 'expired', released_at = p_now, updated_at = p_now,
      lease_owner = NULL, lease_expires_at = NULL, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability
      AND status = 'admitted' AND lease_expires_at <= p_now
    RETURNING tenant_id, units
  LOOP
    UPDATE enterprise.cell_tenant_admission_state
    SET active_units = greatest(0, active_units - expired_record.units),
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id
      AND tenant_id = expired_record.tenant_id AND capability = p_capability;
    UPDATE enterprise.cell_admission_state
    SET active_units = greatest(0, active_units - expired_record.units),
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability;
  END LOOP;

  FOR expired_record IN
    UPDATE enterprise.tenant_admission_requests
    SET status = 'expired', released_at = p_now, updated_at = p_now,
      version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability
      AND status = 'queued' AND queue_expires_at <= p_now
    RETURNING tenant_id, units
  LOOP
    UPDATE enterprise.cell_tenant_admission_state
    SET queued_units = greatest(0, queued_units - expired_record.units),
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id
      AND tenant_id = expired_record.tenant_id AND capability = p_capability;
    UPDATE enterprise.cell_admission_state
    SET queued_units = greatest(0, queued_units - expired_record.units),
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability;
  END LOOP;

  SELECT * INTO cell_state FROM enterprise.cell_admission_state
  WHERE cell_id = tenant_record.cell_id AND capability = p_capability
  FOR UPDATE;
  SELECT * INTO tenant_state FROM enterprise.cell_tenant_admission_state
  WHERE cell_id = tenant_record.cell_id AND tenant_id = p_expected_tenant
    AND capability = p_capability FOR UPDATE;
  SELECT * INTO request_record FROM enterprise.tenant_admission_requests
  WHERE tenant_id = p_expected_tenant AND capability = p_capability
    AND idempotency_key = p_idempotency_key FOR UPDATE;

  IF request_record.id IS NOT NULL AND (
      request_record.id <> p_request_id OR
      request_record.resource_type <> p_resource_type OR
      request_record.resource_id <> p_resource_id OR
      request_record.request_hash <> p_request_hash OR
      request_record.units <> p_units) THEN
    RETURN QUERY SELECT 'conflict', request_record.id,
      cell_state.active_units, policy_record.total_concurrency_limit,
      tenant_state.active_units,
      least(p_tenant_limit, policy_record.default_tenant_concurrency_limit),
      0, 0;
    RETURN;
  END IF;

  IF request_record.id IS NULL THEN
    IF cell_state.queued_units + p_units > policy_record.total_queue_limit OR
        tenant_state.queued_units + p_units >
          policy_record.default_tenant_queue_limit THEN
      RETURN QUERY SELECT 'queue_full', p_request_id,
        cell_state.active_units, policy_record.total_concurrency_limit,
        tenant_state.active_units,
        least(p_tenant_limit, policy_record.default_tenant_concurrency_limit),
        0, 1000;
      RETURN;
    END IF;
    new_virtual_finish := greatest(
      cell_state.virtual_time, tenant_state.last_virtual_finish
    ) + p_units::numeric / tenant_state.weight::numeric;
    INSERT INTO enterprise.tenant_admission_requests(
      tenant_id, id, cell_id, capability, resource_type, resource_id,
      idempotency_key, request_hash, tenant_limit, units, status,
      virtual_finish, queue_expires_at, queued_at, updated_at
    ) VALUES (
      p_expected_tenant, p_request_id, tenant_record.cell_id, p_capability,
      p_resource_type, p_resource_id, p_idempotency_key, p_request_hash,
      p_tenant_limit, p_units, 'queued', new_virtual_finish,
      p_now + policy_record.queue_ttl_seconds * interval '1 second',
      p_now, p_now
    );
    UPDATE enterprise.cell_tenant_admission_state
    SET queued_units = queued_units + p_units,
      last_virtual_finish = new_virtual_finish,
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND tenant_id = p_expected_tenant
      AND capability = p_capability;
    UPDATE enterprise.cell_admission_state
    SET queued_units = queued_units + p_units,
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability;
    SELECT * INTO cell_state FROM enterprise.cell_admission_state
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability FOR UPDATE;
    SELECT * INTO tenant_state FROM enterprise.cell_tenant_admission_state
    WHERE cell_id = tenant_record.cell_id AND tenant_id = p_expected_tenant
      AND capability = p_capability FOR UPDATE;
    SELECT * INTO request_record FROM enterprise.tenant_admission_requests
    WHERE tenant_id = p_expected_tenant AND id = p_request_id FOR UPDATE;
  ELSIF request_record.status = 'admitted' AND
      request_record.lease_expires_at > p_now THEN
    RETURN QUERY SELECT 'admitted', request_record.id,
      cell_state.active_units, policy_record.total_concurrency_limit,
      tenant_state.active_units,
      least(request_record.tenant_limit,
        policy_record.default_tenant_concurrency_limit), 0, 0;
    RETURN;
  ELSIF request_record.status <> 'queued' THEN
    RETURN QUERY SELECT 'terminal', request_record.id,
      cell_state.active_units, policy_record.total_concurrency_limit,
      tenant_state.active_units,
      least(request_record.tenant_limit,
        policy_record.default_tenant_concurrency_limit), 0, 0;
    RETURN;
  END IF;

  IF tenant_state.rate_window_started_at +
      policy_record.rate_window_seconds * interval '1 second' <= p_now THEN
    tenant_state.rate_window_started_at := p_now;
    tenant_state.rate_admitted_units := 0;
    UPDATE enterprise.cell_tenant_admission_state
    SET rate_window_started_at = p_now, rate_admitted_units = 0,
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND tenant_id = p_expected_tenant
      AND capability = p_capability;
  END IF;
  effective_tenant_limit := least(
    request_record.tenant_limit,
    policy_record.default_tenant_concurrency_limit
  );
  current_rate := tenant_state.rate_admitted_units;

  IF cell_state.active_units + request_record.units <=
      policy_record.total_concurrency_limit THEN
    SELECT request.id INTO head_id
    FROM enterprise.tenant_admission_requests request
    JOIN enterprise.cell_tenant_admission_state state
      ON state.cell_id = request.cell_id
      AND state.tenant_id = request.tenant_id
      AND state.capability = request.capability
    WHERE request.cell_id = tenant_record.cell_id
      AND request.capability = p_capability AND request.status = 'queued'
      AND state.active_units + request.units <= least(
        request.tenant_limit, policy_record.default_tenant_concurrency_limit
      )
      AND (CASE WHEN state.rate_window_started_at +
          policy_record.rate_window_seconds * interval '1 second' <= p_now
        THEN 0 ELSE state.rate_admitted_units END) + request.units <=
          policy_record.default_rate_limit
    ORDER BY request.virtual_finish, request.queued_at,
      request.tenant_id, request.id
    LIMIT 1 FOR UPDATE OF request SKIP LOCKED;
  END IF;

  IF head_id = request_record.id AND
      tenant_state.active_units + request_record.units <=
        effective_tenant_limit AND
      current_rate + request_record.units <= policy_record.default_rate_limit THEN
    UPDATE enterprise.tenant_admission_requests
    SET status = 'admitted', lease_owner = 'dispatch:pending',
      lease_generation = lease_generation + 1,
      lease_expires_at = p_lease_expires_at, admitted_at = p_now,
      updated_at = p_now, version = version + 1
    WHERE tenant_id = p_expected_tenant AND id = request_record.id;
    UPDATE enterprise.cell_tenant_admission_state
    SET queued_units = greatest(0, queued_units - request_record.units),
      active_units = active_units + request_record.units,
      rate_admitted_units = rate_admitted_units + request_record.units,
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND tenant_id = p_expected_tenant
      AND capability = p_capability;
    UPDATE enterprise.cell_admission_state
    SET queued_units = greatest(0, queued_units - request_record.units),
      active_units = active_units + request_record.units,
      virtual_time = greatest(virtual_time, request_record.virtual_finish),
      updated_at = p_now, version = version + 1
    WHERE cell_id = tenant_record.cell_id AND capability = p_capability
    RETURNING active_units INTO cell_state.active_units;
    RETURN QUERY SELECT 'admitted', request_record.id,
      cell_state.active_units, policy_record.total_concurrency_limit,
      tenant_state.active_units + request_record.units,
      effective_tenant_limit, 0, 0;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO position
  FROM enterprise.tenant_admission_requests request
  WHERE request.cell_id = tenant_record.cell_id
    AND request.capability = p_capability AND request.status = 'queued'
    AND (request.virtual_finish, request.queued_at, request.tenant_id, request.id)
      <= (request_record.virtual_finish, request_record.queued_at,
        request_record.tenant_id, request_record.id);
  RETURN QUERY SELECT 'queued', request_record.id,
    cell_state.active_units, policy_record.total_concurrency_limit,
    tenant_state.active_units, effective_tenant_limit, position, 1000;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.renew_tenant_admission(
  p_expected_tenant uuid, p_capability text, p_resource_id text,
  p_lease_owner text, p_lease_expires_at timestamptz, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE request_record record;
BEGIN
  IF p_expected_tenant <> enterprise.current_tenant_id() OR
      p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$' OR
      p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' OR
      p_lease_expires_at <= p_now OR
      p_lease_expires_at > p_now + CASE
        WHEN p_capability = 'marketing_pstn' THEN interval '31 minutes'
        ELSE interval '5 minutes' END THEN RETURN false; END IF;
  SELECT * INTO request_record FROM enterprise.tenant_admission_requests
  WHERE tenant_id = p_expected_tenant AND capability = p_capability
    AND resource_id = p_resource_id FOR UPDATE;
  IF request_record.id IS NULL OR request_record.status <> 'admitted' OR
      request_record.lease_expires_at <= p_now OR
      request_record.lease_owner NOT IN ('dispatch:pending', p_lease_owner) THEN
    RETURN false;
  END IF;
  UPDATE enterprise.tenant_admission_requests
  SET lease_owner = p_lease_owner, lease_generation = lease_generation + 1,
    lease_expires_at = p_lease_expires_at, updated_at = p_now,
    version = version + 1
  WHERE tenant_id = p_expected_tenant AND id = request_record.id;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.release_tenant_admission(
  p_expected_tenant uuid, p_capability text, p_resource_id text,
  p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
DECLARE request_record record; request_cell_id text;
BEGIN
  IF p_expected_tenant <> enterprise.current_tenant_id() OR
      p_now < clock_timestamp() - interval '1 minute' OR
      p_now > clock_timestamp() + interval '30 seconds' THEN RETURN false; END IF;
  SELECT cell_id INTO request_cell_id FROM enterprise.tenant_admission_requests
  WHERE tenant_id = p_expected_tenant AND capability = p_capability
    AND resource_id = p_resource_id;
  IF request_cell_id IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.cell_id', request_cell_id, true);
  PERFORM 1 FROM enterprise.cell_admission_state
  WHERE cell_id = request_cell_id AND capability = p_capability
  FOR UPDATE;
  SELECT * INTO request_record FROM enterprise.tenant_admission_requests
  WHERE tenant_id = p_expected_tenant AND capability = p_capability
    AND resource_id = p_resource_id FOR UPDATE;
  IF request_record.id IS NULL THEN RETURN false; END IF;
  IF request_record.status IN ('released', 'expired', 'rejected') THEN
    RETURN true;
  END IF;
  UPDATE enterprise.cell_admission_state
  SET active_units = greatest(0, active_units -
      CASE WHEN request_record.status = 'admitted' THEN request_record.units ELSE 0 END),
    queued_units = greatest(0, queued_units -
      CASE WHEN request_record.status = 'queued' THEN request_record.units ELSE 0 END),
    updated_at = p_now, version = version + 1
  WHERE cell_id = request_record.cell_id AND capability = p_capability;
  UPDATE enterprise.cell_tenant_admission_state
  SET active_units = greatest(0, active_units -
      CASE WHEN request_record.status = 'admitted' THEN request_record.units ELSE 0 END),
    queued_units = greatest(0, queued_units -
      CASE WHEN request_record.status = 'queued' THEN request_record.units ELSE 0 END),
    updated_at = p_now, version = version + 1
  WHERE cell_id = request_record.cell_id AND tenant_id = p_expected_tenant
    AND capability = p_capability;
  UPDATE enterprise.tenant_admission_requests
  SET status = 'released', lease_owner = NULL, lease_expires_at = NULL,
    released_at = p_now, updated_at = p_now, version = version + 1
  WHERE tenant_id = p_expected_tenant AND id = request_record.id;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION enterprise.tenant_admission_is_active(
  p_expected_tenant uuid, p_capability text, p_resource_id text,
  p_lease_owner text, p_now timestamptz
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, enterprise AS $$
  SELECT p_expected_tenant = enterprise.current_tenant_id() AND EXISTS (
    SELECT 1 FROM enterprise.tenant_admission_requests request
    WHERE request.tenant_id = p_expected_tenant
      AND request.capability = p_capability
      AND request.resource_id = p_resource_id
      AND request.status = 'admitted' AND request.lease_expires_at > p_now
      AND (p_lease_owner IS NULL OR request.lease_owner = p_lease_owner)
  )
$$;

REVOKE ALL ON enterprise.cell_admission_policies,
  enterprise.cell_admission_state,
  enterprise.cell_tenant_admission_state,
  enterprise.tenant_admission_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise.configure_cell_admission_policy(
  text, text, integer, integer, integer, integer, integer, integer,
  integer, text, bigint, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise.configure_tenant_admission_weight(
  text, uuid, text, integer, bigint, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise.cell_admission_status(
  text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise.reconcile_cell_admission(
  text, text, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.reserve_tenant_admission(
  uuid, uuid, text, text, text, text, text, integer, integer,
  timestamptz, timestamptz
) TO PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.renew_tenant_admission(
  uuid, text, text, text, timestamptz, timestamptz
) TO PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.release_tenant_admission(
  uuid, text, text, timestamptz
) TO PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.tenant_admission_is_active(
  uuid, text, text, text, timestamptz
) TO PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.cell_admission_readiness(text, text)
  TO PUBLIC;
