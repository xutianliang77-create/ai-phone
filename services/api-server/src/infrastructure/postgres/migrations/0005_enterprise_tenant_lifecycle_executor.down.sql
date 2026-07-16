DROP INDEX IF EXISTS enterprise.tenant_jobs_recovery_idx;

ALTER TABLE enterprise.tenant_jobs
  DROP CONSTRAINT IF EXISTS tenant_jobs_completion_check,
  DROP CONSTRAINT IF EXISTS tenant_jobs_receipt_hash_check,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS receipt_hash,
  DROP COLUMN IF EXISTS receipt_ref,
  DROP COLUMN IF EXISTS scope_snapshot,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS attempts;
