DROP POLICY IF EXISTS tenant_isolation ON enterprise.tenant_jobs;
DROP TABLE IF EXISTS enterprise.tenant_jobs;

ALTER TABLE enterprise.tenants
  DROP CONSTRAINT tenants_status_check;

UPDATE enterprise.tenants
SET status = 'suspended'
WHERE status IN ('provisioning', 'provisioning_failed');

ALTER TABLE enterprise.tenants
  ADD CONSTRAINT tenants_status_check CHECK (status IN (
    'active', 'suspended', 'deletion_requested', 'deleted'
  ));
