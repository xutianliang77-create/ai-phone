BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.billing_entitlements (
  user_id text PRIMARY KEY,
  plan_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  source_order_id text,
  version bigint NOT NULL CHECK (version > 0),
  effective_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_phone.payment_orders (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  product_id text NOT NULL,
  provider text NOT NULL,
  amount_cny numeric(12, 2) NOT NULL CHECK (amount_cny >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider_order_id text,
  transaction_id text,
  verification_source text,
  failure_reason text,
  refund_reason text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) BETWEEN 16 AND 128),
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_user_idempotency_idx
  ON ai_phone.payment_orders(user_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_order_idx
  ON ai_phone.payment_orders(provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_provider_transaction_idx
  ON ai_phone.payment_orders(provider, transaction_id)
  WHERE transaction_id IS NOT NULL AND status <> 'failed';
CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx
  ON ai_phone.payment_orders(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_phone.billing_notifications (
  id text PRIMARY KEY,
  provider text NOT NULL,
  notification_type text NOT NULL,
  action text NOT NULL,
  order_id text,
  transaction_id text,
  request_hash text NOT NULL CHECK (length(request_hash) BETWEEN 16 AND 128),
  received_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_notifications_order_idx
  ON ai_phone.billing_notifications(order_id, received_at DESC)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ai_phone.apply_billing_projection_event(
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
  IF event_namespace NOT IN ('billingEntitlements', 'paymentOrders',
    'billingNotifications') THEN
    RAISE EXCEPTION 'Unsupported billing projection namespace: %', event_namespace;
  END IF;
  IF event_operation <> 'upsert' OR event_payload IS NULL THEN
    RAISE EXCEPTION 'Billing records are append/update only';
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
    WHEN 'billingEntitlements' THEN
      INSERT INTO ai_phone.billing_entitlements(
        user_id, plan_code, status, source_order_id, version,
        effective_at, updated_at
      ) VALUES (
        event_payload->>'userId', event_payload->>'planCode',
        event_payload->>'status', event_payload->>'sourceOrderId',
        (event_payload->>'version')::bigint,
        (event_payload->>'effectiveAt')::timestamptz,
        (event_payload->>'updatedAt')::timestamptz
      ) ON CONFLICT (user_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        status = EXCLUDED.status,
        source_order_id = EXCLUDED.source_order_id,
        version = EXCLUDED.version,
        effective_at = EXCLUDED.effective_at,
        updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.version = ai_phone.billing_entitlements.version + 1;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Billing entitlement version conflict'; END IF;

    WHEN 'paymentOrders' THEN
      INSERT INTO ai_phone.payment_orders(
        id, user_id, product_id, provider, amount_cny, status,
        provider_order_id, transaction_id, verification_source,
        failure_reason, refund_reason, idempotency_key, request_hash,
        version, created_at, expires_at, paid_at, refunded_at
      ) VALUES (
        event_payload->>'id', event_payload->>'userId', event_payload->>'productId',
        event_payload->>'provider', (event_payload->>'amountCny')::numeric,
        event_payload->>'status', event_payload->>'providerOrderId',
        event_payload->>'transactionId', event_payload->>'verificationSource',
        event_payload->>'failureReason', event_payload->>'refundReason',
        event_payload->>'idempotencyKey', event_payload->>'requestHash',
        (event_payload->>'version')::bigint,
        (event_payload->>'createdAt')::timestamptz,
        NULLIF(event_payload->>'expiresAt', '')::timestamptz,
        NULLIF(event_payload->>'paidAt', '')::timestamptz,
        NULLIF(event_payload->>'refundedAt', '')::timestamptz
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        provider_order_id = EXCLUDED.provider_order_id,
        transaction_id = EXCLUDED.transaction_id,
        verification_source = EXCLUDED.verification_source,
        failure_reason = EXCLUDED.failure_reason,
        refund_reason = EXCLUDED.refund_reason,
        version = EXCLUDED.version,
        expires_at = EXCLUDED.expires_at,
        paid_at = EXCLUDED.paid_at,
        refunded_at = EXCLUDED.refunded_at
      WHERE EXCLUDED.user_id = ai_phone.payment_orders.user_id
        AND EXCLUDED.product_id = ai_phone.payment_orders.product_id
        AND EXCLUDED.provider = ai_phone.payment_orders.provider
        AND EXCLUDED.amount_cny = ai_phone.payment_orders.amount_cny
        AND EXCLUDED.idempotency_key = ai_phone.payment_orders.idempotency_key
        AND EXCLUDED.request_hash = ai_phone.payment_orders.request_hash
        AND EXCLUDED.version = ai_phone.payment_orders.version + 1;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Payment order version conflict'; END IF;

    WHEN 'billingNotifications' THEN
      INSERT INTO ai_phone.billing_notifications(
        id, provider, notification_type, action, order_id,
        transaction_id, request_hash, received_at
      ) VALUES (
        event_payload->>'id', event_payload->>'provider',
        event_payload->>'notificationType', event_payload->>'action',
        event_payload->>'orderId', event_payload->>'transactionId',
        event_payload->>'requestHash',
        (event_payload->>'receivedAt')::timestamptz
      );
  END CASE;
  RETURN true;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('027_billing_atomicity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
