ALTER TABLE enterprise.meeting_participants
  ADD COLUMN caption_language text,
  ADD COLUMN translated_audio_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN playback_generation bigint NOT NULL DEFAULT 1;

UPDATE enterprise.meeting_participants participant
SET caption_language = CASE
  WHEN lower(COALESCE(
    NULLIF(participant.language, ''),
    NULLIF(meeting.policy ->> 'defaultLanguage', ''),
    'zh'
  )) LIKE 'en%' THEN 'en'
  ELSE 'zh'
END
FROM enterprise.meetings meeting
WHERE meeting.tenant_id = participant.tenant_id
  AND meeting.id = participant.meeting_id;

ALTER TABLE enterprise.meeting_participants
  ALTER COLUMN caption_language SET NOT NULL,
  ADD CONSTRAINT meeting_participants_caption_language_check
    CHECK (caption_language IN ('zh', 'en')),
  ADD CONSTRAINT meeting_participants_playback_generation_check
    CHECK (playback_generation > 0),
  ADD CONSTRAINT meeting_participants_translation_scope_key
    UNIQUE (tenant_id, meeting_id, id);

ALTER TABLE enterprise.worker_dispatch_grants
  ADD CONSTRAINT worker_dispatch_grants_session_id_key
    UNIQUE (tenant_id, communication_session_id, id);

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.policy_snapshot_id,
    NEW.policy_version, NEW.billing_account_id, NEW.entitlement_version,
    NEW.idempotency_key, NEW.request_hash
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.policy_snapshot_id,
    OLD.policy_version, OLD.billing_account_id, OLD.entitlement_version,
    OLD.idempotency_key, OLD.request_hash
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  IF (NEW.issued_at, NEW.expires_at) IS DISTINCT FROM
      (OLD.issued_at, OLD.expires_at) AND NOT (
    OLD.status = 'accepted' AND NEW.status = 'accepted' AND
    NEW.issued_at > OLD.issued_at AND NEW.expires_at > NEW.issued_at AND
    NEW.expires_at <= NEW.issued_at + interval '5 minutes'
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch credential rotation is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE enterprise.meeting_translation_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  communication_session_id text NOT NULL,
  dispatch_grant_id uuid NOT NULL,
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  generation bigint NOT NULL CHECK (generation > 0),
  event_key text NOT NULL CHECK (event_key ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (
    event_type IN ('transcript.final', 'translation.final')
  ),
  source_participant_id uuid NOT NULL,
  source_display_name text NOT NULL
    CHECK (length(btrim(source_display_name)) BETWEEN 1 AND 120),
  source_track_sid text NOT NULL
    CHECK (length(btrim(source_track_sid)) BETWEEN 1 AND 128),
  target_participant_id uuid NOT NULL,
  segment_id text NOT NULL
    CHECK (length(btrim(segment_id)) BETWEEN 1 AND 160),
  revision integer NOT NULL CHECK (revision >= 0),
  source_language text NOT NULL CHECK (source_language IN ('zh', 'en')),
  target_language text NOT NULL CHECK (target_language IN ('zh', 'en')),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 32768),
  caption_text text NOT NULL CHECK (length(caption_text) BETWEEN 1 AND 32768),
  translated_audio_enabled boolean NOT NULL,
  translated_audio_status text NOT NULL CHECK (
    translated_audio_status IN ('disabled', 'not_ready', 'queued')
  ),
  playback_generation bigint NOT NULL CHECK (playback_generation > 0),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (
    tenant_id, meeting_id, target_participant_id, dispatch_grant_id,
    source_participant_id, source_track_sid, event_type, segment_id, revision
  ),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, communication_session_id)
    REFERENCES enterprise.communication_session_bindings (
      tenant_id, communication_session_id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, communication_session_id, dispatch_grant_id)
    REFERENCES enterprise.worker_dispatch_grants (
      tenant_id, communication_session_id, id
    ),
  FOREIGN KEY (tenant_id, meeting_id, source_participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  FOREIGN KEY (tenant_id, meeting_id, target_participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  CHECK (
    (translated_audio_enabled AND translated_audio_status <> 'disabled') OR
    (NOT translated_audio_enabled AND translated_audio_status = 'disabled')
  )
);

CREATE INDEX meeting_translation_events_target_timeline_idx
  ON enterprise.meeting_translation_events (
    tenant_id, meeting_id, target_participant_id, occurred_at, id
  );
CREATE INDEX meeting_translation_events_source_track_idx
  ON enterprise.meeting_translation_events (
    tenant_id, communication_session_id, generation,
    source_participant_id, source_track_sid, occurred_at
  );
CREATE INDEX meeting_translation_events_hash_idx
  ON enterprise.meeting_translation_events (
    tenant_id, meeting_id, target_participant_id, event_key
  );

CREATE OR REPLACE FUNCTION enterprise.reject_meeting_translation_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise meeting translation events are append-only';
END;
$$;

CREATE TRIGGER meeting_translation_events_append_only
BEFORE UPDATE OR DELETE ON enterprise.meeting_translation_events
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_translation_event_mutation();

ALTER TABLE enterprise.meeting_translation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.meeting_translation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_translation_events_tenant_isolation
  ON enterprise.meeting_translation_events
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
