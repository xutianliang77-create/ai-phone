DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM enterprise.data_lifecycle_jobs) THEN
    RAISE EXCEPTION 'cannot roll back enterprise data lifecycle evidence';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS enterprise_tenant_data_lifecycle_expedite
  ON enterprise.tenants;
DROP FUNCTION IF EXISTS enterprise.expedite_tenant_data_lifecycle();
DROP TRIGGER IF EXISTS enterprise_audit_export_data_lifecycle
  ON enterprise.audit_export_jobs;
DROP FUNCTION IF EXISTS enterprise.register_audit_export_data_lifecycle();
DROP TRIGGER IF EXISTS enterprise_audit_export_tenant_lifecycle_guard
  ON enterprise.audit_export_jobs;
DROP FUNCTION IF EXISTS enterprise.guard_audit_export_tenant_lifecycle();
DROP TRIGGER IF EXISTS enterprise_data_lifecycle_pending_work
  ON enterprise.data_lifecycle_jobs;
DROP FUNCTION IF EXISTS enterprise.sync_data_lifecycle_pending_work();

ALTER TABLE enterprise.platform_pending_work DISABLE ROW LEVEL SECURITY;
DELETE FROM enterprise.platform_pending_work WHERE work_kind = 'data_lifecycle';
ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT IF EXISTS platform_pending_work_check,
  DROP CONSTRAINT IF EXISTS platform_pending_work_work_kind_check,
  ADD CONSTRAINT platform_pending_work_work_kind_check CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox', 'audit_export', 'screen_share')
  ),
  ADD CONSTRAINT platform_pending_work_check CHECK (
    (work_kind IN ('tenant_lifecycle', 'audit_export') AND actor_id IS NOT NULL)
    OR (work_kind IN ('outbox', 'screen_share') AND actor_id IS NULL)
  );
ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS enterprise_data_lifecycle_job_guard
  ON enterprise.data_lifecycle_jobs;
DROP FUNCTION IF EXISTS enterprise.guard_data_lifecycle_job_mutation();
DROP TABLE IF EXISTS enterprise.data_lifecycle_jobs;
