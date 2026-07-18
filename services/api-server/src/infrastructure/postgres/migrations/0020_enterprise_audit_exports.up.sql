CREATE TABLE enterprise.audit_export_jobs (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN (
    'compliance_review', 'security_investigation',
    'customer_request', 'regulatory_request'
  )),
  scope_from timestamptz NOT NULL,
  scope_until timestamptz NOT NULL,
  action_filter text,
  resource_type_filter text,
  result_filter text CHECK (
    result_filter IS NULL OR result_filter IN (
      'accepted', 'completed', 'failed', 'denied'
    )
  ),
  format text NOT NULL CHECK (format = 'jsonl'),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 30),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  lease_expires_at timestamptz,
  object_key text,
  event_count integer CHECK (event_count IS NULL OR event_count >= 0),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  artifact_sha256 text CHECK (
    artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'
  ),
  expires_at timestamptz,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (enterprise.is_account_subject_id(actor_id)),
  CHECK (scope_until > scope_from),
  CHECK (scope_until - scope_from <= interval '31 days'),
  CHECK (action_filter IS NULL OR action_filter ~ '^[a-z][a-z0-9._:-]{0,79}$'),
  CHECK (
    resource_type_filter IS NULL OR
    resource_type_filter ~ '^[a-z][a-z0-9._:-]{0,79}$'
  ),
  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  CHECK (
    (status = 'processing' AND object_key IS NULL AND event_count IS NULL AND
      size_bytes IS NULL AND artifact_sha256 IS NULL AND expires_at IS NULL AND
      error_code IS NULL AND completed_at IS NULL) OR
    (status = 'completed' AND object_key IS NOT NULL AND event_count IS NOT NULL AND
      size_bytes IS NOT NULL AND artifact_sha256 IS NOT NULL AND expires_at IS NOT NULL AND
      error_code IS NULL AND completed_at IS NOT NULL AND next_attempt_at IS NULL AND
      lease_expires_at IS NULL) OR
    (status = 'failed' AND object_key IS NULL AND event_count IS NULL AND
      size_bytes IS NULL AND artifact_sha256 IS NULL AND expires_at IS NULL AND
      error_code IS NOT NULL AND completed_at IS NOT NULL AND next_attempt_at IS NULL AND
      lease_expires_at IS NULL)
  )
);

CREATE INDEX audit_export_jobs_tenant_created_idx
  ON enterprise.audit_export_jobs (tenant_id, created_at DESC, id DESC);
CREATE INDEX audit_export_jobs_tenant_status_due_idx
  ON enterprise.audit_export_jobs (
    tenant_id, status, next_attempt_at, lease_expires_at, created_at, id
  );

ALTER TABLE enterprise.audit_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.audit_export_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_export_jobs_tenant_read
  ON enterprise.audit_export_jobs FOR SELECT
  USING (tenant_id = enterprise.current_tenant_id());
CREATE POLICY audit_export_jobs_tenant_insert
  ON enterprise.audit_export_jobs FOR INSERT
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
CREATE POLICY audit_export_jobs_tenant_update
  ON enterprise.audit_export_jobs FOR UPDATE
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.guard_audit_export_job_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'enterprise audit export jobs cannot be deleted'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'terminal enterprise audit export job is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF (
    NEW.tenant_id, NEW.id, NEW.actor_id, NEW.purpose,
    NEW.scope_from, NEW.scope_until, NEW.action_filter,
    NEW.resource_type_filter, NEW.result_filter, NEW.format,
    NEW.retention_days, NEW.idempotency_key, NEW.request_hash, NEW.created_at
  ) IS DISTINCT FROM (
    OLD.tenant_id, OLD.id, OLD.actor_id, OLD.purpose,
    OLD.scope_from, OLD.scope_until, OLD.action_filter,
    OLD.resource_type_filter, OLD.result_filter, OLD.format,
    OLD.retention_days, OLD.idempotency_key, OLD.request_hash, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'enterprise audit export request is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_audit_export_job_guard
BEFORE UPDATE OR DELETE ON enterprise.audit_export_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_audit_export_job_mutation();

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_work_kind_check,
  DROP CONSTRAINT platform_pending_work_check;
ALTER TABLE enterprise.platform_pending_work
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox', 'audit_export')
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL) OR
    (work_kind = 'outbox' AND actor_id IS NULL)
  );

CREATE OR REPLACE FUNCTION enterprise.enterprise_sync_audit_export_pending_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id AND work_kind = 'audit_export'
      AND resource_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.status = 'processing' THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    )
    SELECT tenant.cell_id, NEW.tenant_id, 'audit_export', NEW.id, NEW.actor_id,
      COALESCE(NEW.next_attempt_at, NEW.updated_at), NEW.lease_expires_at
    FROM enterprise.tenants tenant WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id, actor_id = excluded.actor_id,
      due_at = excluded.due_at, lease_expires_at = excluded.lease_expires_at;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id AND work_kind = 'audit_export'
      AND resource_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_audit_export_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.audit_export_jobs
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_sync_audit_export_pending_work();
