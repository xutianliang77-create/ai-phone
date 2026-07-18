CREATE TABLE enterprise.communication_policy_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  policy_version text NOT NULL
    CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('published', 'retired')),
  asr_preference text NOT NULL CHECK (asr_preference IN (
    'device_only', 'prefer_device', 'prefer_cloud', 'cloud_only', 'disabled'
  )),
  translation_preference text NOT NULL CHECK (translation_preference IN (
    'device_only', 'prefer_device', 'prefer_cloud', 'cloud_only', 'disabled'
  )),
  tts_preference text NOT NULL CHECK (tts_preference IN (
    'device_only', 'prefer_device', 'prefer_cloud', 'cloud_only', 'disabled'
  )),
  voice_identity_mode text NOT NULL
    CHECK (voice_identity_mode IN ('disabled', 'consent_required')),
  recording_mode text NOT NULL
    CHECK (recording_mode IN ('disabled', 'consent_required')),
  diagnostic_audio_mode text NOT NULL
    CHECK (diagnostic_audio_mode IN ('disabled', 'consent_required')),
  allow_captions_only boolean NOT NULL,
  allow_half_duplex boolean NOT NULL,
  published_at timestamptz NOT NULL,
  retired_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, policy_version),
  CHECK (
    (status = 'published' AND retired_at IS NULL)
    OR (status = 'retired' AND retired_at IS NOT NULL)
  )
);

INSERT INTO enterprise.communication_policy_versions(
  id, tenant_id, policy_version, status, asr_preference,
  translation_preference, tts_preference, voice_identity_mode,
  recording_mode, diagnostic_audio_mode, allow_captions_only,
  allow_half_duplex, published_at, retired_at
)
SELECT DISTINCT
  md5('enterprise-policy:' || tenant_id::text || ':' || policy_version)::uuid,
  tenant_id, policy_version, 'retired', 'disabled', 'disabled', 'disabled',
  'disabled', 'disabled', 'disabled', false, false, started_at, started_at
FROM enterprise.communication_session_bindings
ON CONFLICT (tenant_id, policy_version) DO NOTHING;

ALTER TABLE enterprise.communication_session_bindings
  ADD CONSTRAINT communication_bindings_policy_version_fk
  FOREIGN KEY (tenant_id, policy_version)
  REFERENCES enterprise.communication_policy_versions (tenant_id, policy_version);

CREATE TABLE enterprise.communication_authorization_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  communication_session_id text NOT NULL,
  policy_version text NOT NULL,
  purpose text NOT NULL
    CHECK (purpose IN ('voice_identity', 'recording', 'diagnostic_audio')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  subject_set_hash text NOT NULL CHECK (subject_set_hash ~ '^[a-f0-9]{64}$'),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (
    tenant_id, communication_session_id, policy_version, purpose, evidence_hash
  ),
  FOREIGN KEY (tenant_id, communication_session_id)
    REFERENCES enterprise.communication_session_bindings (
      tenant_id, communication_session_id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_version)
    REFERENCES enterprise.communication_policy_versions (
      tenant_id, policy_version
    ),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CHECK (created_at >= granted_at)
);
CREATE INDEX communication_authorization_active_idx
  ON enterprise.communication_authorization_evidence (
    tenant_id, communication_session_id, purpose, expires_at, id
  ) WHERE revoked_at IS NULL;

