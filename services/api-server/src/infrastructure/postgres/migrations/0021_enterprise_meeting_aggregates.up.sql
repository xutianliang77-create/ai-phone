ALTER TABLE enterprise.meetings
  ADD COLUMN created_at timestamptz,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN ended_at timestamptz;

UPDATE enterprise.meetings
SET created_at = COALESCE(scheduled_at, now()),
    updated_at = COALESCE(scheduled_at, now()),
    started_at = CASE
      WHEN status IN ('active', 'ending', 'ended') THEN COALESCE(scheduled_at, now())
      ELSE NULL
    END,
    ended_at = CASE
      WHEN status IN ('ended', 'cancelled', 'failed') THEN COALESCE(scheduled_at, now())
      ELSE NULL
    END;

ALTER TABLE enterprise.meetings
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT meetings_title_check
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT meetings_status_check
    CHECK (status IN (
      'scheduled', 'provisioning', 'active', 'ending',
      'ended', 'cancelled', 'failed'
    )),
  ADD CONSTRAINT meetings_policy_object_check
    CHECK (jsonb_typeof(policy) = 'object'),
  ADD CONSTRAINT meetings_time_check CHECK (
    updated_at >= created_at AND
    (scheduled_at IS NULL OR scheduled_at >= created_at) AND
    (started_at IS NULL OR started_at >= created_at) AND
    (ended_at IS NULL OR ended_at >= COALESCE(started_at, created_at)) AND
    (retention_until IS NULL OR retention_until > created_at) AND
    ((status IN ('ended', 'cancelled', 'failed')) = (ended_at IS NOT NULL)) AND
    (status NOT IN ('active', 'ending', 'ended') OR started_at IS NOT NULL)
  );

ALTER TABLE enterprise.meeting_participants
  ADD CONSTRAINT meeting_participants_identity_xor_check
    CHECK ((user_id IS NOT NULL) <> (external_identity IS NOT NULL)),
  ADD CONSTRAINT meeting_participants_role_check
    CHECK (role IN ('host', 'member', 'guest')),
  ADD CONSTRAINT meeting_participants_role_identity_check CHECK (
    (role = 'guest' AND external_identity IS NOT NULL) OR
    (role IN ('host', 'member') AND user_id IS NOT NULL)
  ),
  ADD CONSTRAINT meeting_participants_display_name_check
    CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT meeting_participants_presence_time_check
    CHECK (left_at IS NULL OR (joined_at IS NOT NULL AND left_at >= joined_at));

CREATE UNIQUE INDEX meeting_participants_tenant_user_unique_idx
  ON enterprise.meeting_participants (tenant_id, meeting_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX meeting_participants_tenant_external_unique_idx
  ON enterprise.meeting_participants (tenant_id, meeting_id, external_identity)
  WHERE external_identity IS NOT NULL;

ALTER TABLE enterprise.meeting_artifacts
  ADD CONSTRAINT meeting_artifacts_type_check
    CHECK (artifact_type IN ('transcript', 'summary', 'action_items', 'recording')),
  ADD CONSTRAINT meeting_artifacts_status_check
    CHECK (status IN ('processing', 'ready', 'published', 'failed')),
  ADD CONSTRAINT meeting_artifacts_publish_check
    CHECK ((status = 'published') = (published_at IS NOT NULL));

CREATE INDEX meetings_tenant_recovery_idx
  ON enterprise.meetings (tenant_id, status, updated_at, id)
  WHERE status IN ('provisioning', 'active', 'ending');
