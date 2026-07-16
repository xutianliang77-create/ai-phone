import type { DatabaseSync } from "node:sqlite";
import type {
  EnterpriseInboxEventRecord,
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";
import type { AppStoreSnapshot } from "./json-store.js";

type EnterpriseEventNamespace =
  | "enterpriseInboxEvents"
  | "enterpriseOutboxEvents";

export class EnterpriseEventAppendOnlyStorageError extends Error {
  constructor() {
    super("Enterprise inbox events are append-only");
    this.name = "EnterpriseEventAppendOnlyStorageError";
  }
}

export class EnterpriseOutboxImmutableStorageError extends Error {
  constructor() {
    super("Enterprise outbox event delivery content is immutable");
    this.name = "EnterpriseOutboxImmutableStorageError";
  }
}

export class SqliteEnterpriseEventStore {
  constructor(private readonly db: DatabaseSync) {}

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enterprise_inbox_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE (tenant_id, source, source_event_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS enterprise_inbox_events_tenant_processed_idx
        ON enterprise_inbox_events(tenant_id, processed_at, id);
      CREATE TRIGGER IF NOT EXISTS enterprise_inbox_events_no_update
      BEFORE UPDATE ON enterprise_inbox_events
      BEGIN
        SELECT RAISE(ABORT, 'enterprise inbox events are append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS enterprise_inbox_events_no_delete
      BEFORE DELETE ON enterprise_inbox_events
      BEGIN
        SELECT RAISE(ABORT, 'enterprise inbox events are append-only');
      END;

      CREATE TABLE IF NOT EXISTS enterprise_outbox_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        available_at TEXT NOT NULL,
        lease_expires_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        published_at TEXT,
        payload TEXT NOT NULL,
        UNIQUE (tenant_id, idempotency_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS enterprise_outbox_events_tenant_recovery_idx
        ON enterprise_outbox_events(
          tenant_id, published_at, available_at, lease_expires_at, created_at, id
        );
      CREATE TRIGGER IF NOT EXISTS enterprise_outbox_events_no_delete
      BEFORE DELETE ON enterprise_outbox_events
      BEGIN
        SELECT RAISE(ABORT, 'enterprise outbox events cannot be deleted');
      END;
    `);
  }

  readInto(snapshot: AppStoreSnapshot) {
    snapshot.enterpriseInboxEvents = this.readPayloads(
      "enterprise_inbox_events",
      "received_at, id",
    );
    snapshot.enterpriseOutboxEvents = this.readPayloads(
      "enterprise_outbox_events",
      "created_at, id",
    );
  }

  readEntity(namespace: string, key: string) {
    const table = tableFor(namespace);
    if (!table) return { handled: false as const };
    const row = this.db.prepare(
      `SELECT payload FROM ${table} WHERE id = ?`,
    ).get(key) as { payload: string } | undefined;
    return { handled: true as const, value: row?.payload };
  }

  writeEntity(namespace: string, valueJson: string) {
    if (namespace === "enterpriseInboxEvents") {
      this.writeInbox(
        JSON.parse(valueJson) as EnterpriseInboxEventRecord,
        valueJson,
      );
      return true;
    }
    if (namespace === "enterpriseOutboxEvents") {
      this.writeOutbox(
        JSON.parse(valueJson) as EnterpriseOutboxEventRecord,
        valueJson,
      );
      return true;
    }
    return false;
  }

  deleteEntity(namespace: string) {
    if (namespace === "enterpriseInboxEvents") {
      throw new EnterpriseEventAppendOnlyStorageError();
    }
    if (namespace === "enterpriseOutboxEvents") {
      throw new Error("Enterprise outbox events cannot be deleted");
    }
    return false;
  }

  private readPayloads(table: string, order: string) {
    return this.db.prepare(
      `SELECT payload FROM ${table} ORDER BY ${order}`,
    ).all().map((row) => JSON.parse((row as { payload: string }).payload));
  }

  private writeInbox(record: EnterpriseInboxEventRecord, payload: string) {
    const existing = this.db.prepare(
      "SELECT 1 FROM enterprise_inbox_events WHERE id = ?",
    ).get(record.id);
    if (existing) throw new EnterpriseEventAppendOnlyStorageError();
    this.db.prepare(`
      INSERT INTO enterprise_inbox_events(
        id, tenant_id, source, source_event_id, event_type, payload_hash,
        received_at, processed_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.tenantId,
      record.source,
      record.sourceEventId,
      record.eventType,
      record.payloadHash,
      record.receivedAt,
      record.processedAt,
      payload,
    );
  }

  private writeOutbox(record: EnterpriseOutboxEventRecord, payload: string) {
    const existingRow = this.db.prepare(
      "SELECT payload FROM enterprise_outbox_events WHERE id = ?",
    ).get(record.id) as { payload: string } | undefined;
    if (existingRow) {
      const existing = JSON.parse(
        existingRow.payload,
      ) as EnterpriseOutboxEventRecord;
      if (!sameOutboxContent(existing, record)) {
        throw new EnterpriseOutboxImmutableStorageError();
      }
    }
    this.db.prepare(`
      INSERT INTO enterprise_outbox_events(
        id, tenant_id, aggregate_type, aggregate_id, event_type,
        idempotency_key, attempts, available_at, lease_expires_at,
        last_error_code, created_at, published_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attempts = excluded.attempts,
        available_at = excluded.available_at,
        lease_expires_at = excluded.lease_expires_at,
        last_error_code = excluded.last_error_code,
        published_at = excluded.published_at,
        payload = excluded.payload
    `).run(
      record.id,
      record.tenantId,
      record.aggregateType,
      record.aggregateId,
      record.eventType,
      record.idempotencyKey,
      record.attempts,
      record.availableAt,
      record.leaseExpiresAt ?? null,
      record.lastErrorCode ?? null,
      record.createdAt,
      record.publishedAt ?? null,
      payload,
    );
  }
}

function tableFor(namespace: string) {
  const tables: Record<EnterpriseEventNamespace, string> = {
    enterpriseInboxEvents: "enterprise_inbox_events",
    enterpriseOutboxEvents: "enterprise_outbox_events",
  };
  return tables[namespace as EnterpriseEventNamespace];
}

function sameOutboxContent(
  existing: EnterpriseOutboxEventRecord,
  incoming: EnterpriseOutboxEventRecord,
) {
  return existing.tenantId === incoming.tenantId &&
    existing.aggregateType === incoming.aggregateType &&
    existing.aggregateId === incoming.aggregateId &&
    existing.eventType === incoming.eventType &&
    existing.idempotencyKey === incoming.idempotencyKey &&
    existing.traceId === incoming.traceId &&
    existing.createdAt === incoming.createdAt &&
    JSON.stringify(existing.payload) === JSON.stringify(incoming.payload);
}