CREATE TABLE enterprise.communication_policy_snapshots (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  communication_session_id text NOT NULL,
  policy_version text NOT NULL,
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  generation bigint NOT NULL CHECK (generation > 0),
  asr_execution text NOT NULL
    CHECK (asr_execution IN ('device', 'cloud', 'disabled', 'unavailable')),
  translation_execution text NOT NULL CHECK (
    translation_execution IN ('device', 'cloud', 'disabled', 'unavailable')
  ),
  tts_execution text NOT NULL
    CHECK (tts_execution IN ('device', 'cloud', 'disabled', 'unavailable')),
  voice_identity_enabled boolean NOT NULL,
  recording_enabled boolean NOT NULL,
  diagnostic_audio_enabled boolean NOT NULL,
  authorization_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  allowed_capabilities text[] NOT NULL DEFAULT '{}',
  runtime_state text NOT NULL
    CHECK (runtime_state IN ('full', 'captions_only', 'half_duplex', 'blocked')),
  reason_code text NOT NULL CHECK (length(btrim(reason_code)) BETWEEN 1 AND 128),
  fingerprints jsonb NOT NULL DEFAULT '{}',
  readiness_expires_at timestamptz NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'invalidated')),
  created_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, communication_session_id, generation),
  FOREIGN KEY (tenant_id, communication_session_id)
    REFERENCES enterprise.communication_session_bindings (
      tenant_id, communication_session_id
    ) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_version)
    REFERENCES enterprise.communication_policy_versions (
      tenant_id, policy_version
    ),
  CHECK (
    allowed_capabilities <@ ARRAY[
      'translation_runtime', 'voice_agent_runtime'
    ]::text[]
  ),
  CHECK (jsonb_typeof(fingerprints) = 'object'),
  CHECK (
    (status = 'active' AND invalidated_at IS NULL)
    OR (status = 'invalidated' AND invalidated_at IS NOT NULL)
  )
);
CREATE INDEX communication_policy_snapshots_active_idx
  ON enterprise.communication_policy_snapshots (
    tenant_id, communication_session_id, generation, readiness_expires_at, id
  ) WHERE status = 'active';

INSERT INTO enterprise.communication_policy_snapshots(
  id, tenant_id, communication_session_id, policy_version, route_epoch,
  generation, asr_execution, translation_execution, tts_execution,
  voice_identity_enabled, recording_enabled, diagnostic_audio_enabled,
  authorization_evidence_ids, allowed_capabilities, runtime_state,
  reason_code, fingerprints, readiness_expires_at, request_hash,
  status, created_at, invalidated_at
)
SELECT
  md5('enterprise-policy-snapshot:' || tenant_id::text || ':' ||
    communication_session_id || ':' || generation::text)::uuid,
  tenant_id, communication_session_id, policy_version, route_epoch, generation,
  'disabled', 'disabled', 'disabled', false, false, false, '{}', '{}',
  'blocked', 'migration_restrictive_default', '{}', started_at,
  md5(tenant_id::text || ':' || communication_session_id || ':' || generation::text)
    || md5('second:' || tenant_id::text || ':' || communication_session_id ||
      ':' || generation::text),
  'invalidated', started_at, started_at
FROM enterprise.communication_session_bindings
ON CONFLICT (tenant_id, communication_session_id, generation) DO NOTHING;

ALTER TABLE enterprise.worker_dispatch_grants
  ADD COLUMN policy_snapshot_id uuid,
  ADD COLUMN policy_version text;
UPDATE enterprise.worker_dispatch_grants AS grant_record
SET policy_snapshot_id = snapshot.id,
  policy_version = snapshot.policy_version
FROM enterprise.communication_policy_snapshots AS snapshot
WHERE snapshot.tenant_id = grant_record.tenant_id
  AND snapshot.communication_session_id = grant_record.communication_session_id
  AND snapshot.generation = grant_record.generation;
ALTER TABLE enterprise.worker_dispatch_grants
  ALTER COLUMN policy_snapshot_id SET NOT NULL,
  ALTER COLUMN policy_version SET NOT NULL,
  ADD CONSTRAINT worker_dispatch_grants_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES enterprise.communication_policy_snapshots (tenant_id, id),
  ADD CONSTRAINT worker_dispatch_grants_policy_version_fk
    FOREIGN KEY (tenant_id, policy_version)
    REFERENCES enterprise.communication_policy_versions (tenant_id, policy_version);

