-- Source-only migration. Apply only after deployment approval.
CREATE TABLE device_permit_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=1));
INSERT INTO device_permit_schema VALUES(1,1);
CREATE TABLE device_permit_keys(
  device_key_hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  device_public_key TEXT NOT NULL,app_attest_key_id TEXT NOT NULL UNIQUE,
  attest_public_key TEXT NOT NULL,attest_receipt TEXT NOT NULL,counter INTEGER NOT NULL CHECK(counter>=0),
  created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL
);
CREATE TABLE device_permit_challenges(
  challenge_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  device_key_hash TEXT NOT NULL,nonce TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,
  consumed_ms INTEGER
);
CREATE INDEX device_permit_challenge_owner ON device_permit_challenges(owner_id,expires_ms);
CREATE TABLE device_permits(
  lease_id TEXT PRIMARY KEY REFERENCES public_sessions(session_id),owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  device_key_hash TEXT NOT NULL,launch_nonce TEXT NOT NULL,source_language TEXT NOT NULL,target_language TEXT NOT NULL,
  authorization_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,issued_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,
  max_seconds INTEGER NOT NULL CHECK(max_seconds>0 AND max_seconds<=86400),
  consumed_checkpoint_ms INTEGER NOT NULL DEFAULT 0,checkpoint_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','ended','reconcile_required')),
  CHECK(source_language IN ('zh','en') AND target_language IN ('zh','en') AND source_language<>target_language)
);
CREATE INDEX device_permit_owner ON device_permits(owner_id,state,expires_ms);
CREATE TABLE device_permit_owner_claims(owner_id TEXT PRIMARY KEY REFERENCES accounts(user_id),lease_id TEXT NOT NULL);
CREATE TABLE device_permit_issues(
  operation_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,device_key_hash TEXT NOT NULL,data_hash TEXT NOT NULL,
  lease_id TEXT NOT NULL,revision INTEGER NOT NULL,signed_permit TEXT NOT NULL,created_ms INTEGER NOT NULL
);
CREATE TABLE device_permit_cancellations(
  operation_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,device_key_hash TEXT NOT NULL,data_hash TEXT NOT NULL,cancelled_ms INTEGER NOT NULL
);
CREATE TABLE device_usage_receipts(
  session_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,binding_hash TEXT NOT NULL,active_ms INTEGER NOT NULL,
  meter_basis TEXT NOT NULL CHECK(meter_basis='attested_device_reported_active_ms'),
  meter_status TEXT NOT NULL CHECK(meter_status IN ('device_reported','reconcile_required')),
  stop_confirmed INTEGER NOT NULL CHECK(stop_confirmed=1),provider_reconciliation TEXT NOT NULL,
  content_receipt_ref TEXT NOT NULL,stop_watermark_hash TEXT NOT NULL,semantic_hash TEXT NOT NULL,
  proof_ref TEXT NOT NULL,observed_ms INTEGER NOT NULL
);
