BEGIN;

ALTER TABLE ai_phone.participant_recording_consents
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'participant_token',
  ADD COLUMN IF NOT EXISTS participant_role text,
  ADD COLUMN IF NOT EXISTS join_type text,
  ADD COLUMN IF NOT EXISTS generation integer,
  ADD COLUMN IF NOT EXISTS runtime_event_id text,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE ai_phone.participant_recording_consents
  DROP CONSTRAINT IF EXISTS participant_recording_consents_trust_check;
ALTER TABLE ai_phone.participant_recording_consents
  ADD CONSTRAINT participant_recording_consents_trust_check CHECK (
    source IN ('participant_token', 'voice_agent_runtime') AND
    (source <> 'voice_agent_runtime' OR (
      participant_role = 'guest' AND join_type = 'sip' AND generation > 0 AND
      runtime_event_id IS NOT NULL AND evidence_hash ~ '^[a-f0-9]{64}$' AND
      observed_at IS NOT NULL AND expires_at IS NOT NULL
    ))
  );

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_runtime_event_idx
  ON ai_phone.participant_recording_consents(session_id, runtime_event_id)
  WHERE runtime_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recording_consents_observed_latest_idx
  ON ai_phone.participant_recording_consents(
    session_id, participant_identity, observed_at DESC, created_at DESC
  );

ALTER TABLE ai_phone.agent_tasks
  ADD COLUMN IF NOT EXISTS recording_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recording_policy_version text;

ALTER TABLE ai_phone.agent_tasks
  DROP CONSTRAINT IF EXISTS agent_tasks_recording_policy_check;
ALTER TABLE ai_phone.agent_tasks
  ADD CONSTRAINT agent_tasks_recording_policy_check CHECK (
    (recording_requested AND recording_policy_version IS NOT NULL) OR
    (NOT recording_requested AND recording_policy_version IS NULL)
  );

CREATE OR REPLACE FUNCTION ai_phone.recording_consent_trust_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  primary_payload jsonb;
BEGIN
  SELECT payload INTO primary_payload
  FROM ai_phone.projection_records
  WHERE namespace = 'participantRecordingConsents' AND record_key = NEW.id;
  IF primary_payload IS NULL THEN RETURN NEW; END IF;
  NEW.source := COALESCE(primary_payload->>'source', 'participant_token');
  NEW.participant_role := primary_payload->>'participantRole';
  NEW.join_type := primary_payload->>'joinType';
  NEW.generation := NULLIF(primary_payload->>'generation', '')::integer;
  NEW.runtime_event_id := primary_payload->>'runtimeEventId';
  NEW.evidence_hash := primary_payload->>'evidenceHash';
  NEW.observed_at := NULLIF(primary_payload->>'observedAt', '')::timestamptz;
  NEW.expires_at := NULLIF(primary_payload->>'expiresAt', '')::timestamptz;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recording_consent_trust_projection
  ON ai_phone.participant_recording_consents;
CREATE TRIGGER recording_consent_trust_projection
BEFORE INSERT OR UPDATE ON ai_phone.participant_recording_consents
FOR EACH ROW EXECUTE FUNCTION ai_phone.recording_consent_trust_projection();

CREATE OR REPLACE FUNCTION ai_phone.agent_recording_policy_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  primary_payload jsonb;
BEGIN
  SELECT payload INTO primary_payload
  FROM ai_phone.projection_records
  WHERE namespace = 'agentCallDrafts' AND record_key = NEW.id;
  IF primary_payload IS NULL THEN RETURN NEW; END IF;
  NEW.recording_requested := COALESCE(
    NULLIF(primary_payload->>'recordingRequested', '')::boolean,
    false
  );
  NEW.recording_policy_version := primary_payload->>'recordingPolicyVersion';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_recording_policy_projection ON ai_phone.agent_tasks;
CREATE TRIGGER agent_recording_policy_projection
BEFORE INSERT OR UPDATE ON ai_phone.agent_tasks
FOR EACH ROW EXECUTE FUNCTION ai_phone.agent_recording_policy_projection();

UPDATE ai_phone.participant_recording_consents AS consent
SET source = COALESCE(primary_record.payload->>'source', 'participant_token'),
    participant_role = primary_record.payload->>'participantRole',
    join_type = primary_record.payload->>'joinType',
    generation = NULLIF(primary_record.payload->>'generation', '')::integer,
    runtime_event_id = primary_record.payload->>'runtimeEventId',
    evidence_hash = primary_record.payload->>'evidenceHash',
    observed_at = NULLIF(primary_record.payload->>'observedAt', '')::timestamptz,
    expires_at = NULLIF(primary_record.payload->>'expiresAt', '')::timestamptz
FROM ai_phone.projection_records AS primary_record
WHERE primary_record.namespace = 'participantRecordingConsents'
  AND primary_record.record_key = consent.id;

UPDATE ai_phone.agent_tasks AS task
SET recording_requested = COALESCE(
      NULLIF(primary_record.payload->>'recordingRequested', '')::boolean,
      false
    ),
    recording_policy_version = primary_record.payload->>'recordingPolicyVersion'
FROM ai_phone.projection_records AS primary_record
WHERE primary_record.namespace = 'agentCallDrafts'
  AND primary_record.record_key = task.id;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('031_voice_agent_recording_consent')
ON CONFLICT (version) DO NOTHING;

COMMIT;
