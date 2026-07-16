ALTER TABLE enterprise.tenants
  DROP CONSTRAINT tenants_status_check;

ALTER TABLE enterprise.tenants
  ADD CONSTRAINT tenants_status_check CHECK (status IN (
    'provisioning', 'provisioning_failed', 'active', 'suspended',
    'deletion_requested', 'deleted'
  ));

CREATE TABLE enterprise.tenant_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  actor_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type IN (
    'tenant.provision', 'tenant.suspend', 'tenant.export', 'tenant.delete'
  )),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (actor_id, job_type, idempotency_key)
);

CREATE INDEX tenant_jobs_tenant_status_idx
  ON enterprise.tenant_jobs (tenant_id, status, updated_at, id);

ALTER TABLE enterprise.tenant_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenant_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise.tenant_jobs
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
