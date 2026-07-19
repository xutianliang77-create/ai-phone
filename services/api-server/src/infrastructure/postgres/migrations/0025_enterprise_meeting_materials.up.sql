CREATE TABLE enterprise.meeting_material_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  source_event_count integer NOT NULL CHECK (source_event_count >= 0),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL CHECK (
    review_status IN ('processing', 'not_configured', 'ready', 'failed')
  ),
  review_reason_code text CHECK (
    review_reason_code ~ '^[a-z][a-z0-9._:-]{0,159}$'
  ),
  provider_fingerprint text CHECK (
    provider_fingerprint IS NULL OR
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  retention_until timestamptz,
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, meeting_id, id),
  UNIQUE (tenant_id, meeting_id, revision),
  UNIQUE (tenant_id, meeting_id, idempotency_key),
  FOREIGN KEY (tenant_id, meeting_id)
    REFERENCES enterprise.meetings (tenant_id, id) ON DELETE CASCADE,
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (updated_at >= created_at),
  CHECK (published_at IS NULL OR published_at >= created_at),
  CHECK (retention_until IS NULL OR retention_until > created_at),
  CHECK (
    (review_status = 'ready' AND review_reason_code IS NULL) OR
    (review_status <> 'ready' AND review_reason_code IS NOT NULL)
  ),
  CHECK (review_status <> 'ready' OR provider_fingerprint IS NOT NULL)
);

CREATE INDEX meeting_material_runs_current_idx
  ON enterprise.meeting_material_runs (
    tenant_id, meeting_id, revision DESC, created_at DESC, id
  );

CREATE TABLE enterprise.meeting_material_segments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_participant_id uuid NOT NULL,
  source_display_name text NOT NULL
    CHECK (length(btrim(source_display_name)) BETWEEN 1 AND 120),
  source_track_sid text NOT NULL
    CHECK (length(btrim(source_track_sid)) BETWEEN 1 AND 128),
  source_segment_id text NOT NULL
    CHECK (length(btrim(source_segment_id)) BETWEEN 1 AND 160),
  revision integer NOT NULL CHECK (revision >= 0),
  source_language text NOT NULL CHECK (source_language IN ('zh', 'en')),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 32768),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, material_run_id, id),
  UNIQUE (tenant_id, material_run_id, ordinal),
  UNIQUE (
    tenant_id, material_run_id, source_participant_id,
    source_track_sid, source_segment_id, revision
  ),
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id, source_participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id)
);

CREATE INDEX meeting_material_segments_timeline_idx
  ON enterprise.meeting_material_segments (
    tenant_id, material_run_id, ordinal, occurred_at, id
  );

CREATE TABLE enterprise.meeting_material_segment_translations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  material_segment_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('zh', 'en')),
  translated_text text NOT NULL
    CHECK (length(translated_text) BETWEEN 1 AND 32768),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, material_segment_id, language),
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, material_run_id, material_segment_id)
    REFERENCES enterprise.meeting_material_segments (
      tenant_id, material_run_id, id
    ) ON DELETE CASCADE
);

CREATE TABLE enterprise.meeting_material_speaker_labels (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  display_name text NOT NULL
    CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, material_run_id, participant_id),
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id, participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  CHECK (updated_at >= created_at)
);

CREATE TABLE enterprise.meeting_material_conclusions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('summary', 'topic', 'decision', 'objection', 'risk', 'unresolved')
  ),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  conclusion_text text NOT NULL
    CHECK (length(btrim(conclusion_text)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, material_run_id, id),
  UNIQUE (tenant_id, material_run_id, kind, ordinal),
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE
);

CREATE TABLE enterprise.meeting_material_conclusion_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  conclusion_id uuid NOT NULL,
  material_segment_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, conclusion_id, material_segment_id),
  FOREIGN KEY (tenant_id, material_run_id, conclusion_id)
    REFERENCES enterprise.meeting_material_conclusions (
      tenant_id, material_run_id, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, material_run_id, material_segment_id)
    REFERENCES enterprise.meeting_material_segments (
      tenant_id, material_run_id, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE
);

