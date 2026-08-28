BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.agent_works (
  work_id text PRIMARY KEY,
  agent_run_id text NOT NULL REFERENCES ai_phone.agent_runs(id)
    ON DELETE CASCADE,
  session_id text NOT NULL,
  leg_id text NOT NULL,
  turn_id text NOT NULL,
  actor_id text NOT NULL,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  submission_key text NOT NULL,
  request_hash text NOT NULL,
  arguments_hash text NOT NULL,
  sealed_arguments text NOT NULL,
  consent_snapshot_id text NOT NULL,
  explicit_instruction_evidence_hash text NOT NULL,
  policy_version text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'sensitive')),
  side_effect_scopes jsonb NOT NULL,
  priority text NOT NULL CHECK (priority IN ('normal', 'permission')),
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'delegated', 'finalizing', 'cancelling',
    'completed', 'cancelled', 'failed'
  )),
  turn_generation bigint NOT NULL CHECK (turn_generation > 0),
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  max_runtime_ms integer NOT NULL
    CHECK (max_runtime_ms BETWEEN 1000 AND 1800000),
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  claim_id text,
  claim_owner text,
  claim_expires_at timestamptz,
  cancellation_reason text,
  cancel_requested_at timestamptz,
  cancel_deadline_at timestamptz,
  result_summary jsonb,
  last_error_code text,
  failure_code text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  UNIQUE(session_id, actor_id, tool_name, submission_key),
  CHECK (expires_at > created_at),
  CHECK (jsonb_typeof(side_effect_scopes) = 'array'),
  CHECK (jsonb_array_length(side_effect_scopes) BETWEEN 1 AND 8),
  CHECK (length(work_id) BETWEEN 1 AND 160),
  CHECK (length(agent_run_id) BETWEEN 1 AND 160),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(turn_id) BETWEEN 1 AND 160),
  CHECK (length(actor_id) BETWEEN 1 AND 160),
  CHECK (length(tool_name) BETWEEN 1 AND 120),
  CHECK (length(tool_version) BETWEEN 1 AND 80),
  CHECK (length(submission_key) BETWEEN 1 AND 240),
  CHECK (length(consent_snapshot_id) BETWEEN 1 AND 160),
  CHECK (length(policy_version) BETWEEN 1 AND 160),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(sealed_arguments) BETWEEN 32 AND 65536),
  CHECK (explicit_instruction_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (
    (claim_id IS NULL AND claim_owner IS NULL AND claim_expires_at IS NULL)
    OR
    (claim_id IS NOT NULL AND claim_owner IS NOT NULL
      AND claim_expires_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('completed', 'cancelled', 'failed') AND ended_at IS NOT NULL)
    OR
    (status NOT IN ('completed', 'cancelled', 'failed'))
  ),
  CHECK (
    (status = 'cancelling' AND cancel_requested_at IS NOT NULL
      AND cancel_deadline_at IS NOT NULL)
    OR status <> 'cancelling'
  )
);

CREATE INDEX IF NOT EXISTS agent_works_claim_idx
  ON ai_phone.agent_works(
    priority DESC, available_at, created_at, work_id
  )
  WHERE status IN ('queued', 'running', 'delegated', 'finalizing', 'cancelling');

CREATE INDEX IF NOT EXISTS agent_works_session_status_idx
  ON ai_phone.agent_works(session_id, status, updated_at DESC, work_id);

CREATE INDEX IF NOT EXISTS agent_works_claim_expiry_idx
  ON ai_phone.agent_works(claim_expires_at, work_id)
  WHERE status IN ('running', 'delegated', 'finalizing', 'cancelling');

CREATE INDEX IF NOT EXISTS agent_works_cancel_deadline_idx
  ON ai_phone.agent_works(cancel_deadline_at, work_id)
  WHERE status = 'cancelling';

CREATE OR REPLACE FUNCTION ai_phone.claim_agent_works(
  requested_owner text,
  requested_batch_id text,
  requested_limit integer,
  requested_lease_seconds integer,
  requested_owner_concurrency integer,
  requested_now timestamptz DEFAULT now()
) RETURNS SETOF ai_phone.agent_works
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer;
  available_slots integer;
BEGIN
  IF length(trim(requested_owner)) < 8 OR length(requested_owner) > 200 OR
    length(trim(requested_batch_id)) < 8 OR length(requested_batch_id) > 160 OR
    requested_limit < 1 OR requested_limit > 50 OR
    requested_lease_seconds < 5 OR requested_lease_seconds > 300 OR
    requested_owner_concurrency < 1 OR requested_owner_concurrency > 8 OR
    requested_now IS NULL THEN
    RAISE EXCEPTION 'Invalid Agent Work claim parameters';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('agent-work-owner:' || requested_owner, 0)
  );

  SELECT count(*)::integer INTO active_count
  FROM ai_phone.agent_works
  WHERE claim_owner = requested_owner
    AND claim_expires_at > requested_now
    AND status IN ('running', 'delegated', 'finalizing', 'cancelling');

  available_slots := LEAST(
    requested_limit,
    GREATEST(0, requested_owner_concurrency - active_count)
  );
  IF available_slots = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH locked AS (
    SELECT candidate.work_id, candidate.priority, candidate.available_at,
      candidate.created_at
    FROM ai_phone.agent_works AS candidate
    WHERE candidate.available_at <= requested_now
      AND candidate.expires_at > requested_now
      AND (
        (candidate.status = 'queued'
          AND candidate.attempt < candidate.max_attempts)
        OR (
          candidate.status IN ('running', 'delegated', 'finalizing')
          AND candidate.claim_expires_at <= requested_now
          AND candidate.attempt < candidate.max_attempts
        )
        OR (
          candidate.status = 'cancelling'
          AND (candidate.claim_expires_at IS NULL
            OR candidate.claim_expires_at <= requested_now)
        )
      )
    ORDER BY CASE WHEN candidate.priority = 'permission' THEN 0 ELSE 1 END,
      candidate.available_at, candidate.created_at, candidate.work_id
    FOR UPDATE SKIP LOCKED
    LIMIT available_slots
  ), candidates AS (
    SELECT locked.work_id,
      row_number() OVER (
        ORDER BY CASE WHEN locked.priority = 'permission' THEN 0 ELSE 1 END,
          locked.available_at, locked.created_at, locked.work_id
      ) AS ordinal
    FROM locked
  )
  UPDATE ai_phone.agent_works AS work
  SET status = CASE WHEN work.status = 'queued' THEN 'running' ELSE work.status END,
      attempt = CASE WHEN work.status = 'cancelling'
        THEN work.attempt ELSE work.attempt + 1 END,
      claim_id = requested_batch_id || ':' || candidates.ordinal::text,
      claim_owner = requested_owner,
      claim_expires_at = LEAST(
        work.expires_at,
        COALESCE(work.cancel_deadline_at, work.expires_at),
        requested_now + make_interval(secs => requested_lease_seconds)
      ),
      started_at = CASE WHEN work.status = 'queued'
        THEN COALESCE(work.started_at, requested_now) ELSE work.started_at END,
      version = work.version + 1,
      updated_at = requested_now
  FROM candidates
  WHERE work.work_id = candidates.work_id
  RETURNING work.*;
END;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('037_agent_voice_work')
ON CONFLICT (version) DO NOTHING;

COMMIT;
