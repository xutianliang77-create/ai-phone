DROP TRIGGER IF EXISTS enterprise_audit_export_pending_work
  ON enterprise.audit_export_jobs;
DROP FUNCTION IF EXISTS enterprise.enterprise_sync_audit_export_pending_work();

ALTER TABLE enterprise.platform_pending_work DISABLE ROW LEVEL SECURITY;
DELETE FROM enterprise.platform_pending_work WHERE work_kind = 'audit_export';
ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT platform_pending_work_work_kind_check,
  DROP CONSTRAINT platform_pending_work_check;
ALTER TABLE enterprise.platform_pending_work
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox')
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind = 'tenant_lifecycle' AND actor_id IS NOT NULL) OR
    (work_kind = 'outbox' AND actor_id IS NULL)
  );

DROP TRIGGER IF EXISTS enterprise_audit_export_job_guard
  ON enterprise.audit_export_jobs;
DROP FUNCTION IF EXISTS enterprise.guard_audit_export_job_mutation();
DROP TABLE IF EXISTS enterprise.audit_export_jobs;
