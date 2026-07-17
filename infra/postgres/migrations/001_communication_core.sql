BEGIN;

CREATE SCHEMA IF NOT EXISTS ai_phone;

CREATE TABLE IF NOT EXISTS ai_phone.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_phone.communication_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN (
    'conversation', 'meeting', 'classroom', 'business', 'call_link'
  )),
  status text NOT NULL,
  consumed_seconds integer NOT NULL DEFAULT 0 CHECK (consumed_seconds >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  room_name text,
  room_provider text,
  created_at timestamptz NOT NULL,
  last_activity_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communication_sessions_user_created_idx
  ON ai_phone.communication_sessions(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS communication_sessions_recovery_idx
  ON ai_phone.communication_sessions(status, updated_at)
  WHERE status NOT IN ('ended', 'failed');

CREATE TABLE IF NOT EXISTS ai_phone.session_media_legs (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES ai_phone.communication_sessions(id)
    ON DELETE CASCADE,
  participant_identity text NOT NULL,
  participant_role text NOT NULL,
  join_type text NOT NULL,
  status text NOT NULL,
  joined_at timestamptz NOT NULL,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, participant_identity)
);

CREATE INDEX IF NOT EXISTS session_media_legs_active_idx
  ON ai_phone.session_media_legs(session_id, participant_role)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ai_phone.transcript_segments (
  session_id text NOT NULL REFERENCES ai_phone.communication_sessions(id)
    ON DELETE CASCADE,
  segment_id text NOT NULL,
  turn_id text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_text text NOT NULL,
  raw_text text,
  optimized_text text,
  translated_text text,
  source_language text,
  target_language text,
  dominant_language text,
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  stage text,
  provider text,
  model text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  speaker_id text,
  speaker_role text,
  start_ms bigint,
  end_ms bigint,
  overlap boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id, segment_id, revision),
  CHECK (end_ms IS NULL OR start_ms IS NULL OR end_ms >= start_ms)
);

CREATE INDEX IF NOT EXISTS transcript_segments_timeline_idx
  ON ai_phone.transcript_segments(session_id, start_ms, segment_id);
CREATE INDEX IF NOT EXISTS transcript_segments_turn_revision_idx
  ON ai_phone.transcript_segments(session_id, turn_id, revision DESC);

CREATE TABLE IF NOT EXISTS ai_phone.tts_playbacks (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES ai_phone.communication_sessions(id)
    ON DELETE CASCADE,
  segment_id text NOT NULL,
  source_leg_id text NOT NULL,
  target_leg_id text NOT NULL,
  generation integer NOT NULL CHECK (generation >= 0),
  status text NOT NULL,
  provider text,
  model text,
  audio_duration_ms integer CHECK (audio_duration_ms IS NULL OR audio_duration_ms >= 0),
  interrupt_reason text,
  queued_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, target_leg_id, generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS tts_playbacks_one_active_target_idx
  ON ai_phone.tts_playbacks(session_id, target_leg_id)
  WHERE status IN ('queued', 'streaming', 'interrupting');

CREATE TABLE IF NOT EXISTS ai_phone.provider_operations (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  provider text NOT NULL,
  operation_type text NOT NULL,
  operation_key text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  version bigint NOT NULL CHECK (version > 0),
  external_operation_id text,
  external_resource_id text,
  last_error_class text,
  started_at timestamptz NOT NULL,
  accepted_at timestamptz,
  answered_at timestamptz,
  completion_observed_at timestamptz,
  completion_observed_event text,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  UNIQUE(provider, operation_type, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_operations_session_operation_idx
  ON ai_phone.provider_operations(
    session_id,
    operation_type,
    COALESCE(operation_key, '')
  );

CREATE INDEX IF NOT EXISTS provider_operations_reconciliation_idx
  ON ai_phone.provider_operations(status, updated_at)
  WHERE status IN ('in_flight', 'accepted', 'unknown', 'active');

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('001_communication_core')
ON CONFLICT (version) DO NOTHING;

COMMIT;
