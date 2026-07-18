BEGIN;

ALTER TABLE ai_phone.tts_playbacks
  DROP CONSTRAINT tts_playbacks_pkey;
ALTER TABLE ai_phone.tts_playbacks
  ADD CONSTRAINT tts_playbacks_pkey PRIMARY KEY (session_id, id);

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('030_tts_playback_session_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
