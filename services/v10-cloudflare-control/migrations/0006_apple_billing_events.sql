-- A9 source migration only; not applied by code import or development checks.
CREATE TABLE billing_event_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=1));
INSERT INTO billing_event_schema VALUES(1,1);
ALTER TABLE refund_events ADD COLUMN owner_id TEXT;
ALTER TABLE refund_events ADD COLUMN related_lot_id TEXT;
ALTER TABLE refund_events ADD COLUMN requested_seconds INTEGER;
ALTER TABLE refund_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE refund_events ADD COLUMN updated_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refund_events ADD COLUMN reversed_seconds INTEGER NOT NULL DEFAULT 0 CHECK(reversed_seconds>=0);
ALTER TABLE credit_lots ADD COLUMN refund_event_id TEXT;
ALTER TABLE credit_lots ADD COLUMN refund_blocked INTEGER NOT NULL DEFAULT 0 CHECK(refund_blocked IN(0,1));
ALTER TABLE command_lot_deltas ADD COLUMN refund_delta INTEGER NOT NULL DEFAULT 0 CHECK(refund_delta>=0);
CREATE TABLE apple_refund_state(
 transaction_key TEXT PRIMARY KEY,environment TEXT NOT NULL,bundle_id TEXT NOT NULL,transaction_id TEXT NOT NULL,
 owner_id TEXT,current_event_id TEXT NOT NULL,revoked INTEGER NOT NULL CHECK(revoked IN(0,1)),target_seconds INTEGER,
 version INTEGER NOT NULL CHECK(version>0),last_verified_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX apple_refund_original_reversal ON refund_events(original_event_id) WHERE kind='refund_reversed' AND state='applied';
ALTER TABLE apple_notification_inbox ADD COLUMN event_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE apple_notification_inbox ADD COLUMN sealed_jws TEXT;
ALTER TABLE apple_notification_inbox ADD COLUMN raw_jws_hash TEXT;
ALTER TABLE apple_notification_inbox ADD COLUMN reason_code TEXT;
ALTER TABLE apple_notification_inbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE apple_notification_inbox ADD COLUMN next_retry_ms INTEGER;
ALTER TABLE apple_notification_inbox ADD COLUMN updated_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE apple_notification_inbox ADD COLUMN outcome TEXT;
CREATE TABLE apple_transaction_evidence(
 transaction_key TEXT PRIMARY KEY,owner_id TEXT,environment TEXT NOT NULL,bundle_id TEXT NOT NULL,transaction_id TEXT NOT NULL,
 normalized_json TEXT NOT NULL,proof_ref TEXT NOT NULL,sealed_jws TEXT NOT NULL,raw_jws_hash TEXT NOT NULL,
 signed_ms INTEGER NOT NULL,verified_ms INTEGER NOT NULL,version INTEGER NOT NULL
);
CREATE TABLE apple_billing_actions(
 action_id TEXT PRIMARY KEY,notification_uuid TEXT,owner_id TEXT,transaction_key TEXT NOT NULL,kind TEXT NOT NULL,
 semantic_hash TEXT NOT NULL,sealed_action TEXT NOT NULL,verification_ref TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('prepared','applied','reconcile_required')),receipt_json TEXT,
 created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL
);
CREATE INDEX apple_billing_actions_transaction ON apple_billing_actions(transaction_key,state);
CREATE TABLE apple_consumption_consents(
 owner_id TEXT PRIMARY KEY REFERENCES accounts(user_id),consent_version TEXT NOT NULL,allowed INTEGER NOT NULL CHECK(allowed IN(0,1)),
 revision INTEGER NOT NULL CHECK(revision>0),accepted_ms INTEGER NOT NULL,source TEXT NOT NULL
);
CREATE TABLE apple_consumption_reports(
 report_id TEXT PRIMARY KEY,notification_uuid TEXT NOT NULL,transaction_key TEXT NOT NULL,owner_id TEXT NOT NULL,
 consent_revision INTEGER NOT NULL,report_json TEXT NOT NULL,report_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('prepared','sending','confirmed','unknown','cancelled','expired')),
 created_ms INTEGER NOT NULL,deadline_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,version INTEGER NOT NULL,
 UNIQUE(notification_uuid,transaction_key)
);
CREATE TABLE billing_cases(
 case_id TEXT PRIMARY KEY,support_id TEXT NOT NULL UNIQUE,owner_id TEXT,kind TEXT NOT NULL,reason_code TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('open','retry_pending','resolved','acknowledged')),version INTEGER NOT NULL,
 session_id TEXT,order_id TEXT,transaction_key TEXT,transaction_id TEXT,risk_held_seconds INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,next_retry_ms INTEGER,last_progress_ms INTEGER NOT NULL,
 source_ref TEXT NOT NULL,context_json TEXT NOT NULL DEFAULT '{}',created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL
);
CREATE INDEX billing_cases_owner ON billing_cases(owner_id,state,created_ms,case_id);
CREATE TABLE billing_case_actions(
 action_id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES billing_cases(case_id),actor_id TEXT NOT NULL,
 operation TEXT NOT NULL,reason TEXT NOT NULL,request_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,created_ms INTEGER NOT NULL
);
CREATE TABLE billing_usage_compensations(
 compensation_id TEXT PRIMARY KEY,case_id TEXT NOT NULL,session_id TEXT NOT NULL,owner_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,seconds INTEGER NOT NULL CHECK(seconds>0),reason TEXT NOT NULL,source_ref TEXT NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE TABLE billing_compensation_lots(
 compensation_id TEXT NOT NULL REFERENCES billing_usage_compensations(compensation_id),lot_id TEXT NOT NULL REFERENCES credit_lots(lot_id),
 seconds INTEGER NOT NULL CHECK(seconds>0),PRIMARY KEY(compensation_id,lot_id)
);
-- Append-only compensation belongs in the SAME existing ledger, not a fake
-- Apple transaction or a second balance. Preserve every prior ledger row.
CREATE TABLE credit_ledger_v2(
 idempotency_key TEXT PRIMARY KEY,command_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES accounts(user_id),
 kind TEXT NOT NULL CHECK(kind IN('purchase','usage','refund','refund_reversed','compensation')),
 delta_seconds INTEGER NOT NULL,balance_after INTEGER NOT NULL CHECK(balance_after>=0),session_id TEXT,
 transaction_key TEXT,proof_ref TEXT NOT NULL,created_ms INTEGER NOT NULL
);
INSERT INTO credit_ledger_v2 SELECT idempotency_key,command_id,user_id,kind,delta_seconds,balance_after,session_id,transaction_key,proof_ref,created_ms FROM credit_ledger;
DROP TABLE credit_ledger;
ALTER TABLE credit_ledger_v2 RENAME TO credit_ledger;
CREATE INDEX credit_ledger_owner ON credit_ledger(user_id,created_ms,idempotency_key);
