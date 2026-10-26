-- A11 source only. No deployment, budget approval, automatic refund or data deletion.
CREATE TABLE maintenance_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL) STRICT;
INSERT INTO maintenance_schema VALUES(1,1);
CREATE TABLE outbox_delivery(event_id TEXT PRIMARY KEY REFERENCES finance_outbox(event_id),state TEXT NOT NULL CHECK(state IN ('pending','running','done','dead')),
 version INTEGER NOT NULL CHECK(version>0),lease_until_ms INTEGER,reason TEXT,updated_ms INTEGER NOT NULL) STRICT;
CREATE INDEX outbox_delivery_due ON outbox_delivery(state,lease_until_ms);
CREATE TABLE recovery_control(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('blocked','ready')),
 recovery_id TEXT,inventory_hash TEXT,proof_json TEXT,updated_ms INTEGER NOT NULL) STRICT;
INSERT INTO recovery_control VALUES(1,0,'blocked',NULL,NULL,NULL,0);
CREATE TABLE recovery_do_progress(recovery_id TEXT PRIMARY KEY,cursor TEXT NOT NULL,chain_hash TEXT NOT NULL,count INTEGER NOT NULL,complete INTEGER NOT NULL CHECK(complete IN(0,1))) STRICT;
CREATE TABLE recovery_manifests(recovery_id TEXT PRIMARY KEY,manifest_hash TEXT NOT NULL,manifest_json TEXT NOT NULL) STRICT;
CREATE TABLE recovery_page_checks(recovery_id TEXT NOT NULL,page_id TEXT NOT NULL,plaintext_hash TEXT NOT NULL,PRIMARY KEY(recovery_id,page_id)) STRICT;
