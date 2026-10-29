-- Local candidate only. Apply and activate only as part of an approved release.
-- Ownership may move only after the previous account is fully deleted and its
-- last offline license has actually expired or been closed.
CREATE TABLE v10_subscription_restore_bindings (
  chain_key TEXT PRIMARY KEY REFERENCES v10_subscription_chains(chain_key),
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  original_app_account_token TEXT,
  restored_ms INTEGER NOT NULL,
  proof_hash TEXT NOT NULL
) STRICT;
CREATE TABLE v10_subscription_restore_events (
  event_id TEXT PRIMARY KEY,
  chain_key TEXT NOT NULL REFERENCES v10_subscription_chains(chain_key),
  previous_owner_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  proof_hash TEXT NOT NULL,
  restored_ms INTEGER NOT NULL
) STRICT;
