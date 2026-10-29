-- A random capability can only read a deletion status; it cannot authenticate
-- or access account, transaction, or content data. Local candidate only.
CREATE TABLE v10_deletion_status_capabilities (
  capability_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  completed_ms INTEGER,
  apple_revocation TEXT CHECK(apple_revocation IS NULL OR apple_revocation IN ('confirmed','manual_required'))
) STRICT;
CREATE INDEX v10_deletion_capabilities_owner ON v10_deletion_status_capabilities(owner_id);
CREATE INDEX v10_deletion_capabilities_expiry ON v10_deletion_status_capabilities(expires_ms);
