BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.worker_dispatches (
  id text PRIMARY KEY,
  call_id text NOT NULL,
  session_id text NOT NULL,
  room_name text NOT NULL,
  provider text NOT NULL,
  agent_name text NOT NULL,
  status text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  version bigint NOT NULL CHECK (version > 0),
  operation_id text,
  external_dispatch_id text,
  job_id text,
  worker_id text,
  metadata_hash text,
  lease_expires_at timestamptz NOT NULL,
  ready_at timestamptz,
  last_heartbeat_at timestamptz,
  ended_at timestamptz,
  last_error_class text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(session_id, generation)
);

CREATE INDEX IF NOT EXISTS worker_dispatches_lease_idx
  ON ai_phone.worker_dispatches(lease_expires_at)
  WHERE status IN ('reserved', 'dispatching', 'dispatched', 'ready', 'draining');

CREATE TABLE IF NOT EXISTS ai_phone.worker_capacity_reservations (
  id text PRIMARY KEY,
  session_id text NOT NULL UNIQUE,
  resource text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  status text NOT NULL,
  owner text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS worker_capacity_held_idx
  ON ai_phone.worker_capacity_reservations(resource, lease_expires_at)
  WHERE status = 'held';

CREATE TABLE IF NOT EXISTS ai_phone.participant_recording_consents (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  participant_identity text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted', 'revoked')),
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS recording_consents_latest_idx
  ON ai_phone.participant_recording_consents(
    session_id, participant_identity, created_at DESC
  );

CREATE TABLE IF NOT EXISTS ai_phone.recording_consent_snapshots (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  policy_version text NOT NULL,
  purpose text NOT NULL,
  participant_consent_ids text[] NOT NULL,
  participant_identities text[] NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(session_id, payload_hash)
);

CREATE TABLE IF NOT EXISTS ai_phone.recording_jobs (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  room_name text NOT NULL,
  recording_type text NOT NULL,
  participant_identity text,
  track_id text,
  provider text NOT NULL,
  consent_snapshot_id text NOT NULL
    REFERENCES ai_phone.recording_consent_snapshots(id),
  retention_until timestamptz NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  provider_operation_id text,
  external_recording_id text UNIQUE,
  last_error_class text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS recording_jobs_one_active_session_idx
  ON ai_phone.recording_jobs(session_id)
  WHERE status IN ('requested', 'starting', 'active', 'stopping');

CREATE TABLE IF NOT EXISTS ai_phone.recording_artifacts (
  id text PRIMARY KEY,
  recording_job_id text NOT NULL REFERENCES ai_phone.recording_jobs(id)
    ON DELETE CASCADE,
  session_id text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  status text NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  sha256 text,
  available_at timestamptz,
  verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(recording_job_id, object_key)
);

CREATE INDEX IF NOT EXISTS recording_artifacts_retention_idx
  ON ai_phone.recording_artifacts(status, updated_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_phone.agent_tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  session_id text,
  scenario text NOT NULL,
  objective text NOT NULL,
  suggested_script text,
  target_name text,
  target_phone_reference text,
  language text,
  risk_level text NOT NULL,
  status text NOT NULL,
  consent_prompt_version text,
  disclosure_prompt_version text,
  recipient_disclosure_confirmed boolean,
  authorization_at timestamptz,
  risk_reasons text[] NOT NULL DEFAULT '{}',
  call_id text,
  external_call_id text,
  execution_provider text,
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  consumed_seconds integer CHECK (consumed_seconds IS NULL OR consumed_seconds >= 0),
  result_summary text,
  failure_reason text,
  next_step text,
  worker_lease_owner text,
  worker_lease_token_hash text,
  worker_lease_expires_at timestamptz,
  worker_lease_attempt integer NOT NULL DEFAULT 0,
  provider_operation_id text REFERENCES ai_phone.provider_operations(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_phone.agent_runs (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES ai_phone.agent_tasks(id) ON DELETE CASCADE,
  session_id text,
  attempt integer NOT NULL CHECK (attempt > 0),
  mode text NOT NULL CHECK (mode IN ('assist', 'autonomous')),
  status text NOT NULL,
  policy_version text NOT NULL,
  model_profile_id text,
  started_at timestamptz,
  ended_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, attempt)
);

CREATE TABLE IF NOT EXISTS ai_phone.agent_steps (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ai_phone.agent_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  decision_type text NOT NULL,
  input_turn_id text,
  output_summary text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, sequence)
);

CREATE TABLE IF NOT EXISTS ai_phone.tool_executions (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ai_phone.agent_runs(id) ON DELETE CASCADE,
  step_id text REFERENCES ai_phone.agent_steps(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  arguments_hash text NOT NULL,
  risk_level text NOT NULL,
  approval_status text NOT NULL,
  provider_operation_id text,
  status text NOT NULL,
  result_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_executions_one_sensitive_active_idx
  ON ai_phone.tool_executions(run_id)
  WHERE risk_level = 'sensitive' AND status IN ('requested', 'approved', 'running');

CREATE TABLE IF NOT EXISTS ai_phone.external_media_sources (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  room_name text NOT NULL,
  provider text NOT NULL,
  input_type text NOT NULL,
  participant_identity text NOT NULL,
  status text NOT NULL,
  external_ingress_id text UNIQUE,
  source_policy_version text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  source_url_hash text,
  source_final_url_hash text,
  source_resolution_hash text,
  source_validated_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  provider_operation_id text,
  last_error_class text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_phone.postgres_projection_inbox (
  event_id text PRIMARY KEY,
  namespace text NOT NULL,
  record_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_hash text,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('002_orchestration_recording_agent')
ON CONFLICT (version) DO NOTHING;

COMMIT;
