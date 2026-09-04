BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.agent_permission_requests (
  permission_request_id text PRIMARY KEY,
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
  explicit_instruction_evidence_hash text NOT NULL,
  authorizer_evidence_hash text,
  policy_version text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'sensitive')),
  side_effect_scopes jsonb NOT NULL,
  reason_code text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 'granted', 'denied', 'expired', 'cancelled'
  )),
  turn_generation bigint NOT NULL CHECK (turn_generation > 0),
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  authorization_snapshot_id text,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  UNIQUE(session_id, actor_id, tool_name, submission_key),
  CHECK (expires_at > created_at),
  CHECK (jsonb_typeof(side_effect_scopes) = 'array'),
  CHECK (jsonb_array_length(side_effect_scopes) BETWEEN 1 AND 8),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(sealed_arguments) BETWEEN 32 AND 65536),
  CHECK (explicit_instruction_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (authorizer_evidence_hash IS NULL
    OR authorizer_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (length(permission_request_id) BETWEEN 1 AND 160),
  CHECK (length(agent_run_id) BETWEEN 1 AND 160),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(turn_id) BETWEEN 1 AND 160),
  CHECK (length(actor_id) BETWEEN 1 AND 160),
  CHECK (length(tool_name) BETWEEN 1 AND 120),
  CHECK (length(tool_version) BETWEEN 1 AND 80),
  CHECK (length(submission_key) BETWEEN 1 AND 240),
  CHECK (length(policy_version) BETWEEN 1 AND 160),
  CHECK (length(reason_code) BETWEEN 1 AND 120),
  CHECK (
    (status = 'granted' AND authorization_snapshot_id IS NOT NULL
      AND authorizer_evidence_hash IS NOT NULL AND resolved_at IS NOT NULL)
    OR status <> 'granted'
  ),
  CHECK (
    (status IN ('denied', 'expired', 'cancelled') AND resolved_at IS NOT NULL)
    OR status NOT IN ('denied', 'expired', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS agent_permission_requests_pending_idx
  ON ai_phone.agent_permission_requests(expires_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS agent_permission_requests_session_idx
  ON ai_phone.agent_permission_requests(
    session_id, actor_id, updated_at DESC, permission_request_id
  );

CREATE TABLE IF NOT EXISTS ai_phone.agent_turn_authorizations (
  authorization_snapshot_id text PRIMARY KEY,
  permission_request_id text NOT NULL UNIQUE
    REFERENCES ai_phone.agent_permission_requests(permission_request_id)
    ON DELETE CASCADE,
  agent_run_id text NOT NULL REFERENCES ai_phone.agent_runs(id)
    ON DELETE CASCADE,
  session_id text NOT NULL,
  leg_id text NOT NULL,
  turn_id text NOT NULL,
  actor_id text NOT NULL,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  arguments_hash text NOT NULL,
  explicit_instruction_evidence_hash text NOT NULL,
  authorizer_evidence_hash text NOT NULL,
  policy_version text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'sensitive')),
  side_effect_scopes jsonb NOT NULL,
  turn_generation bigint NOT NULL CHECK (turn_generation > 0),
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  status text NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  request_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (jsonb_typeof(side_effect_scopes) = 'array'),
  CHECK (jsonb_array_length(side_effect_scopes) BETWEEN 1 AND 8),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  CHECK (explicit_instruction_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (authorizer_evidence_hash ~ '^[0-9a-f]{64}$'),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR status <> 'revoked'
  )
);

CREATE INDEX IF NOT EXISTS agent_turn_authorizations_active_idx
  ON ai_phone.agent_turn_authorizations(
    session_id, actor_id, tool_name, expires_at
  ) WHERE status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_works_authorization_snapshot_fk'
      AND conrelid = 'ai_phone.agent_works'::regclass
  ) THEN
    ALTER TABLE ai_phone.agent_works
      ADD CONSTRAINT agent_works_authorization_snapshot_fk
      FOREIGN KEY(consent_snapshot_id)
      REFERENCES ai_phone.agent_turn_authorizations(authorization_snapshot_id)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE ai_phone.agent_works
  VALIDATE CONSTRAINT agent_works_authorization_snapshot_fk;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('038_agent_work_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
