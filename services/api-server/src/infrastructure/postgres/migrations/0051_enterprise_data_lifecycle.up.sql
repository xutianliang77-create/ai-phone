CREATE TABLE enterprise.data_lifecycle_jobs (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type = 'object.delete'),
  data_class text NOT NULL CHECK (data_class = 'audit_export'),
  source_id uuid NOT NULL,
  object_key text NOT NULL,
  object_sha256 text NOT NULL CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 30),
  retention_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  completion_outcome text CHECK (
    completion_outcome IS NULL OR completion_outcome IN ('deleted', 'already_absent')
  ),
  receipt_hash text CHECK (
    receipt_hash IS NULL OR receipt_hash ~ '^[a-f0-9]{64}$'
  ),
  error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, data_class, source_id),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES enterprise.audit_export_jobs (tenant_id, id),
  CHECK (retention_until >= created_at),
  CHECK (length(object_key) BETWEEN 1 AND 1024),
  CHECK (
    (status = 'processing' AND completion_outcome IS NULL AND
      receipt_hash IS NULL AND completed_at IS NULL) OR
    (status = 'completed' AND completion_outcome IS NOT NULL AND
      receipt_hash IS NOT NULL AND error_code IS NULL AND
      next_attempt_at IS NULL AND lease_expires_at IS NULL AND
      completed_at IS NOT NULL) OR
    (status = 'failed' AND completion_outcome IS NULL AND
      receipt_hash IS NULL AND error_code IS NOT NULL AND
      next_attempt_at IS NULL AND lease_expires_at IS NULL AND
      completed_at IS NOT NULL)
  )
);

CREATE INDEX data_lifecycle_jobs_tenant_due_idx
  ON enterprise.data_lifecycle_jobs (
    tenant_id, status, next_attempt_at, lease_expires_at,
    retention_until, id
  );

ALTER TABLE enterprise.data_lifecycle_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.data_lifecycle_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY data_lifecycle_jobs_tenant_isolation
  ON enterprise.data_lifecycle_jobs
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.guard_data_lifecycle_job_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise data lifecycle evidence cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'terminal enterprise data lifecycle job is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF (
    NEW.tenant_id, NEW.id, NEW.job_type, NEW.data_class, NEW.source_id,
    NEW.object_key, NEW.object_sha256, NEW.size_bytes, NEW.retention_days,
    NEW.retention_until, NEW.created_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.id, OLD.job_type, OLD.data_class, OLD.source_id,
    OLD.object_key, OLD.object_sha256, OLD.size_bytes, OLD.retention_days,
    OLD.retention_until, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'enterprise data lifecycle scope is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN
    RAISE EXCEPTION 'invalid enterprise data lifecycle attempt transition'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_data_lifecycle_job_guard
BEFORE UPDATE OR DELETE ON enterprise.data_lifecycle_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_data_lifecycle_job_mutation();

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_work_kind_check,
  DROP CONSTRAINT platform_pending_work_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN (
      'tenant_lifecycle', 'outbox', 'audit_export', 'screen_share',
      'data_lifecycle'
    )
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind IN ('outbox', 'screen_share', 'data_lifecycle') AND actor_id IS NULL)
  );

CREATE OR REPLACE FUNCTION enterprise.sync_data_lifecycle_pending_work()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id AND work_kind = 'data_lifecycle'
      AND resource_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.status = 'processing' THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    )
    SELECT tenant.cell_id, NEW.tenant_id, 'data_lifecycle', NEW.id, NULL,
      COALESCE(NEW.next_attempt_at, NEW.retention_until), NEW.lease_expires_at
    FROM enterprise.tenants tenant WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id,
      actor_id = NULL,
      due_at = excluded.due_at,
      lease_expires_at = excluded.lease_expires_at;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id AND work_kind = 'data_lifecycle'
      AND resource_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_data_lifecycle_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.data_lifecycle_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.sync_data_lifecycle_pending_work();

CREATE OR REPLACE FUNCTION enterprise.guard_audit_export_tenant_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tenant_status text;
BEGIN
  SELECT status INTO tenant_status
  FROM enterprise.tenants
  WHERE id = NEW.tenant_id
  FOR UPDATE;
  IF tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'audit export rejected during tenant lifecycle'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_audit_export_tenant_lifecycle_guard
BEFORE INSERT ON enterprise.audit_export_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_audit_export_tenant_lifecycle();

CREATE OR REPLACE FUNCTION enterprise.register_audit_export_data_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.object_key IS NOT NULL AND
      NEW.artifact_sha256 IS NOT NULL AND NEW.size_bytes IS NOT NULL AND
      NEW.expires_at IS NOT NULL THEN
    INSERT INTO enterprise.data_lifecycle_jobs(
      tenant_id, id, job_type, data_class, source_id, object_key,
      object_sha256, size_bytes, retention_days, retention_until,
      status, attempts, created_at, updated_at
    ) VALUES (
      NEW.tenant_id, NEW.id, 'object.delete', 'audit_export', NEW.id,
      NEW.object_key, NEW.artifact_sha256, NEW.size_bytes,
      NEW.retention_days, NEW.expires_at, 'processing', 0,
      NEW.completed_at, NEW.completed_at
    ) ON CONFLICT (tenant_id, data_class, source_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_audit_export_data_lifecycle
AFTER INSERT OR UPDATE ON enterprise.audit_export_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.register_audit_export_data_lifecycle();

INSERT INTO enterprise.data_lifecycle_jobs(
  tenant_id, id, job_type, data_class, source_id, object_key,
  object_sha256, size_bytes, retention_days, retention_until,
  status, attempts, created_at, updated_at
)
SELECT tenant_id, id, 'object.delete', 'audit_export', id, object_key,
  artifact_sha256, size_bytes, retention_days, expires_at,
  'processing', 0, completed_at, completed_at
FROM enterprise.audit_export_jobs
WHERE status = 'completed' AND object_key IS NOT NULL
  AND artifact_sha256 IS NOT NULL AND size_bytes IS NOT NULL
  AND expires_at IS NOT NULL AND completed_at IS NOT NULL
ON CONFLICT (tenant_id, data_class, source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION enterprise.expedite_tenant_data_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'deletion_requested' AND
      OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE enterprise.platform_pending_work AS pending
    SET due_at = LEAST(pending.due_at, clock_timestamp())
    WHERE pending.tenant_id = NEW.id
      AND pending.work_kind = 'data_lifecycle';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_tenant_data_lifecycle_expedite
AFTER UPDATE OF status ON enterprise.tenants
FOR EACH ROW EXECUTE FUNCTION enterprise.expedite_tenant_data_lifecycle();
