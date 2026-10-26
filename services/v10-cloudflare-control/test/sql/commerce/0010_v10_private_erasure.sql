-- New independent 1.0 control database only. No old project data import.
CREATE TABLE v10_private_erasure (
  owner_id TEXT PRIMARY KEY REFERENCES accounts(user_id),
  request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending','completed')),
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_code TEXT,
  receipt_hash TEXT
) STRICT;
