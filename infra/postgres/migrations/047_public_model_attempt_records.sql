BEGIN;

-- Each supplier attempt is its own indexed primary projection.  The session
-- aggregate retains only unresolved attempts and bounded summary counters.
CREATE TABLE IF NOT EXISTS ai_phone.public_model_attempts (
  record_key text PRIMARY KEY,
  session_id text NOT NULL REFERENCES ai_phone.communication_sessions(id),
  attempt_id text NOT NULL,
  user_id text NOT NULL,
  deployment_id text NOT NULL,
  component text NOT NULL CHECK (component IN ('asr','translation','tts')),
  provider_id text NOT NULL,
  model_id text NOT NULL,
  segment_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  state text NOT NULL CHECK (state IN ('dispatching','confirmed','rejected','not_sent','uncertain')),
  audio_start_sample bigint,
  audio_end_sample bigint,
  audio_sample_rate integer,
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE(session_id,attempt_id)
);
-- Keyset pagination orders by creation time and key. A session/key-only index
-- would sort all historical attempts on every page of a long session.
CREATE INDEX IF NOT EXISTS public_model_attempts_session_idx
  ON ai_phone.public_model_attempts(session_id,created_at,record_key);
CREATE INDEX IF NOT EXISTS public_model_attempts_asr_end_idx
  ON ai_phone.public_model_attempts(session_id,audio_end_sample)
  WHERE component='asr' AND state<>'not_sent';
CREATE INDEX IF NOT EXISTS public_model_attempts_component_state_idx
  ON ai_phone.public_model_attempts(session_id,component,state);
CREATE UNIQUE INDEX IF NOT EXISTS public_model_attempts_tts_generation_idx
  ON ai_phone.public_model_attempts(session_id,segment_id,revision)
  WHERE component='tts' AND state<>'not_sent';

-- The original account-deletion/session-delete route must remove the external
-- primary attempt records as well as the normalized rows.
CREATE OR REPLACE FUNCTION ai_phone.delete_public_attempts_with_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM ai_phone.projection_records AS primary_record
  USING ai_phone.public_model_attempts AS attempt
  WHERE primary_record.namespace='publicModelAttempts'
    AND primary_record.record_key=attempt.record_key
    AND attempt.session_id=OLD.id;
  DELETE FROM ai_phone.public_model_attempts WHERE session_id=OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS delete_public_attempts_with_session
  ON ai_phone.communication_sessions;
CREATE TRIGGER delete_public_attempts_with_session
  BEFORE DELETE ON ai_phone.communication_sessions
  FOR EACH ROW EXECUTE FUNCTION ai_phone.delete_public_attempts_with_session();

DO $repair$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'ai_phone.apply_projection_event(text,text,text,text,jsonb)'::regprocedure
  ) INTO definition;
  IF position('''publicModelAttempts''' IN definition)>0 THEN
    RAISE EXCEPTION 'Public model attempt projection already installed without migration marker';
  END IF;
  IF position(E'    ''agentCallDrafts'', ''publicCreationBindings''\n  ) THEN' IN definition)=0 OR
     position(E'      WHEN ''publicCreationBindings'' THEN NULL;\n    END CASE;' IN definition)=0 OR
     position(E'    WHEN ''publicCreationBindings'' THEN NULL;\n    WHEN ''sessions'' THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'Public model attempt projection function shape is unavailable';
  END IF;
  definition := replace(definition,
    E'    ''agentCallDrafts'', ''publicCreationBindings''\n  ) THEN',
    E'    ''agentCallDrafts'', ''publicCreationBindings'', ''publicModelAttempts''\n  ) THEN');
  definition := replace(definition,
    E'      WHEN ''publicCreationBindings'' THEN NULL;\n    END CASE;',
    E'      WHEN ''publicCreationBindings'' THEN NULL;\n      WHEN ''publicModelAttempts'' THEN\n        DELETE FROM ai_phone.public_model_attempts AS attempt\n        WHERE attempt.record_key=apply_projection_event.record_key;\n    END CASE;');
  definition := replace(definition,
    E'    WHEN ''publicCreationBindings'' THEN NULL;\n    WHEN ''sessions'' THEN',
    E'    WHEN ''publicCreationBindings'' THEN NULL;\n    WHEN ''publicModelAttempts'' THEN\n      INSERT INTO ai_phone.public_model_attempts(\n        record_key,session_id,attempt_id,user_id,deployment_id,component,\n        provider_id,model_id,segment_id,revision,state,audio_start_sample,\n        audio_end_sample,audio_sample_rate,version,created_at,updated_at,payload\n      ) VALUES (\n        apply_projection_event.record_key,event_payload#>>''{event,sessionId}'',\n        event_payload#>>''{event,attemptId}'',event_payload->>''ownerId'',\n        event_payload->>''deploymentId'',event_payload#>>''{event,component}'',\n        event_payload#>>''{event,providerId}'',event_payload#>>''{event,modelId}'',\n        event_payload#>>''{event,segmentId}'',(event_payload#>>''{event,revision}'')::integer,\n        event_payload#>>''{event,state}'',\n        (event_payload#>>''{event,audioStartSample}'')::bigint,\n        (event_payload#>>''{event,audioEndSample}'')::bigint,\n        (event_payload#>>''{event,audioSampleRate}'')::integer,\n        (event_payload->>''version'')::bigint,\n        (event_payload->>''createdAt'')::timestamptz,\n        (event_payload->>''updatedAt'')::timestamptz,event_payload\n      ) ON CONFLICT (record_key) DO UPDATE SET\n        state=EXCLUDED.state,audio_end_sample=EXCLUDED.audio_end_sample,\n        version=EXCLUDED.version,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload\n      WHERE ai_phone.public_model_attempts.session_id=EXCLUDED.session_id\n        AND ai_phone.public_model_attempts.attempt_id=EXCLUDED.attempt_id\n        AND ai_phone.public_model_attempts.user_id=EXCLUDED.user_id\n        AND ai_phone.public_model_attempts.deployment_id=EXCLUDED.deployment_id\n        AND ai_phone.public_model_attempts.component=EXCLUDED.component\n        AND ai_phone.public_model_attempts.provider_id=EXCLUDED.provider_id\n        AND ai_phone.public_model_attempts.model_id=EXCLUDED.model_id\n        AND ai_phone.public_model_attempts.segment_id=EXCLUDED.segment_id\n        AND ai_phone.public_model_attempts.revision=EXCLUDED.revision\n        AND ai_phone.public_model_attempts.audio_start_sample IS NOT DISTINCT FROM EXCLUDED.audio_start_sample\n        AND ai_phone.public_model_attempts.audio_sample_rate IS NOT DISTINCT FROM EXCLUDED.audio_sample_rate\n        AND ai_phone.public_model_attempts.state=''dispatching''\n        AND EXCLUDED.version=ai_phone.public_model_attempts.version+1\n        AND EXCLUDED.updated_at>=ai_phone.public_model_attempts.updated_at\n        AND (EXCLUDED.state<>''dispatching'' AND\n          EXCLUDED.audio_end_sample IS NOT DISTINCT FROM ai_phone.public_model_attempts.audio_end_sample\n          OR EXCLUDED.state=''dispatching'' AND\n          EXCLUDED.audio_end_sample>ai_phone.public_model_attempts.audio_end_sample);\n      IF NOT FOUND THEN RAISE EXCEPTION ''Public model attempt version or state conflict''; END IF;\n    WHEN ''sessions'' THEN');
  EXECUTE definition;
END;
$repair$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('047_public_model_attempt_records')
ON CONFLICT (version) DO NOTHING;

COMMIT;
