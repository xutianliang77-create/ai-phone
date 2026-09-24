BEGIN;

-- The existing hold is the session's reservation.  Renewing it changes
-- seconds/expiry monotonically under the existing account lock and aggregate
-- fence; old callers which only settle/release the same seconds still work.
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
  ) ON CONFLICT DO NOTHING
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
        seconds = EXCLUDED.seconds,
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        expires_at = EXCLUDED.expires_at,
        released_at = EXCLUDED.released_at,
        settled_at = EXCLUDED.settled_at,
        settled_seconds = EXCLUDED.settled_seconds
      WHERE EXCLUDED.user_id = ai_phone.usage_holds.user_id
        AND EXCLUDED.session_id IS NOT DISTINCT FROM ai_phone.usage_holds.session_id
        AND EXCLUDED.idempotency_key IS NOT DISTINCT FROM ai_phone.usage_holds.idempotency_key
        AND EXCLUDED.request_hash = ai_phone.usage_holds.request_hash
        AND EXCLUDED.created_at = ai_phone.usage_holds.created_at
        AND EXCLUDED.version = ai_phone.usage_holds.version + 1
        AND ai_phone.usage_holds.status = 'active'
        AND (
          (EXCLUDED.status = 'active'
            AND EXCLUDED.seconds >= ai_phone.usage_holds.seconds
            AND EXCLUDED.expires_at >= ai_phone.usage_holds.expires_at)
          OR (EXCLUDED.status IN ('released','settled')
            AND EXCLUDED.seconds = ai_phone.usage_holds.seconds
            AND EXCLUDED.expires_at = ai_phone.usage_holds.expires_at)
        );
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
VALUES ('046_renewable_usage_holds')
ON CONFLICT (version) DO NOTHING;

COMMIT;
