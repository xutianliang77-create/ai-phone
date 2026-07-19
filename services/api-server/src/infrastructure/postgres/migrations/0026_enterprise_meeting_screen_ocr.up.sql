CREATE TABLE enterprise.meeting_screen_ocr_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  share_id uuid NOT NULL,
  share_generation bigint NOT NULL CHECK (share_generation > 0),
  target_language text NOT NULL CHECK (target_language IN ('zh', 'en')),
  status text NOT NULL CHECK (
    status IN ('pending', 'active', 'not_configured', 'failed', 'ended')
  ),
  reason_code text CHECK (
    reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9._:-]{0,159}$'
  ),
  provider_fingerprint text CHECK (
    provider_fingerprint IS NULL OR
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, share_id, id),
  UNIQUE (
    tenant_id, meeting_id, share_id, share_generation, target_language, id
  ),
  FOREIGN KEY (tenant_id, meeting_id, share_id)
    REFERENCES enterprise.meeting_screen_shares (tenant_id, meeting_id, id)
    ON DELETE CASCADE,
  CHECK (updated_at >= created_at),
  CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  CHECK (ended_at IS NULL OR ended_at >= created_at),
  CHECK (
    (status IN ('pending', 'active') AND reason_code IS NULL) OR
    (status IN ('not_configured', 'failed', 'ended') AND reason_code IS NOT NULL)
  ),
  CHECK (provider_fingerprint IS NULL OR status IN ('active', 'failed', 'ended'))
);

CREATE UNIQUE INDEX meeting_screen_ocr_runs_live_idx
  ON enterprise.meeting_screen_ocr_runs (
    tenant_id, meeting_id, share_id, share_generation, target_language
  ) WHERE status IN ('pending', 'active');

CREATE INDEX meeting_screen_ocr_runs_current_idx
  ON enterprise.meeting_screen_ocr_runs (
    tenant_id, meeting_id, share_id, share_generation, created_at DESC, id
  );

CREATE TABLE enterprise.meeting_screen_ocr_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  share_id uuid NOT NULL,
  share_generation bigint NOT NULL CHECK (share_generation > 0),
  run_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  target_language text NOT NULL CHECK (target_language IN ('zh', 'en')),
  display_mode text NOT NULL CHECK (
    display_mode IN ('original', 'translated', 'bilingual')
  ),
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, share_id, id),
  UNIQUE (tenant_id, meeting_id, share_id, run_id, id),
  FOREIGN KEY (
    tenant_id, meeting_id, share_id, share_generation, target_language, run_id
  )
    REFERENCES enterprise.meeting_screen_ocr_runs (
      tenant_id, meeting_id, share_id, share_generation, target_language, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id, participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX meeting_screen_ocr_subscriptions_enabled_idx
  ON enterprise.meeting_screen_ocr_subscriptions (
    tenant_id, meeting_id, share_id, share_generation, participant_id
  ) WHERE enabled;

CREATE INDEX meeting_screen_ocr_subscriptions_run_idx
  ON enterprise.meeting_screen_ocr_subscriptions (
    tenant_id, run_id, enabled, participant_id
  );

CREATE TABLE enterprise.meeting_screen_ocr_commands (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  share_id uuid NOT NULL,
  run_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN ('enable', 'disable')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_version bigint NOT NULL CHECK (result_version > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, idempotency_key),
  FOREIGN KEY (tenant_id, meeting_id, share_id, run_id)
    REFERENCES enterprise.meeting_screen_ocr_runs (
      tenant_id, meeting_id, share_id, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (
    tenant_id, meeting_id, share_id, run_id, subscription_id
  )
    REFERENCES enterprise.meeting_screen_ocr_subscriptions (
      tenant_id, meeting_id, share_id, run_id, id
    ) ON DELETE CASCADE
);

CREATE TABLE enterprise.meeting_screen_ocr_frames (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  share_id uuid NOT NULL,
  run_id uuid NOT NULL,
  frame_revision bigint NOT NULL CHECK (frame_revision > 0),
  perceptual_hash text NOT NULL CHECK (perceptual_hash ~ '^[a-f0-9]{16}$'),
  source_width integer NOT NULL CHECK (source_width BETWEEN 16 AND 7680),
  source_height integer NOT NULL CHECK (source_height BETWEEN 16 AND 4320),
  status text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  reason_code text CHECK (
    reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9._:-]{0,159}$'
  ),
  provider_fingerprint text CHECK (
    provider_fingerprint IS NULL OR
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, id),
  UNIQUE (tenant_id, run_id, frame_revision),
  UNIQUE (tenant_id, run_id, perceptual_hash),
  FOREIGN KEY (tenant_id, meeting_id, share_id, run_id)
    REFERENCES enterprise.meeting_screen_ocr_runs (
      tenant_id, meeting_id, share_id, id
    ) ON DELETE CASCADE,
  CHECK ((status = 'processing') = (completed_at IS NULL)),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (status = 'processing' AND reason_code IS NULL AND
      provider_fingerprint IS NULL) OR
    (status = 'ready' AND reason_code IS NULL AND
      provider_fingerprint IS NOT NULL) OR
    (status = 'failed' AND reason_code IS NOT NULL)
  )
);

