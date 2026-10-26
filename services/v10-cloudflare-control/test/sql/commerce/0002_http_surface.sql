-- A4 additive HTTP/permission/consent surface. Not applied in this batch.
-- Financial core version stays 1; this independent surface is checked explicitly.
CREATE TABLE commerce_http_schema (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL CHECK(version>0)
) STRICT;
INSERT INTO commerce_http_schema VALUES(1,1);
CREATE TABLE account_consents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(user_id),
  consent_type TEXT NOT NULL CHECK(consent_type IN ('initial_privacy','voice_processing','call_record','agent_authorize')),
  version TEXT NOT NULL,
  scene TEXT,
  accepted_ms INTEGER NOT NULL,
  recorded_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  locale TEXT
) STRICT;
CREATE INDEX account_consents_owner ON account_consents(owner_id,recorded_ms,id);
CREATE TABLE management_audit (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  recorded_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX management_audit_actor ON management_audit(actor_id,recorded_ms,event_id);
