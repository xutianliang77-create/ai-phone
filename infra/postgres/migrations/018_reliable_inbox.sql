BEGIN;

CREATE TABLE IF NOT EXISTS ai_phone.reliable_inbox_events (
  event_id text PRIMARY KEY,
  session_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  result_payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  retain_until timestamptz NOT NULL,
  CHECK (length(event_id) BETWEEN 1 AND 200),
  CHECK (length(session_id) BETWEEN 1 AND 160),
  CHECK (length(event_type) BETWEEN 2 AND 120),
  CHECK (length(payload_hash) = 64),
  CHECK ((processed_at IS NULL) = (result_payload IS NULL)),
  CHECK (retain_until > received_at)
);

CREATE INDEX IF NOT EXISTS reliable_inbox_retention_idx
  ON ai_phone.reliable_inbox_events(retain_until, event_id);
CREATE INDEX IF NOT EXISTS reliable_inbox_session_idx
  ON ai_phone.reliable_inbox_events(session_id, received_at DESC);

CREATE OR REPLACE FUNCTION ai_phone.reserve_reliable_inbox_event(
  target_event_id text,
  target_session_id text,
  target_event_type text,
  target_payload_hash text,
  target_retain_until timestamptz
) RETURNS TABLE(event_id text, inserted boolean)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO ai_phone.reliable_inbox_events(
    event_id, session_id, event_type, payload_hash, retain_until
  ) VALUES (
    target_event_id, target_session_id, target_event_type,
    target_payload_hash, target_retain_until
  )
  ON CONFLICT ON CONSTRAINT reliable_inbox_events_pkey DO NOTHING
  RETURNING reliable_inbox_events.event_id, true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT target_event_id, false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ai_phone.complete_reliable_inbox_event(
  target_event_id text,
  target_result jsonb
) RETURNS TABLE(event_id text)
LANGUAGE sql
AS $$
  UPDATE ai_phone.reliable_inbox_events
  SET result_payload = target_result,
      processed_at = now()
  WHERE reliable_inbox_events.event_id = target_event_id
    AND processed_at IS NULL
  RETURNING reliable_inbox_events.event_id;
$$;

INSERT INTO ai_phone.schema_migrations(version)
VALUES ('018_reliable_inbox')
ON CONFLICT (version) DO NOTHING;

COMMIT;
