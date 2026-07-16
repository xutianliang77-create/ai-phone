DROP TRIGGER IF EXISTS enterprise_pending_work_cell ON enterprise.tenants;
DROP FUNCTION IF EXISTS enterprise.enterprise_sync_pending_work_cell();

DROP TRIGGER IF EXISTS enterprise_outbox_pending_work
  ON enterprise.outbox_events;
DROP FUNCTION IF EXISTS enterprise.enterprise_sync_outbox_pending_work();

DROP TRIGGER IF EXISTS enterprise_tenant_job_pending_work
  ON enterprise.tenant_jobs;
DROP FUNCTION IF EXISTS enterprise.enterprise_sync_tenant_job_pending_work();

DROP TABLE IF EXISTS enterprise.platform_pending_work;
DROP FUNCTION IF EXISTS enterprise.current_cell_id();
