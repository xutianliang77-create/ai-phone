BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.usage_accounts (
  user_id text PRIMARY KEY,
  plan_code text NOT NULL,
  monthly_seconds integer NOT NULL CHECK (monthly_seconds >= 0),
  remaining_seconds integer NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_phone.usage_holds (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text,
  seconds integer NOT NULL CHECK (seconds > 0),
  status text NOT NULL CHECK (status IN ('active', 'released', 'settled')),
  idempotency_key text,
  request_hash text NOT NULL CHECK (length(request_hash) BETWEEN 16 AND 128),
  note text,
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  settled_at timestamptz,
  settled_seconds integer CHECK (settled_seconds IS NULL OR settled_seconds >= 0),
  CHECK (expires_at > created_at),
  CHECK (status = 'active' OR released_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_holds_idempotency_idx
  ON ai_phone.usage_holds(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS usage_holds_active_session_idx
  ON ai_phone.usage_holds(user_id, session_id)
  WHERE session_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS usage_holds_active_expiry_idx
  ON ai_phone.usage_holds(user_id, expires_at, id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ai_phone.billing_ledger_entries (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('purchase', 'usage', 'refund')),
  source text NOT NULL,
  delta_seconds integer NOT NULL,
  balance_after integer NOT NULL,
  order_id text,
  product_id text,
  session_id text,
  idempotency_key text,
  request_hash text NOT NULL CHECK (length(request_hash) BETWEEN 16 AND 128),
  note text,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_idempotency_idx
  ON ai_phone.billing_ledger_entries(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_ledger_user_created_idx
  ON ai_phone.billing_ledger_entries(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS billing_ledger_session_idx
  ON ai_phone.billing_ledger_entries(session_id, created_at)
  WHERE session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ai_phone.apply_usage_projection_event(
  event_id text,
  event_namespace text,
  record_key text,
  event_operation text,
  event_payload jsonb
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  inserted boolean;
  affected integer;
BEGIN
  IF event_namespace NOT IN ('usageAccounts', 'usageHolds', 'billingLedger') THEN
    RAISE EXCEPTION 'Unsupported usage projection namespace: %', event_namespace;
  END IF;
  IF event_operation <> 'upsert' OR event_payload IS NULL THEN
    RAISE EXCEPTION 'Usage accounting records are append/update only';
  END IF;

  INSERT INTO ai_phone.postgres_projection_inbox(
    event_id, namespace, record_key, operation, payload_hash
  ) VALUES (
    event_id, event_namespace, record_key, event_operation,
    md5(event_payload::text)
  ) ON CONFLICT (event_id) DO NOTHING
  RETURNING true INTO inserted;
  IF NOT COALESCE(inserted, false) THEN RETURN false; END IF;

  CASE event_namespace
    WHEN 'usageAccounts' THEN
      INSERT INTO ai_phone.usage_accounts(
        user_id, plan_code, monthly_seconds, remaining_seconds, version, updated_at
      ) VALUES (
        event_payload->>'userId', event_payload->>'planCode',
        (event_payload->>'monthlySeconds')::integer,
        (event_payload->>'remainingSeconds')::integer,
        (event_payload->>'version')::bigint,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (user_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        monthly_seconds = EXCLUDED.monthly_seconds,
        remaining_seconds = EXCLUDED.remaining_seconds,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.version = ai_phone.usage_accounts.version + 1;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Usage account version conflict'; END IF;

    WHEN 'usageHolds' THEN
      INSERT INTO ai_phone.usage_holds(
        id, user_id, session_id, seconds, status, idempotency_key, request_hash,
        note, version, created_at, expires_at, released_at, settled_at,
        settled_seconds
      ) VALUES (
        event_payload->>'id', event_payload->>'userId', event_payload->>'sessionId',
        (event_payload->>'seconds')::integer, event_payload->>'status',
        event_payload->>'idempotencyKey', event_payload->>'requestHash',
        event_payload->>'note',
        (event_payload->>'version')::bigint,
        (event_payload->>'createdAt')::timestamptz,
        (event_payload->>'expiresAt')::timestamptz,
        NULLIF(event_payload->>'releasedAt', '')::timestamptz,
        NULLIF(event_payload->>'settledAt', '')::timestamptz,
        NULLIF(event_payload->>'settledSeconds', '')::integer
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        released_at = EXCLUDED.released_at,
        settled_at = EXCLUDED.settled_at,
        settled_seconds = EXCLUDED.settled_seconds
      WHERE EXCLUDED.user_id = ai_phone.usage_holds.user_id
        AND EXCLUDED.session_id IS NOT DISTINCT FROM ai_phone.usage_holds.session_id
        AND EXCLUDED.seconds = ai_phone.usage_holds.seconds
        AND EXCLUDED.request_hash = ai_phone.usage_holds.request_hash
        AND EXCLUDED.version = ai_phone.usage_holds.version + 1;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Usage hold version conflict'; END IF;

    WHEN 'billingLedger' THEN
      INSERT INTO ai_phone.billing_ledger_entries(
        id, user_id, entry_type, source, delta_seconds, balance_after,
        order_id, product_id, session_id, idempotency_key, request_hash,
        note, created_at
      ) VALUES (
        event_payload->>'id', event_payload->>'userId', event_payload->>'type',
        event_payload->>'source', (event_payload->>'deltaSeconds')::integer,
        (event_payload->>'balanceAfter')::integer, event_payload->>'orderId',
        event_payload->>'productId', event_payload->>'sessionId',
        event_payload->>'idempotencyKey', event_payload->>'requestHash',
        event_payload->>'note',
        (event_payload->>'createdAt')::timestamptz
      );
  END CASE;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('019_usage_accounting')
ON CONFLICT (version) DO NOTHING;

COMMIT;
