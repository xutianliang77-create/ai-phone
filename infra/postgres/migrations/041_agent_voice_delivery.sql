BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.agent_delivery_attempts (
  delivery_attempt_id text PRIMARY KEY,
  work_id text NOT NULL REFERENCES ai_phone.agent_works(work_id)
    ON DELETE CASCADE,
  delivery_attempt_number integer NOT NULL
    CHECK (delivery_attempt_number BETWEEN 1 AND 3),
  session_id text NOT NULL,
  leg_id text NOT NULL,
  turn_id text NOT NULL,
  turn_generation bigint NOT NULL CHECK (turn_generation > 0),
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  account_id text NOT NULL,
  client_instance_id text NOT NULL,
  client_participant_identity text NOT NULL,
  worker_participant_identity text,
  ownership_lease_id text NOT NULL,
  ownership_generation bigint NOT NULL CHECK (ownership_generation > 0),
  announcement_hash text NOT NULL,
  playback_id text,
  playback_generation bigint CHECK (playback_generation > 0),
  status text NOT NULL CHECK (status IN (
    'generated', 'claimed', 'queued_for_playback', 'playback_started',
    'playback_ended', 'cancelled', 'failed', 'expired'
  )),
  server_playback_state text NOT NULL CHECK (server_playback_state IN (
    'none', 'queued', 'started', 'ended', 'interrupted', 'failed'
  )),
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claim_id text,
  claim_owner text,
  claim_expires_at timestamptz,
  claim_attempt integer NOT NULL DEFAULT 0 CHECK (claim_attempt >= 0),
  terminal_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE(work_id, delivery_attempt_number),
  CHECK (expires_at > created_at),
  CHECK (announcement_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(delivery_attempt_id) BETWEEN 1 AND 160),
  CHECK (length(work_id) BETWEEN 1 AND 160),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(turn_id) BETWEEN 1 AND 160),
  CHECK (length(account_id) BETWEEN 1 AND 160),
  CHECK (length(client_instance_id) BETWEEN 1 AND 160),
  CHECK (length(client_participant_identity) BETWEEN 1 AND 320),
  CHECK (worker_participant_identity IS NULL OR
    length(worker_participant_identity) BETWEEN 1 AND 320),
  CHECK (length(ownership_lease_id) BETWEEN 1 AND 160),
  CHECK (
    (playback_id IS NULL AND playback_generation IS NULL
      AND worker_participant_identity IS NULL)
    OR (playback_id IS NOT NULL AND playback_generation IS NOT NULL
      AND worker_participant_identity IS NOT NULL)
  ),
  CHECK (
    (claim_id IS NULL AND claim_owner IS NULL AND claim_expires_at IS NULL)
    OR (claim_id IS NOT NULL AND claim_owner IS NOT NULL
      AND claim_expires_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('playback_ended', 'cancelled', 'failed', 'expired')
      AND ended_at IS NOT NULL)
    OR status NOT IN ('playback_ended', 'cancelled', 'failed', 'expired')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_delivery_one_active_work_idx
  ON ai_phone.agent_delivery_attempts(work_id)
  WHERE status IN (
    'generated', 'claimed', 'queued_for_playback', 'playback_started'
  );

CREATE INDEX IF NOT EXISTS agent_delivery_claim_idx
  ON ai_phone.agent_delivery_attempts(available_at, created_at, delivery_attempt_id)
  WHERE status IN ('generated', 'claimed');

CREATE INDEX IF NOT EXISTS agent_delivery_expiry_idx
  ON ai_phone.agent_delivery_attempts(expires_at, delivery_attempt_id)
  WHERE status IN (
    'generated', 'claimed', 'queued_for_playback', 'playback_started'
  );

CREATE TABLE IF NOT EXISTS ai_phone.agent_delivery_receipts (
  receipt_id text PRIMARY KEY,
  delivery_attempt_id text NOT NULL
    REFERENCES ai_phone.agent_delivery_attempts(delivery_attempt_id)
    ON DELETE CASCADE,
  receipt_type text NOT NULL CHECK (receipt_type IN (
    'client.playback.started', 'client.playback.ended',
    'client.playback.failed'
  )),
  receipt_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (length(receipt_id) BETWEEN 1 AND 160),
  CHECK (receipt_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS agent_delivery_receipts_attempt_idx
  ON ai_phone.agent_delivery_receipts(
    delivery_attempt_id, occurred_at, receipt_id
  );

CREATE TABLE IF NOT EXISTS ai_phone.agent_delivery_client_events (
  event_id text PRIMARY KEY,
  delivery_attempt_id text NOT NULL
    REFERENCES ai_phone.agent_delivery_attempts(delivery_attempt_id)
    ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'agent.delivery.queued', 'agent.delivery.started',
    'agent.delivery.ended', 'agent.delivery.interrupted',
    'agent.delivery.failed'
  )),
  event_hash text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL CHECK (status IN ('pending', 'published', 'expired')),
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claim_id text,
  claim_owner text,
  claim_expires_at timestamptz,
  publish_attempt integer NOT NULL DEFAULT 0 CHECK (publish_attempt >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  CHECK (length(event_id) BETWEEN 1 AND 200),
  CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK (
    (claim_id IS NULL AND claim_owner IS NULL AND claim_expires_at IS NULL)
    OR (claim_id IS NOT NULL AND claim_owner IS NOT NULL
      AND claim_expires_at IS NOT NULL)
  ),
  CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR status <> 'published'
  )
);

CREATE INDEX IF NOT EXISTS agent_delivery_client_event_claim_idx
  ON ai_phone.agent_delivery_client_events(
    available_at, created_at, event_id
  ) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION ai_phone.claim_agent_deliveries(
  requested_owner text,
  requested_batch_id text,
  requested_limit integer,
  requested_lease_seconds integer,
  requested_owner_concurrency integer,
  requested_now timestamptz DEFAULT now()
) RETURNS SETOF ai_phone.agent_delivery_attempts
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer;
  available_slots integer;
BEGIN
  IF length(trim(requested_owner)) < 8 OR length(requested_owner) > 200 OR
    length(trim(requested_batch_id)) < 8 OR length(requested_batch_id) > 160 OR
    requested_limit < 1 OR requested_limit > 25 OR
    requested_lease_seconds < 5 OR requested_lease_seconds > 120 OR
    requested_owner_concurrency < 1 OR requested_owner_concurrency > 8 OR
    requested_now IS NULL THEN
    RAISE EXCEPTION 'Invalid Agent delivery claim parameters';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('agent-delivery-owner:' || requested_owner, 0)
  );

  SELECT count(*)::integer INTO active_count
  FROM ai_phone.agent_delivery_attempts
  WHERE claim_owner = requested_owner
    AND claim_expires_at > requested_now
    AND status = 'claimed';

  available_slots := LEAST(
    requested_limit,
    GREATEST(0, requested_owner_concurrency - active_count)
  );
  IF available_slots = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT attempt.delivery_attempt_id,
      row_number() OVER (
        ORDER BY attempt.available_at, attempt.created_at,
          attempt.delivery_attempt_id
      ) AS ordinal
    FROM ai_phone.agent_delivery_attempts AS attempt
    WHERE attempt.available_at <= requested_now
      AND attempt.expires_at > requested_now
      AND (
        attempt.status = 'generated'
        OR (attempt.status = 'claimed'
          AND attempt.claim_expires_at <= requested_now)
      )
    ORDER BY attempt.available_at, attempt.created_at,
      attempt.delivery_attempt_id
    FOR UPDATE SKIP LOCKED
    LIMIT available_slots
  )
  UPDATE ai_phone.agent_delivery_attempts AS attempt
  SET status = 'claimed',
    claim_id = requested_batch_id || ':' || candidates.ordinal::text,
    claim_owner = requested_owner,
    claim_expires_at = LEAST(
      attempt.expires_at,
      requested_now + make_interval(secs => requested_lease_seconds)
    ),
    claim_attempt = attempt.claim_attempt + 1,
    version = attempt.version + 1,
    updated_at = requested_now
  FROM candidates
  WHERE attempt.delivery_attempt_id = candidates.delivery_attempt_id
  RETURNING attempt.*;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('041_agent_voice_delivery')
ON CONFLICT (version) DO NOTHING;

COMMIT;
