ALTER TABLE enterprise.tenant_jobs
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN scope_snapshot jsonb,
  ADD COLUMN receipt_ref text,
  ADD COLUMN receipt_hash text,
  ADD COLUMN completed_at timestamptz;

UPDATE enterprise.tenant_jobs
SET completed_at = updated_at
WHERE status = 'completed';

ALTER TABLE enterprise.tenant_jobs
  ADD CONSTRAINT tenant_jobs_receipt_hash_check CHECK (
    receipt_hash IS NULL OR receipt_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT tenant_jobs_completion_check CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  );

CREATE INDEX tenant_jobs_recovery_idx
  ON enterprise.tenant_jobs (
    tenant_id, status, next_attempt_at, lease_expires_at, updated_at, id
  )
  WHERE status = 'processing'
    AND job_type IN ('tenant.export', 'tenant.delete');