CREATE OR REPLACE FUNCTION enterprise.reject_communication_policy_version_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    IF NEW.status = 'retired' AND OLD.status = 'published'
      AND NEW.retired_at IS NOT NULL
      AND (NEW.id, NEW.tenant_id, NEW.policy_version, NEW.asr_preference,
        NEW.translation_preference, NEW.tts_preference,
        NEW.voice_identity_mode, NEW.recording_mode, NEW.diagnostic_audio_mode,
        NEW.allow_captions_only, NEW.allow_half_duplex, NEW.published_at)
      IS NOT DISTINCT FROM
      (OLD.id, OLD.tenant_id, OLD.policy_version, OLD.asr_preference,
        OLD.translation_preference, OLD.tts_preference,
        OLD.voice_identity_mode, OLD.recording_mode, OLD.diagnostic_audio_mode,
        OLD.allow_captions_only, OLD.allow_half_duplex, OLD.published_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'enterprise communication policy version is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER communication_policy_version_immutable
BEFORE UPDATE ON enterprise.communication_policy_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_communication_policy_version_change();

CREATE OR REPLACE FUNCTION enterprise.reject_communication_authorization_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL
    AND (NEW.id, NEW.tenant_id, NEW.communication_session_id,
      NEW.policy_version, NEW.purpose, NEW.evidence_hash,
      NEW.subject_set_hash, NEW.granted_at, NEW.expires_at, NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.communication_session_id,
      OLD.policy_version, OLD.purpose, OLD.evidence_hash,
      OLD.subject_set_hash, OLD.granted_at, OLD.expires_at, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise communication authorization is immutable';
END;
$$;
CREATE TRIGGER communication_authorization_immutable
BEFORE UPDATE ON enterprise.communication_authorization_evidence
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_communication_authorization_change();

CREATE OR REPLACE FUNCTION enterprise.invalidate_communication_policy_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enterprise.communication_policy_snapshots
  SET status = 'invalidated', invalidated_at = NEW.revoked_at
  WHERE tenant_id = NEW.tenant_id AND status = 'active'
    AND NEW.id = ANY(authorization_evidence_ids);
  RETURN NEW;
END;
$$;
CREATE TRIGGER communication_authorization_invalidate_snapshot
AFTER UPDATE OF revoked_at ON enterprise.communication_authorization_evidence
FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
EXECUTE FUNCTION enterprise.invalidate_communication_policy_snapshot();

CREATE OR REPLACE FUNCTION enterprise.reject_communication_policy_snapshot_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'invalidated' AND OLD.status = 'active'
    AND NEW.invalidated_at IS NOT NULL
    AND (NEW.id, NEW.tenant_id, NEW.communication_session_id,
      NEW.policy_version, NEW.route_epoch, NEW.generation,
      NEW.asr_execution, NEW.translation_execution, NEW.tts_execution,
      NEW.voice_identity_enabled, NEW.recording_enabled,
      NEW.diagnostic_audio_enabled, NEW.authorization_evidence_ids,
      NEW.allowed_capabilities, NEW.runtime_state, NEW.reason_code,
      NEW.fingerprints, NEW.readiness_expires_at, NEW.request_hash,
      NEW.created_at)
    IS NOT DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.communication_session_id,
      OLD.policy_version, OLD.route_epoch, OLD.generation,
      OLD.asr_execution, OLD.translation_execution, OLD.tts_execution,
      OLD.voice_identity_enabled, OLD.recording_enabled,
      OLD.diagnostic_audio_enabled, OLD.authorization_evidence_ids,
      OLD.allowed_capabilities, OLD.runtime_state, OLD.reason_code,
      OLD.fingerprints, OLD.readiness_expires_at, OLD.request_hash,
      OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'enterprise communication policy snapshot is immutable';
END;
$$;
CREATE TRIGGER communication_policy_snapshot_immutable
BEFORE UPDATE ON enterprise.communication_policy_snapshots
FOR EACH ROW EXECUTE FUNCTION enterprise.reject_communication_policy_snapshot_change();

CREATE OR REPLACE FUNCTION enterprise.reject_worker_dispatch_grant_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.tenant_id, NEW.communication_session_id, NEW.dispatch_id,
    NEW.capacity_reservation_id, NEW.capability, NEW.cell_id,
    NEW.route_epoch, NEW.generation, NEW.policy_snapshot_id,
    NEW.policy_version, NEW.idempotency_key, NEW.request_hash,
    NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.communication_session_id, OLD.dispatch_id,
    OLD.capacity_reservation_id, OLD.capability, OLD.cell_id,
    OLD.route_epoch, OLD.generation, OLD.policy_snapshot_id,
    OLD.policy_version, OLD.idempotency_key, OLD.request_hash,
    OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'enterprise worker dispatch grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communication_policy_versions',
    'communication_authorization_evidence',
    'communication_policy_snapshots'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON enterprise.%I USING (tenant_id = enterprise.current_tenant_id()) WITH CHECK (tenant_id = enterprise.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;
