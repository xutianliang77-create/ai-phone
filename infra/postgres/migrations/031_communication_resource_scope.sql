BEGIN;

CREATE OR REPLACE FUNCTION ai_phone.current_scope_type()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.scope_type', true), '')
$$;

CREATE OR REPLACE FUNCTION ai_phone.current_scope_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.scope_id', true), '')
$$;

CREATE OR REPLACE FUNCTION ai_phone.communication_scope_matches(
  row_scope_type text,
  row_scope_id text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT row_scope_type = ai_phone.current_scope_type()
    AND row_scope_id = ai_phone.current_scope_id()
$$;

ALTER TABLE ai_phone.communication_sessions
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.session_media_legs
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.transcript_segments
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.tts_playbacks
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.provider_operations
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.worker_dispatches
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.worker_capacity_reservations
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.participant_recording_consents
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.recording_consent_snapshots
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.recording_jobs
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.recording_artifacts
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;
ALTER TABLE ai_phone.external_media_sources
  ADD COLUMN scope_type text,
  ADD COLUMN scope_id text;

UPDATE ai_phone.communication_sessions
SET scope_type = 'user', scope_id = user_id;

UPDATE ai_phone.session_media_legs child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.transcript_segments child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.tts_playbacks child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.provider_operations child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.worker_dispatches child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.worker_capacity_reservations child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.participant_recording_consents child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.recording_consent_snapshots child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.recording_jobs child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;
UPDATE ai_phone.recording_artifacts child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.recording_jobs parent
WHERE parent.id = child.recording_job_id;
UPDATE ai_phone.external_media_sources child
SET scope_type = parent.scope_type, scope_id = parent.scope_id
FROM ai_phone.communication_sessions parent
WHERE parent.id = child.session_id;

DO $constraints$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communication_sessions', 'session_media_legs', 'transcript_segments',
    'tts_playbacks', 'provider_operations', 'worker_dispatches',
    'worker_capacity_reservations', 'participant_recording_consents',
    'recording_consent_snapshots', 'recording_jobs', 'recording_artifacts',
    'external_media_sources'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE ai_phone.%I ALTER COLUMN scope_type SET NOT NULL, '
      'ALTER COLUMN scope_id SET NOT NULL', table_name
    );
    EXECUTE format(
      'ALTER TABLE ai_phone.%I ADD CONSTRAINT %I '
      'CHECK (scope_type IN (''user'', ''tenant'') AND btrim(scope_id) <> '''')',
      table_name, table_name || '_scope_valid'
    );
  END LOOP;
END;
$constraints$;

ALTER TABLE ai_phone.communication_sessions
  ADD CONSTRAINT communication_sessions_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.session_media_legs
  ADD CONSTRAINT session_media_legs_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT session_media_legs_scope_key
  UNIQUE (scope_type, scope_id, session_id, id);
ALTER TABLE ai_phone.transcript_segments
  ADD CONSTRAINT transcript_segments_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE;

CREATE INDEX transcript_segments_scope_session_idx
  ON ai_phone.transcript_segments(scope_type, scope_id, session_id);
CREATE INDEX provider_operations_scope_session_idx
  ON ai_phone.provider_operations(
    scope_type, scope_id, session_id, operation_type, updated_at
  );
CREATE INDEX worker_dispatches_scope_recovery_idx
  ON ai_phone.worker_dispatches(
    scope_type, scope_id, status, lease_expires_at, id
  );
CREATE INDEX worker_capacity_scope_session_idx
  ON ai_phone.worker_capacity_reservations(scope_type, scope_id, session_id);
CREATE INDEX participant_consents_scope_session_idx
  ON ai_phone.participant_recording_consents(
    scope_type, scope_id, session_id, participant_identity, created_at DESC
  );
CREATE INDEX recording_snapshots_scope_session_idx
  ON ai_phone.recording_consent_snapshots(scope_type, scope_id, session_id);
CREATE INDEX recording_jobs_scope_session_idx
  ON ai_phone.recording_jobs(scope_type, scope_id, session_id, created_at, id);
CREATE INDEX recording_artifacts_scope_job_idx
  ON ai_phone.recording_artifacts(
    scope_type, scope_id, recording_job_id, created_at, id
  );
CREATE INDEX external_media_scope_session_idx
  ON ai_phone.external_media_sources(scope_type, scope_id, session_id);
ALTER TABLE ai_phone.tts_playbacks
  ADD CONSTRAINT tts_playbacks_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT tts_playbacks_scope_key
  UNIQUE (scope_type, scope_id, session_id, id);
ALTER TABLE ai_phone.provider_operations
  ADD CONSTRAINT provider_operations_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT provider_operations_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.worker_dispatches
  ADD CONSTRAINT worker_dispatches_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT worker_dispatches_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.worker_capacity_reservations
  ADD CONSTRAINT worker_capacity_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE;
ALTER TABLE ai_phone.participant_recording_consents
  ADD CONSTRAINT participant_consents_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT participant_consents_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.recording_consent_snapshots
  ADD CONSTRAINT recording_snapshots_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT recording_snapshots_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.recording_jobs
  ADD CONSTRAINT recording_jobs_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE,
  ADD CONSTRAINT recording_jobs_scope_snapshot_fk
  FOREIGN KEY (scope_type, scope_id, consent_snapshot_id)
  REFERENCES ai_phone.recording_consent_snapshots(scope_type, scope_id, id),
  ADD CONSTRAINT recording_jobs_scope_key
  UNIQUE (scope_type, scope_id, id);
ALTER TABLE ai_phone.recording_artifacts
  ADD CONSTRAINT recording_artifacts_scope_job_fk
  FOREIGN KEY (scope_type, scope_id, recording_job_id)
  REFERENCES ai_phone.recording_jobs(scope_type, scope_id, id)
  ON DELETE CASCADE;
ALTER TABLE ai_phone.external_media_sources
  ADD CONSTRAINT external_media_scope_session_fk
  FOREIGN KEY (scope_type, scope_id, session_id)
  REFERENCES ai_phone.communication_sessions(scope_type, scope_id, id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION ai_phone.assign_communication_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requested_type text := ai_phone.current_scope_type();
  requested_id text := ai_phone.current_scope_id();
BEGIN
  IF requested_type NOT IN ('user', 'tenant') OR requested_id IS NULL THEN
    RAISE EXCEPTION 'communication scope context is required';
  END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.scope_type, NEW.scope_id) IS DISTINCT FROM
    (OLD.scope_type, OLD.scope_id) THEN
    RAISE EXCEPTION 'communication resource scope is immutable';
  END IF;
  NEW.scope_type := COALESCE(NEW.scope_type, requested_type);
  NEW.scope_id := COALESCE(NEW.scope_id, requested_id);
  IF NOT ai_phone.communication_scope_matches(NEW.scope_type, NEW.scope_id) THEN
    RAISE EXCEPTION 'communication resource scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DO $security$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communication_sessions', 'session_media_legs', 'transcript_segments',
    'tts_playbacks', 'provider_operations', 'worker_dispatches',
    'worker_capacity_reservations', 'participant_recording_consents',
    'recording_consent_snapshots', 'recording_jobs', 'recording_artifacts',
    'external_media_sources'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON ai_phone.%I '
      'FOR EACH ROW EXECUTE FUNCTION ai_phone.assign_communication_scope()',
      table_name || '_assign_scope', table_name
    );
    EXECUTE format('ALTER TABLE ai_phone.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE ai_phone.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON ai_phone.%I USING '
      '(ai_phone.communication_scope_matches(scope_type, scope_id)) '
      'WITH CHECK (ai_phone.communication_scope_matches(scope_type, scope_id))',
      table_name || '_scope_isolation', table_name
    );
  END LOOP;
END;
$security$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('031_communication_resource_scope')
ON CONFLICT (version) DO NOTHING;

COMMIT;
