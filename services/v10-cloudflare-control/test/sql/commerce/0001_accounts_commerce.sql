-- CF-A3 source migration only. Not applied to any local or remote database.
-- Financial uniqueness is account-wide, never one database per customer/DO.
PRAGMA foreign_keys = ON;

CREATE TABLE writer_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  fence INTEGER NOT NULL CHECK (fence > 0),
  write_enabled INTEGER NOT NULL CHECK (write_enabled IN (0,1))
) STRICT;
-- Activation belongs to the separately authorized deployment/cutover, not login.
INSERT INTO writer_control VALUES (1,1,1,0);

CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  app_account_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active','deletion_requested','deleted')),
  authorization_epoch INTEGER NOT NULL CHECK (authorization_epoch > 0),
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  last_login_ms INTEGER,
  deletion_requested_ms INTEGER,
  deletion_retention_until_ms INTEGER
) STRICT;
CREATE INDEX accounts_deletion_due ON accounts(status,deletion_retention_until_ms);

CREATE TABLE identities (
  identity_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('apple','phone')),
  issuer TEXT NOT NULL,
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  created_ms INTEGER NOT NULL,
  revoked_ms INTEGER,
  UNIQUE (provider,issuer,scope,subject_hash)
) STRICT;
CREATE INDEX identities_owner ON identities(user_id,identity_key);

CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  identity_key TEXT NOT NULL REFERENCES identities(identity_key),
  authorization_epoch INTEGER NOT NULL CHECK (authorization_epoch > 0),
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK (expires_ms > created_ms),
  revoked_ms INTEGER
) STRICT;
CREATE INDEX account_tokens_owner ON account_tokens(user_id,revoked_ms);

CREATE TABLE account_agreements (
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('initial_privacy','terms')),
  version TEXT NOT NULL,
  accepted_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (user_id,kind,version)
) STRICT;

CREATE TABLE apple_auth_challenges (
  challenge_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  state_hash TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('login','link')),
  target_user_id TEXT REFERENCES accounts(user_id),
  target_epoch INTEGER,
  observed_account_epoch INTEGER,
  token_key_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK (expires_ms > created_ms),
  exchange_state TEXT NOT NULL CHECK (exchange_state IN ('new','prepared','completed','unknown')),
  exchange_request_hash TEXT,
  identity_key TEXT,
  owner_id TEXT,
  credential_json TEXT CHECK (credential_json IS NULL OR json_valid(credential_json)),
  consumed_ms INTEGER,
  token_hash TEXT,
  CHECK ((action='login' AND target_user_id IS NULL AND target_epoch IS NULL)
    OR (action='link' AND target_user_id IS NOT NULL AND target_epoch > 0))
) STRICT;
CREATE INDEX apple_challenges_expiry ON apple_auth_challenges(expires_ms,exchange_state);

CREATE TABLE apple_credentials (
  identity_key TEXT PRIMARY KEY REFERENCES identities(identity_key),
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  sealed_json TEXT NOT NULL CHECK (json_valid(sealed_json)),
  version INTEGER NOT NULL CHECK (version > 0),
  validated_ms INTEGER NOT NULL,
  revoked_ms INTEGER
) STRICT;
CREATE INDEX apple_credentials_owner ON apple_credentials(user_id,revoked_ms);

CREATE TABLE apple_refresh_claims (
  identity_key TEXT NOT NULL REFERENCES identities(identity_key),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  state TEXT NOT NULL CHECK (state IN ('prepared','completed','unknown')),
  claimed_ms INTEGER NOT NULL,
  PRIMARY KEY (identity_key,credential_version)
) STRICT;

