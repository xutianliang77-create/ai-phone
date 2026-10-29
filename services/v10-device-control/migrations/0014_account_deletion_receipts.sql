-- Local candidate only: no existing records are modified by this migration.
-- Revoked bearer hashes can read only a bounded, non-authenticating receipt.
CREATE TABLE v10_account_deletion_receipts (
  token_hash TEXT PRIMARY KEY,
  tombstone_id TEXT NOT NULL REFERENCES accounts(user_id),
  apple_revocation TEXT NOT NULL CHECK(apple_revocation IN ('confirmed','manual_required')),
  completed_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX v10_account_deletion_receipts_expiry ON v10_account_deletion_receipts(expires_ms);
CREATE TABLE v10_account_deletion_holds (
  owner_id TEXT PRIMARY KEY REFERENCES accounts(user_id),
  reason TEXT NOT NULL CHECK(reason='legacy_data_requires_review'),
  created_ms INTEGER NOT NULL
) STRICT;
