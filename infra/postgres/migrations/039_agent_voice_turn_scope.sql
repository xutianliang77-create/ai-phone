BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.agent_voice_turn_scopes (
  session_id text NOT NULL,
  leg_id text NOT NULL,
  actor_id text NOT NULL,
  agent_run_id text NOT NULL REFERENCES ai_phone.agent_runs(id)
    ON DELETE CASCADE,
  current_turn_id text NOT NULL,
  turn_generation bigint NOT NULL CHECK (turn_generation > 0),
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  state text NOT NULL CHECK (state IN (
    'active', 'invalidated', 'session_ending'
  )),
  explicit_instruction_evidence_hash text,
  observed_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(session_id, leg_id),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(actor_id) BETWEEN 1 AND 160),
  CHECK (length(agent_run_id) BETWEEN 1 AND 160),
  CHECK (length(current_turn_id) BETWEEN 1 AND 160),
  CHECK (explicit_instruction_evidence_hash IS NULL
    OR explicit_instruction_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (
    (state = 'active' AND explicit_instruction_evidence_hash IS NOT NULL)
    OR state <> 'active'
  )
);

CREATE TABLE IF NOT EXISTS ai_phone.agent_voice_turn_events (
  event_id text PRIMARY KEY,
  event_hash text NOT NULL,
  session_id text NOT NULL,
  leg_id text NOT NULL,
  actor_id text NOT NULL,
  agent_run_id text NOT NULL REFERENCES ai_phone.agent_runs(id)
    ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'user_speaking', 'final_transcript', 'session_ending'
  )),
  result_turn_id text NOT NULL,
  result_turn_generation bigint NOT NULL CHECK (result_turn_generation > 0),
  result_state text NOT NULL CHECK (result_state IN (
    'active', 'invalidated', 'session_ending'
  )),
  result_explicit_instruction_evidence_hash text,
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(event_id) BETWEEN 1 AND 160),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(actor_id) BETWEEN 1 AND 160),
  CHECK (length(agent_run_id) BETWEEN 1 AND 160),
  CHECK (length(result_turn_id) BETWEEN 1 AND 160),
  CHECK (result_explicit_instruction_evidence_hash IS NULL
    OR result_explicit_instruction_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (
    (result_state = 'active'
      AND result_explicit_instruction_evidence_hash IS NOT NULL)
    OR result_state <> 'active'
  ),
  FOREIGN KEY(session_id, leg_id)
    REFERENCES ai_phone.agent_voice_turn_scopes(session_id, leg_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_voice_turn_scopes_run_idx
  ON ai_phone.agent_voice_turn_scopes(agent_run_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_voice_turn_events_scope_idx
  ON ai_phone.agent_voice_turn_events(
    session_id, leg_id, result_turn_generation DESC
  );

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('039_agent_voice_turn_scope')
ON CONFLICT (version) DO NOTHING;

COMMIT;
