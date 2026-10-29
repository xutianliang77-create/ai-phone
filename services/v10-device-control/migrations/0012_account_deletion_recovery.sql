-- Source-only migration. Applying it and activating the scheduled handler
-- require a separately approved deployment. This queue is only for new 1.0
-- deletion requests, not the historical finance/outbox maintenance queue.
CREATE TABLE v10_account_deletion_recovery (
  owner_id TEXT PRIMARY KEY REFERENCES accounts(user_id),
  job_id TEXT NOT NULL UNIQUE,
  event_prefix TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','needs_finalization','manual_apple_required','reconcile_required')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  due_ms INTEGER NOT NULL,
  lease_id TEXT,
  lease_until_ms INTEGER,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX v10_deletion_recovery_due ON v10_account_deletion_recovery(state,due_ms,lease_until_ms);
