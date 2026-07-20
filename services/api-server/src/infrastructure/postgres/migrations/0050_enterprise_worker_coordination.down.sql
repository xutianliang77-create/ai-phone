DROP TRIGGER IF EXISTS platform_pending_work_cell_claim_guard
  ON enterprise.platform_pending_work;
DROP FUNCTION IF EXISTS enterprise.guard_platform_pending_work_cell_claim();

DROP POLICY IF EXISTS platform_pending_work_cell_claim
  ON enterprise.platform_pending_work;
DROP INDEX IF EXISTS enterprise.platform_pending_work_coordination_due_idx;

ALTER TABLE enterprise.platform_pending_work
  DROP CONSTRAINT IF EXISTS platform_pending_work_coordination_lease_check,
  DROP CONSTRAINT IF EXISTS platform_pending_work_coordination_owner_check,
  DROP CONSTRAINT IF EXISTS platform_pending_work_coordination_generation_check,
  DROP COLUMN IF EXISTS coordination_lease_expires_at,
  DROP COLUMN IF EXISTS coordination_generation,
  DROP COLUMN IF EXISTS coordination_owner;