CREATE TABLE usage_accounts (
  user_id TEXT PRIMARY KEY REFERENCES accounts(user_id),
  available_seconds INTEGER NOT NULL CHECK (available_seconds >= 0),
  reserved_seconds INTEGER NOT NULL CHECK (reserved_seconds >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_ms INTEGER NOT NULL,
  CHECK (available_seconds+reserved_seconds <= 9007199254740991)
) STRICT;

CREATE TABLE apple_transactions (
  transaction_key TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox','Production')),
  bundle_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  app_account_token TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  snapshot_hash TEXT NOT NULL,
  product_snapshot_json TEXT NOT NULL CHECK (json_valid(product_snapshot_json)),
  semantic_hash TEXT NOT NULL,
  proof_ref TEXT NOT NULL,
  received_ms INTEGER NOT NULL,
  UNIQUE (environment,bundle_id,transaction_id)
) STRICT;

CREATE TABLE product_snapshots (
  environment TEXT NOT NULL CHECK (environment IN ('Sandbox','Production')),
  bundle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  PRIMARY KEY (environment,bundle_id,product_id,version)
) STRICT;
CREATE TABLE purchase_orders (
  order_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  request_key TEXT NOT NULL,
  environment TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_version TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_ms INTEGER NOT NULL,
  UNIQUE (owner_id,request_key),
  FOREIGN KEY (environment,bundle_id,product_id,product_version)
    REFERENCES product_snapshots(environment,bundle_id,product_id,version)
) STRICT;
CREATE INDEX purchase_orders_owner ON purchase_orders(owner_id,created_ms,order_id);
CREATE TABLE apple_notification_inbox (
  notification_uuid TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  transaction_key TEXT,
  owner_id TEXT REFERENCES accounts(user_id),
  semantic_hash TEXT NOT NULL,
  proof_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','applied','reconcile_required')),
  received_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX apple_notification_transaction ON apple_notification_inbox(transaction_key,state);

CREATE TABLE credit_lots (
  lot_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  transaction_key TEXT NOT NULL UNIQUE REFERENCES apple_transactions(transaction_key),
  snapshot_hash TEXT NOT NULL,
  granted_seconds INTEGER NOT NULL CHECK (granted_seconds > 0),
  available_seconds INTEGER NOT NULL CHECK (available_seconds >= 0),
  reserved_seconds INTEGER NOT NULL CHECK (reserved_seconds >= 0),
  consumed_seconds INTEGER NOT NULL CHECK (consumed_seconds >= 0),
  refunded_seconds INTEGER NOT NULL CHECK (refunded_seconds >= 0),
  created_ms INTEGER NOT NULL,
  CHECK (granted_seconds = available_seconds+reserved_seconds+consumed_seconds+refunded_seconds)
) STRICT;
CREATE INDEX credit_lots_spend ON credit_lots(user_id,created_ms,lot_id) WHERE available_seconds > 0;
CREATE INDEX credit_lots_owner ON credit_lots(user_id,lot_id);

CREATE TABLE public_sessions (
  session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  deployment_id TEXT NOT NULL,
  auth_token_hash TEXT NOT NULL REFERENCES account_tokens(token_hash),
  configuration_hash TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  authorization_epoch INTEGER NOT NULL CHECK (authorization_epoch > 0),
  capture_epoch INTEGER NOT NULL CHECK (capture_epoch >= 0),
  language_config_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','active','paused','disconnected','stopping','ended')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX public_sessions_owner ON public_sessions(owner_id,state,session_id);

CREATE TABLE credit_reservations (
  reservation_key TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  session_id TEXT NOT NULL UNIQUE REFERENCES public_sessions(session_id),
  state TEXT NOT NULL CHECK (state IN ('active','released','settled')),
  seconds INTEGER NOT NULL CHECK (seconds > 0),
  consumed_seconds INTEGER NOT NULL CHECK (consumed_seconds >= 0 AND consumed_seconds <= seconds),
  version INTEGER NOT NULL CHECK (version > 0),
  authorization_epoch INTEGER NOT NULL CHECK (authorization_epoch > 0),
  request_hash TEXT NOT NULL,
  note TEXT,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  released_ms INTEGER,
  settled_ms INTEGER
) STRICT;
-- Expiry never silently removes a risk hold from spendable-balance computation.
CREATE INDEX reservations_owner ON credit_reservations(user_id,state);

CREATE TABLE reservation_lot_allocations (
  reservation_key TEXT NOT NULL REFERENCES credit_reservations(reservation_key),
  lot_id TEXT NOT NULL REFERENCES credit_lots(lot_id),
  held_seconds INTEGER NOT NULL CHECK (held_seconds > 0),
  consumed_seconds INTEGER NOT NULL CHECK (consumed_seconds >= 0),
  released_seconds INTEGER NOT NULL CHECK (released_seconds >= 0),
  PRIMARY KEY (reservation_key,lot_id),
  CHECK (consumed_seconds+released_seconds <= held_seconds)
) STRICT;

CREATE TABLE credit_ledger (
  idempotency_key TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('purchase','usage','refund','refund_reversed')),
  delta_seconds INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  session_id TEXT,
  transaction_key TEXT,
  proof_ref TEXT NOT NULL,
  created_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX credit_ledger_owner ON credit_ledger(user_id,created_ms,idempotency_key);

CREATE TABLE trusted_finalizations (
  session_id TEXT PRIMARY KEY REFERENCES public_sessions(session_id),
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  binding_hash TEXT NOT NULL,
  active_ms INTEGER NOT NULL CHECK (active_ms >= 0),
  meter_basis TEXT NOT NULL CHECK (meter_basis = 'server_observed_active_ms'),
  meter_status TEXT NOT NULL CHECK (meter_status IN ('confirmed','reconcile_required')),
  provider_reconciliation TEXT NOT NULL CHECK (provider_reconciliation IN ('confirmed','reconcile_required')),
  stop_confirmed INTEGER NOT NULL CHECK (stop_confirmed IN (0,1)),
  content_receipt_ref TEXT NOT NULL,
  stop_watermark_hash TEXT NOT NULL,
  semantic_hash TEXT NOT NULL,
  proof_ref TEXT NOT NULL,
  observed_ms INTEGER NOT NULL
) STRICT;

-- A6/A7/A9 populate these through trusted internal adapters, not public JSON.
CREATE TABLE model_grants (
  grant_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public_sessions(session_id),
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  component TEXT NOT NULL CHECK (component IN ('asr','translation','tts')),
  configuration_hash TEXT NOT NULL,
  authorization_epoch INTEGER NOT NULL,
  writer_fence INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','issued','unknown','revoked','stopped')),
  version INTEGER NOT NULL CHECK (version > 0),
  result_ref TEXT
) STRICT;
CREATE INDEX model_grants_owner ON model_grants(owner_id,state,grant_id);

CREATE TABLE trusted_usage_inbox (
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES public_sessions(session_id),
  grant_id TEXT REFERENCES model_grants(grant_id),
  unit TEXT NOT NULL,
  cumulative_value INTEGER NOT NULL CHECK (cumulative_value >= 0),
  semantic_hash TEXT NOT NULL,
  proof_ref TEXT NOT NULL,
  observed_ms INTEGER NOT NULL,
  PRIMARY KEY (source,event_id)
) STRICT;
CREATE INDEX usage_inbox_session ON trusted_usage_inbox(session_id,source,observed_ms);

CREATE TABLE refund_events (
  event_id TEXT PRIMARY KEY,
  transaction_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund','refund_reversed')),
  semantic_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','applied','reconcile_required')),
  original_event_id TEXT,
  applied_seconds INTEGER NOT NULL DEFAULT 0 CHECK (applied_seconds >= 0),
  proof_ref TEXT NOT NULL,
  received_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX refund_events_transaction ON refund_events(transaction_key,state);

CREATE TABLE finance_outbox (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL CHECK (state IN ('pending','done','reconcile_required')),
  due_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
) STRICT;
CREATE INDEX finance_outbox_due ON finance_outbox(state,due_ms,event_id);

CREATE TABLE command_results (
  command_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  completed_ms INTEGER NOT NULL
) STRICT;

-- Both scratch tables are cleared inside the same atomic batch as their writes.
CREATE TABLE command_assertions (
  command_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1),
  PRIMARY KEY (command_id,check_id)
) STRICT;
CREATE TABLE command_lot_deltas (
  command_id TEXT NOT NULL,
  lot_id TEXT NOT NULL REFERENCES credit_lots(lot_id),
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  consumed_delta INTEGER NOT NULL DEFAULT 0,
  released_delta INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (command_id,lot_id)
) STRICT;
