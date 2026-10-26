-- Independent phone-only control. No model, content or per-minute credit grant.
CREATE TABLE v10_subscription_chains (
 chain_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(user_id),
 product_id TEXT NOT NULL,bundle_id TEXT NOT NULL,environment TEXT NOT NULL,original_transaction_id TEXT NOT NULL,
 created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE v10_subscription_status (
 chain_key TEXT PRIMARY KEY REFERENCES v10_subscription_chains(chain_key),owner_id TEXT NOT NULL,
 verified_ms INTEGER NOT NULL,signed_ms INTEGER NOT NULL,status INTEGER NOT NULL,
 auto_renew INTEGER,billing_retry INTEGER,grace_expires_ms INTEGER,payload_hash TEXT NOT NULL
) STRICT;
CREATE TABLE v10_subscription_transactions (
 transaction_key TEXT PRIMARY KEY,chain_key TEXT NOT NULL REFERENCES v10_subscription_chains(chain_key),
 owner_id TEXT NOT NULL REFERENCES accounts(user_id),product_id TEXT NOT NULL,environment TEXT NOT NULL,
 app_account_token TEXT,period_kind TEXT NOT NULL CHECK(period_kind IN ('trial','paid')),
 starts_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,signed_ms INTEGER NOT NULL,revoked_ms INTEGER,
 price_milli INTEGER NOT NULL,currency TEXT NOT NULL,payload_hash TEXT NOT NULL,
 CHECK(expires_ms>starts_ms)
) STRICT;
CREATE INDEX v10_subscriptions_owner ON v10_subscription_transactions(owner_id,expires_ms);
CREATE TABLE v10_subscription_events (
 event_key TEXT PRIMARY KEY,owner_id TEXT,transaction_key TEXT NOT NULL,
 event_type TEXT NOT NULL,payload_hash TEXT NOT NULL,recorded_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE v10_subscription_notification_inbox (
 notification_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,transaction_json TEXT NOT NULL,
 event_type TEXT NOT NULL,chain_key TEXT NOT NULL,recorded_ms INTEGER NOT NULL,processed_ms INTEGER
) STRICT;
CREATE TABLE v10_device_licenses (
 lease_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(user_id),device_key_hash TEXT NOT NULL,
 launch_nonce TEXT NOT NULL,profile TEXT NOT NULL,resource_hash TEXT NOT NULL,source_language TEXT NOT NULL,target_language TEXT NOT NULL,
 sequence INTEGER NOT NULL,starts_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,
 entitlement_key TEXT NOT NULL,entitlement_revision TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','closed')),
 created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX v10_device_license_device ON v10_device_licenses(owner_id,device_key_hash,expires_ms);
CREATE TABLE v10_device_license_requests (
 request_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,request_hash TEXT NOT NULL,
 lease_id TEXT NOT NULL,receipt_json TEXT NOT NULL,created_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE v10_device_statistics (
 lease_id TEXT NOT NULL REFERENCES v10_device_licenses(lease_id),owner_id TEXT NOT NULL,
 sequence INTEGER NOT NULL,active_ms INTEGER NOT NULL,receipt_hash TEXT NOT NULL,updated_ms INTEGER NOT NULL,
 PRIMARY KEY(lease_id,sequence)
) STRICT;
CREATE TABLE v10_device_license_cancellations (
 request_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,request_hash TEXT NOT NULL,created_ms INTEGER NOT NULL
) STRICT;
