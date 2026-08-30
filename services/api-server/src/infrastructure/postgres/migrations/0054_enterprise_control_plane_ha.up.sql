CREATE OR REPLACE FUNCTION enterprise.current_control_plane_worker_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.control_plane_worker_id', true), '')
$$;

CREATE TABLE enterprise.control_plane_instances (
  instance_id text PRIMARY KEY CHECK (
    instance_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'
  ),
  region text NOT NULL CHECK (region ~ '^[a-z][a-z0-9-]{1,31}$'),
  generation bigint NOT NULL CHECK (generation > 0),
  status text NOT NULL CHECK (status IN ('active', 'draining')),
  build_commit text NOT NULL CHECK (build_commit ~ '^[a-f0-9]{40}$'),
  image_digest text NOT NULL CHECK (
    image_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  CHECK (heartbeat_at >= started_at),
  CHECK (lease_expires_at > heartbeat_at)
);

CREATE INDEX control_plane_instances_region_lease_idx
  ON enterprise.control_plane_instances (
    region, status, lease_expires_at, instance_id
  );

CREATE TABLE enterprise.control_plane_pending_work (
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  actor_id text NOT NULL,
  home_region text NOT NULL CHECK (
    home_region ~ '^[a-z][a-z0-9-]{1,31}$'
  ),
  due_at timestamptz NOT NULL,
  coordination_owner text,
  coordination_generation bigint NOT NULL DEFAULT 0 CHECK (
    coordination_generation >= 0
  ),
  coordination_lease_expires_at timestamptz,
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (job_id),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES enterprise.tenant_jobs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  CHECK (
    coordination_owner IS NULL OR
    coordination_owner ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$'
  ),
  CHECK (
    (coordination_owner IS NULL AND
      coordination_lease_expires_at IS NULL) OR
    (coordination_owner IS NOT NULL AND coordination_generation > 0 AND
      coordination_lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX control_plane_pending_work_due_idx
  ON enterprise.control_plane_pending_work (
    home_region, due_at, coordination_lease_expires_at, tenant_id, job_id
  );

ALTER TABLE enterprise.control_plane_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.control_plane_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.control_plane_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.control_plane_pending_work FORCE ROW LEVEL SECURITY;

CREATE POLICY control_plane_instances_read
  ON enterprise.control_plane_instances FOR SELECT
  USING (enterprise.current_control_plane_worker_id() IS NOT NULL);
CREATE POLICY control_plane_instances_self_insert
  ON enterprise.control_plane_instances FOR INSERT
  WITH CHECK (instance_id = enterprise.current_control_plane_worker_id());
CREATE POLICY control_plane_instances_self_update
  ON enterprise.control_plane_instances FOR UPDATE
  USING (instance_id = enterprise.current_control_plane_worker_id())
  WITH CHECK (instance_id = enterprise.current_control_plane_worker_id());

CREATE OR REPLACE FUNCTION enterprise.guard_control_plane_instance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  worker text := enterprise.current_control_plane_worker_id();
BEGIN
  IF worker IS NULL OR NEW.instance_id <> worker THEN
    RAISE EXCEPTION 'control-plane instance identity is required';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.generation <> 1 OR NEW.status <> 'active' OR
        NEW.started_at > clock_timestamp() + interval '30 seconds' OR
        NEW.heartbeat_at < NEW.started_at OR
        NEW.lease_expires_at > clock_timestamp() + interval '5 minutes' THEN
      RAISE EXCEPTION 'invalid control-plane instance registration';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.instance_id <> OLD.instance_id OR NEW.region <> OLD.region THEN
    RAISE EXCEPTION 'control-plane instance identity is immutable';
  END IF;
  IF OLD.lease_expires_at <= clock_timestamp() AND
      NEW.generation = OLD.generation + 1 AND NEW.status = 'active' AND
      NEW.started_at >= OLD.started_at AND
      NEW.heartbeat_at >= NEW.started_at AND
      NEW.lease_expires_at > NEW.heartbeat_at AND
      NEW.lease_expires_at <= clock_timestamp() + interval '5 minutes' THEN
    RETURN NEW;
  END IF;
  IF OLD.lease_expires_at > clock_timestamp() AND
      NEW.generation = OLD.generation AND
      NEW.started_at = OLD.started_at AND
      NEW.build_commit = OLD.build_commit AND
      NEW.image_digest = OLD.image_digest AND
      (NEW.status = OLD.status OR
        (OLD.status = 'active' AND NEW.status = 'draining')) AND
      NEW.heartbeat_at > OLD.heartbeat_at AND
      NEW.lease_expires_at > NEW.heartbeat_at AND
      NEW.lease_expires_at <= clock_timestamp() + interval '5 minutes' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid control-plane instance transition';
END
$$;

CREATE TRIGGER control_plane_instance_guard
BEFORE INSERT OR UPDATE ON enterprise.control_plane_instances
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_control_plane_instance();

CREATE POLICY control_plane_pending_work_read
  ON enterprise.control_plane_pending_work FOR SELECT
  USING (
    enterprise.current_control_plane_worker_id() IS NOT NULL OR
    tenant_id = enterprise.current_tenant_id()
  );
CREATE POLICY control_plane_pending_work_tenant_insert
  ON enterprise.control_plane_pending_work FOR INSERT
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
CREATE POLICY control_plane_pending_work_tenant_update
  ON enterprise.control_plane_pending_work FOR UPDATE
  USING (
    enterprise.current_control_plane_worker_id() IS NOT NULL OR
    tenant_id = enterprise.current_tenant_id()
  )
  WITH CHECK (
    enterprise.current_control_plane_worker_id() IS NOT NULL OR
    tenant_id = enterprise.current_tenant_id()
  );
CREATE POLICY control_plane_pending_work_tenant_delete
  ON enterprise.control_plane_pending_work FOR DELETE
  USING (tenant_id = enterprise.current_tenant_id());

CREATE OR REPLACE FUNCTION enterprise.sync_control_plane_pending_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM enterprise.control_plane_pending_work
    WHERE tenant_id = OLD.tenant_id AND job_id = OLD.id;
    RETURN OLD;
  END IF;
  IF NEW.job_type = 'tenant.provision' AND NEW.status = 'processing' THEN
    INSERT INTO enterprise.control_plane_pending_work(
      tenant_id, job_id, actor_id, home_region, due_at
    )
    SELECT NEW.tenant_id, NEW.id, NEW.actor_id, tenant.home_region,
      COALESCE(NEW.next_attempt_at, NEW.updated_at)
    FROM enterprise.tenants tenant
    WHERE tenant.id = NEW.tenant_id
    ON CONFLICT (tenant_id, job_id) DO UPDATE SET
      actor_id = excluded.actor_id,
      home_region = excluded.home_region,
      due_at = excluded.due_at;
  ELSE
    DELETE FROM enterprise.control_plane_pending_work
    WHERE tenant_id = NEW.tenant_id AND job_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER enterprise_control_plane_pending_work
AFTER INSERT OR UPDATE OR DELETE ON enterprise.tenant_jobs
FOR EACH ROW EXECUTE FUNCTION enterprise.sync_control_plane_pending_work();

ALTER TABLE enterprise.control_plane_pending_work DISABLE ROW LEVEL SECURITY;
INSERT INTO enterprise.control_plane_pending_work(
  tenant_id, job_id, actor_id, home_region, due_at
)
SELECT job.tenant_id, job.id, job.actor_id, tenant.home_region,
  COALESCE(job.next_attempt_at, job.updated_at)
FROM enterprise.tenant_jobs job
JOIN enterprise.tenants tenant ON tenant.id = job.tenant_id
WHERE job.job_type = 'tenant.provision' AND job.status = 'processing';
ALTER TABLE enterprise.control_plane_pending_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.control_plane_pending_work FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enterprise.guard_control_plane_pending_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  worker text := enterprise.current_control_plane_worker_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF worker IS NOT NULL OR EXISTS (
      SELECT 1 FROM enterprise.tenant_jobs job
      WHERE job.tenant_id = OLD.tenant_id AND job.id = OLD.job_id
        AND job.job_type = 'tenant.provision' AND job.status = 'processing'
    ) THEN
      RAISE EXCEPTION 'active control-plane pending work cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF worker IS NULL THEN
    IF TG_OP = 'INSERT' AND (
        NEW.coordination_owner IS NOT NULL OR
        NEW.coordination_generation <> 0 OR
        NEW.coordination_lease_expires_at IS NOT NULL) THEN
      RAISE EXCEPTION 'tenant session cannot coordinate control-plane work';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.coordination_owner IS DISTINCT FROM OLD.coordination_owner OR
          NEW.coordination_generation IS DISTINCT FROM
            OLD.coordination_generation OR
          NEW.coordination_lease_expires_at IS DISTINCT FROM
            OLD.coordination_lease_expires_at THEN
        RAISE EXCEPTION 'tenant session cannot coordinate control-plane work';
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM enterprise.tenant_jobs job
      JOIN enterprise.tenants tenant ON tenant.id = job.tenant_id
      WHERE job.tenant_id = NEW.tenant_id AND job.id = NEW.job_id
        AND job.actor_id = NEW.actor_id
        AND tenant.home_region = NEW.home_region
        AND job.job_type = 'tenant.provision' AND job.status = 'processing'
        AND COALESCE(job.next_attempt_at, job.updated_at) = NEW.due_at
    ) THEN
      RAISE EXCEPTION 'control-plane pending work must match provision job';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
      NEW.job_id IS DISTINCT FROM OLD.job_id OR
      NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
      NEW.home_region IS DISTINCT FROM OLD.home_region OR
      NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    RAISE EXCEPTION 'control-plane worker may only update coordination columns';
  END IF;
  IF NEW.coordination_owner IS NULL AND
      OLD.coordination_owner = worker AND
      NEW.coordination_generation = OLD.coordination_generation AND
      NEW.coordination_lease_expires_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.coordination_owner = worker AND
      OLD.coordination_owner = worker AND
      NEW.coordination_generation = OLD.coordination_generation AND
      NEW.coordination_lease_expires_at > OLD.coordination_lease_expires_at AND
      NEW.coordination_lease_expires_at <=
        clock_timestamp() + interval '5 minutes' AND
      OLD.coordination_lease_expires_at > clock_timestamp() THEN
    RETURN NEW;
  END IF;
  IF NEW.coordination_owner = worker AND
      NEW.coordination_generation = OLD.coordination_generation + 1 AND
      NEW.coordination_lease_expires_at > clock_timestamp() AND
      NEW.coordination_lease_expires_at <=
        clock_timestamp() + interval '5 minutes' AND
      COALESCE(OLD.coordination_lease_expires_at,
        '-infinity'::timestamptz) <= clock_timestamp() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid control-plane work coordination transition';
END
$$;

CREATE TRIGGER control_plane_pending_work_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.control_plane_pending_work
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_control_plane_pending_work();