UPDATE enterprise.meeting_action_items
SET status = CASE
  WHEN status IN ('open', 'completed', 'cancelled') THEN status
  ELSE 'open'
END;

UPDATE enterprise.meeting_action_items action
SET owner_participant_id = NULL
WHERE owner_participant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM enterprise.meeting_participants participant
    WHERE participant.tenant_id = action.tenant_id
      AND participant.meeting_id = action.meeting_id
      AND participant.id = action.owner_participant_id
  );

ALTER TABLE enterprise.meeting_action_items
  ADD COLUMN material_run_id uuid,
  ADD COLUMN ordinal integer,
  ADD COLUMN priority text,
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz,
  ADD CONSTRAINT meeting_action_items_material_run_fk
    FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT meeting_action_items_material_scope_key
    UNIQUE (tenant_id, material_run_id, id),
  ADD CONSTRAINT meeting_action_items_scoped_owner_fk
    FOREIGN KEY (tenant_id, meeting_id, owner_participant_id)
    REFERENCES enterprise.meeting_participants (tenant_id, meeting_id, id),
  ADD CONSTRAINT meeting_action_items_status_check
    CHECK (status IN ('open', 'completed', 'cancelled')),
  ADD CONSTRAINT meeting_action_items_priority_check
    CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
  ADD CONSTRAINT meeting_action_items_ordinal_check
    CHECK (ordinal IS NULL OR ordinal >= 0),
  ADD CONSTRAINT meeting_action_items_text_check
    CHECK (length(btrim(item_text)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT meeting_action_items_time_check
    CHECK (
      (created_at IS NULL AND updated_at IS NULL) OR
      (created_at IS NOT NULL AND updated_at >= created_at)
    );

CREATE UNIQUE INDEX meeting_action_items_material_ordinal_idx
  ON enterprise.meeting_action_items (tenant_id, material_run_id, ordinal)
  WHERE material_run_id IS NOT NULL;

CREATE TABLE enterprise.meeting_action_item_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  meeting_id uuid NOT NULL,
  material_run_id uuid NOT NULL,
  action_item_id uuid NOT NULL,
  material_segment_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, action_item_id, material_segment_id),
  FOREIGN KEY (tenant_id, material_run_id, action_item_id)
    REFERENCES enterprise.meeting_action_items (
      tenant_id, material_run_id, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, material_run_id, material_segment_id)
    REFERENCES enterprise.meeting_material_segments (
      tenant_id, material_run_id, id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, meeting_id, material_run_id)
    REFERENCES enterprise.meeting_material_runs (tenant_id, meeting_id, id)
    ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION enterprise.reject_meeting_material_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise meeting material evidence is immutable';
END;
$$;

CREATE TRIGGER meeting_material_segments_immutable
BEFORE UPDATE OR DELETE ON enterprise.meeting_material_segments
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_material_mutation();
CREATE TRIGGER meeting_material_translations_immutable
BEFORE UPDATE OR DELETE ON enterprise.meeting_material_segment_translations
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_material_mutation();
CREATE TRIGGER meeting_material_conclusions_immutable
BEFORE UPDATE OR DELETE ON enterprise.meeting_material_conclusions
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_material_mutation();
CREATE TRIGGER meeting_material_conclusion_evidence_immutable
BEFORE UPDATE OR DELETE ON enterprise.meeting_material_conclusion_evidence
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_material_mutation();
CREATE TRIGGER meeting_action_item_evidence_immutable
BEFORE UPDATE OR DELETE ON enterprise.meeting_action_item_evidence
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_meeting_material_mutation();

DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'meeting_material_runs', 'meeting_material_segments',
    'meeting_material_segment_translations', 'meeting_material_speaker_labels',
    'meeting_material_conclusions', 'meeting_material_conclusion_evidence',
    'meeting_action_item_evidence'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', tenant_table
    );
    EXECUTE format(
      'ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', tenant_table
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON enterprise.%I '
      'USING (tenant_id = enterprise.current_tenant_id()) '
      'WITH CHECK (tenant_id = enterprise.current_tenant_id())',
      tenant_table
    );
  END LOOP;
END
$$;