CREATE INDEX meeting_screen_ocr_frames_latest_idx
  ON enterprise.meeting_screen_ocr_frames (
    tenant_id, run_id, frame_revision DESC, id
  ) WHERE status = 'ready';

CREATE TABLE enterprise.meeting_screen_ocr_blocks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  run_id uuid NOT NULL,
  frame_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  left_ratio double precision NOT NULL CHECK (left_ratio BETWEEN 0 AND 1),
  top_ratio double precision NOT NULL CHECK (top_ratio BETWEEN 0 AND 1),
  width_ratio double precision NOT NULL CHECK (width_ratio > 0 AND width_ratio <= 1),
  height_ratio double precision NOT NULL CHECK (height_ratio > 0 AND height_ratio <= 1),
  source_language text NOT NULL CHECK (source_language IN ('zh', 'en')),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 4000),
  translated_text text NOT NULL CHECK (length(translated_text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, frame_id, ordinal),
  FOREIGN KEY (tenant_id, run_id, frame_id)
    REFERENCES enterprise.meeting_screen_ocr_frames (tenant_id, run_id, id)
    ON DELETE CASCADE,
  CHECK (left_ratio + width_ratio <= 1.000001),
  CHECK (top_ratio + height_ratio <= 1.000001)
);

CREATE OR REPLACE FUNCTION enterprise.reject_meeting_screen_ocr_append_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise meeting screen OCR evidence is append-only';
END;
$$;

CREATE TRIGGER meeting_screen_ocr_commands_append_only
BEFORE UPDATE OR DELETE ON enterprise.meeting_screen_ocr_commands
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_screen_ocr_append_mutation();
CREATE TRIGGER meeting_screen_ocr_blocks_append_only
BEFORE UPDATE OR DELETE ON enterprise.meeting_screen_ocr_blocks
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_screen_ocr_append_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_meeting_screen_ocr_frame_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise meeting screen OCR frames cannot be deleted';
  END IF;
  IF ROW(
    NEW.tenant_id, NEW.id, NEW.meeting_id, NEW.share_id, NEW.run_id,
    NEW.frame_revision, NEW.perceptual_hash, NEW.source_width,
    NEW.source_height, NEW.captured_at, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.tenant_id, OLD.id, OLD.meeting_id, OLD.share_id, OLD.run_id,
    OLD.frame_revision, OLD.perceptual_hash, OLD.source_width,
    OLD.source_height, OLD.captured_at, OLD.created_at
  ) OR OLD.status <> 'processing' OR NEW.status NOT IN ('ready', 'failed') THEN
    RAISE EXCEPTION 'invalid enterprise meeting screen OCR frame transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER meeting_screen_ocr_frames_guard
BEFORE UPDATE OR DELETE ON enterprise.meeting_screen_ocr_frames
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_meeting_screen_ocr_frame_mutation();

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'meeting_screen_ocr_runs', 'meeting_screen_ocr_subscriptions',
    'meeting_screen_ocr_commands', 'meeting_screen_ocr_frames',
    'meeting_screen_ocr_blocks'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON enterprise.%I '
      'USING (tenant_id = enterprise.current_tenant_id()) '
      'WITH CHECK (tenant_id = enterprise.current_tenant_id())', tenant_table
    );
  END LOOP;
END
$$;
