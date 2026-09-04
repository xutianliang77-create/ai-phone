BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.voice_client_ownerships (
  session_id text NOT NULL,
  leg_id text NOT NULL,
  account_id text NOT NULL,
  client_instance_id text NOT NULL,
  participant_identity text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  lease_id text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'released')),
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  PRIMARY KEY(session_id, leg_id),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(account_id) BETWEEN 1 AND 160),
  CHECK (length(client_instance_id) BETWEEN 1 AND 160),
  CHECK (length(participant_identity) BETWEEN 1 AND 320),
  CHECK (length(lease_id) BETWEEN 1 AND 160),
  CHECK (
    (state = 'released' AND released_at IS NOT NULL
      AND release_reason IS NOT NULL)
    OR state = 'active'
  )
);

CREATE INDEX IF NOT EXISTS voice_client_ownership_active_idx
  ON ai_phone.voice_client_ownerships(lease_expires_at, session_id, leg_id)
  WHERE state = 'active';

CREATE TABLE IF NOT EXISTS ai_phone.voice_client_takeovers (
  takeover_id text PRIMARY KEY,
  session_id text NOT NULL,
  leg_id text NOT NULL,
  account_id text NOT NULL,
  requested_client_instance_id text NOT NULL,
  requested_participant_identity text NOT NULL,
  expected_generation bigint NOT NULL CHECK (expected_generation > 0),
  status text NOT NULL CHECK (status IN (
    'pending', 'confirmed', 'cancelled', 'expired'
  )),
  request_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  CHECK (length(takeover_id) BETWEEN 1 AND 160),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(leg_id) BETWEEN 1 AND 160),
  CHECK (length(account_id) BETWEEN 1 AND 160),
  CHECK (length(requested_client_instance_id) BETWEEN 1 AND 160),
  CHECK (length(requested_participant_identity) BETWEEN 1 AND 320),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at),
  CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL)
    OR status <> 'confirmed'),
  FOREIGN KEY(session_id, leg_id)
    REFERENCES ai_phone.voice_client_ownerships(session_id, leg_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_client_takeover_pending_idx
  ON ai_phone.voice_client_takeovers(session_id, leg_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS voice_client_takeover_expiry_idx
  ON ai_phone.voice_client_takeovers(expires_at, takeover_id)
  WHERE status = 'pending';

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('040_voice_client_ownership')
ON CONFLICT (version) DO NOTHING;

COMMIT;
