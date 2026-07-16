CREATE OR REPLACE FUNCTION enterprise.current_cell_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.cell_id', true), '')
$$;

CREATE TABLE enterprise.platform_pending_work (
  cell_id text,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  work_kind text NOT NULL CHECK (
    work_kind IN ('tenant_lifecycle', 'outbox')
  ),
  resource_id uuid NOT NULL,
  actor_id uuid,
  due_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  PRIMARY KEY (work_kind, tenant_id, resource_id),
  CHECK (
    (work_kind = 'tenant_lifecycle' AND actor_id IS NOT NULL) OR
    (work_kind = 'outbox' AND actor_id IS NULL)
  )
);

CREATE INDEX platform_pending_work_cell_due_idx
  ON enterprise.platform_pending_work (
    cell_id, due_at, lease_expires_at, work_kind, tenant_id, resource_id
  )
  WHERE cell_id IS NOT NULL;

LOCK TABLE enterprise.tenants, enterprise.tenant_jobs,
  enterprise.outbox_events
  IN ACCESS EXCLUSIVE MODE;
ALTER TABLE enterprise.tenant_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.outbox_events DISABLE ROW LEVEL SECURITY;

INSERT INTO enterprise.platform_pending_work(
  cell_id, tenant_id, work_kind, resource_id, actor_id,
  due_at, lease_expires_at
)
SELECT tenant.cell_id, job.tenant_id, 'tenant_lifecycle', job.id, job.actor_id,
  COALESCE(job.next_attempt_at, job.updated_at), job.lease_expires_at
FROM enterprise.tenant_jobs job
JOIN enterprise.tenants tenant ON tenant.id = job.tenant_id
WHERE job.status = 'processing'
  AND job.job_type IN ('tenant.export', 'tenant.delete');

INSERT INTO enterprise.platform_pending_work(
  cell_id, tenant_id, work_kind, resource_id, actor_id,
  due_at, lease_expires_at
)
SELECT tenant.cell_id, event.tenant_id, 'outbox', event.id, NULL,
  event.available_at, event.lease_expires_at
FROM enterprise.outbox_events event
JOIN enterprise.tenants tenant ON tenant.id = event.tenant_id
WHERE event.published_at IS NULL;

ALTER TABLE enterprise.tenant_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenant_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.outbox_events FORCE ROW LEVEL SECURITY;

ALTER TABLE enterprise.platform_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.platform_pending_work FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_pending_work_cell_read
  ON enterprise.platform_pending_work
  FOR SELECT
  USING (cell_id = enterprise.current_cell_id());

CREATE POLICY platform_pending_work_tenant_read
  ON enterprise.platform_pending_work
  FOR SELECT
  USING (tenant_id = enterprise.current_tenant_id());

CREATE POLICY platform_pending_work_tenant_insert
  ON enterprise.platform_pending_work
  FOR INSERT
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE POLICY platform_pending_work_tenant_update
  ON enterprise.platform_pending_work
  FOR UPDATE
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE POLICY platform_pending_work_tenant_delete
  ON enterprise.platform_pending_work
  FOR DELETE
  USING (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.enterprise_sync_tenant_job_pending_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id
      AND work_kind = 'tenant_lifecycle'
      AND resource_id = OLD.id;
    RETURN OLD;
  END IF;

  IF
    NEW.status = 'processing' AND
    NEW.job_type IN ('tenant.export', 'tenant.delete')
  THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    )
    SELECT tenant.cell_id, NEW.tenant_id, 'tenant_lifecycle', NEW.id,
      NEW.actor_id, COALESCE(NEW.next_attempt_at, NEW.updated_at),
      NEW.lease_expires_at
    FROM enterprise.tenants tenant
    WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id,
      actor_id = excluded.actor_id,
      due_at = excluded.due_at,
      lease_expires_at = excluded.lease_expires_at;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id
      AND work_kind = 'tenant_lifecycle'
      AND resource_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_tenant_job_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.tenant_jobs
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_sync_tenant_job_pending_work();

CREATE OR REPLACE FUNCTION enterprise.enterprise_sync_outbox_pending_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = OLD.tenant_id
      AND work_kind = 'outbox'
      AND resource_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.published_at IS NULL THEN
    INSERT INTO enterprise.platform_pending_work(
      cell_id, tenant_id, work_kind, resource_id, actor_id,
      due_at, lease_expires_at
    )
    SELECT tenant.cell_id, NEW.tenant_id, 'outbox', NEW.id, NULL,
      NEW.available_at, NEW.lease_expires_at
    FROM enterprise.tenants tenant
    WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (work_kind, tenant_id, resource_id) DO UPDATE SET
      cell_id = excluded.cell_id,
      actor_id = NULL,
      due_at = excluded.due_at,
      lease_expires_at = excluded.lease_expires_at;
  ELSE
    DELETE FROM enterprise.platform_pending_work
    WHERE tenant_id = NEW.tenant_id
      AND work_kind = 'outbox'
      AND resource_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_outbox_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.outbox_events
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_sync_outbox_pending_work();

CREATE OR REPLACE FUNCTION enterprise.enterprise_sync_pending_work_cell()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN
    UPDATE enterprise.platform_pending_work
    SET cell_id = NEW.cell_id
    WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_pending_work_cell
AFTER UPDATE OF cell_id ON enterprise.tenants
FOR EACH ROW
EXECUTE FUNCTION enterprise.enterprise_sync_pending_work_cell();
