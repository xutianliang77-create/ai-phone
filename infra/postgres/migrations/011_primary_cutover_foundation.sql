BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.projection_records (
  namespace text NOT NULL,
  record_key text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(namespace, record_key)
);

CREATE TABLE IF NOT EXISTS ai_phone.reliable_outbox_events (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  session_id text,
  aggregate_version bigint,
  sequence bigint,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  published_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reliable_outbox_claim_idx
  ON ai_phone.reliable_outbox_events(available_at, created_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE OR REPLACE FUNCTION ai_phone.claim_reliable_outbox(
  claim_owner text,
  claim_limit integer,
  lease_seconds integer
) RETURNS SETOF ai_phone.reliable_outbox_events
LANGUAGE plpgsql
AS $$
BEGIN
  IF length(claim_owner) < 8 OR claim_limit < 1 OR claim_limit > 200 OR
    lease_seconds < 5 OR lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invalid outbox claim parameters';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM ai_phone.reliable_outbox_events
    WHERE published_at IS NULL
      AND dead_lettered_at IS NULL
      AND available_at <= now()
      AND (lease_until IS NULL OR lease_until <= now())
    ORDER BY available_at, created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT claim_limit
  )
  UPDATE ai_phone.reliable_outbox_events AS event
  SET lease_owner = claim_owner,
      lease_until = now() + make_interval(secs => lease_seconds),
      attempts = event.attempts + 1
  FROM candidates
  WHERE event.id = candidates.id
  RETURNING event.*;
END;
$$;

CREATE OR REPLACE FUNCTION ai_phone.compare_and_set_provider_operation(
  target_id text,
  expected_version bigint,
  next_status text,
  next_external_operation_id text DEFAULT NULL,
  next_external_resource_id text DEFAULT NULL,
  next_error_class text DEFAULT NULL
) RETURNS ai_phone.provider_operations
LANGUAGE plpgsql
AS $$
DECLARE
  updated ai_phone.provider_operations;
BEGIN
  UPDATE ai_phone.provider_operations
  SET status = next_status,
      version = version + 1,
      external_operation_id = COALESCE(
        next_external_operation_id, external_operation_id
      ),
      external_resource_id = COALESCE(
        next_external_resource_id, external_resource_id
      ),
      last_error_class = COALESCE(next_error_class, last_error_class),
      updated_at = now()
  WHERE id = target_id AND version = expected_version
  RETURNING * INTO updated;
  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'provider operation version conflict';
  END IF;
  RETURN updated;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('011_primary_cutover_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
