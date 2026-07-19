import type { DatabaseSync } from "node:sqlite";
import type { AppStoreSnapshot } from "./json-store.js";
import type {
  InboxEventRecord,
  OutboxEventRecord,
} from "../../modules/events/event-record.js";

type EventNamespace = "inboxEvents" | "outboxEvents";

export class SqliteEventStore {
  constructor(private readonly db: DatabaseSync) {}

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_events (
        event_id TEXT PRIMARY KEY,
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_inbox_events_session
        ON inbox_events(session_id, processed_at);
      CREATE TABLE IF NOT EXISTS outbox_events (
        idempotency_key TEXT PRIMARY KEY,
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        available_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        payload TEXT NOT NULL,
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
        ON outbox_events(published_at, available_at, session_id);
    `);
  }

  readInto(snapshot: AppStoreSnapshot) {
    snapshot.inboxEvents = this.readPayloads("inbox_events", "processed_at");
    snapshot.outboxEvents = this.readPayloads("outbox_events", "created_at");
  }

  readEntity(namespace: string, key: string) {
    const table = tableFor(namespace);
    if (!table) return { handled: false as const };
    const row = this.db.prepare(
      `SELECT payload FROM ${table.name} WHERE ${table.key} = ?`,
    ).get(key) as { payload: string } | undefined;
    return { handled: true as const, value: row?.payload };
  }

  writeEntity(namespace: string, key: string, valueJson: string) {
    if (namespace === "inboxEvents") {
      this.writeInbox(key, JSON.parse(valueJson) as InboxEventRecord, valueJson);
      return true;
    }
    if (namespace === "outboxEvents") {
      this.writeOutbox(key, JSON.parse(valueJson) as OutboxEventRecord, valueJson);
      return true;
    }
    return false;
  }

  deleteEntity(namespace: string, key: string) {
    const table = tableFor(namespace);
    if (!table) return false;
    this.db.prepare(`DELETE FROM ${table.name} WHERE ${table.key} = ?`).run(key);
    return true;
  }

  private readPayloads(table: string, orderColumn: string) {
    return this.db.prepare(
      `SELECT payload FROM ${table} ORDER BY ${orderColumn}`,
    ).all().map((row) => JSON.parse((row as { payload: string }).payload));
  }

  private writeInbox(key: string, record: InboxEventRecord, payload: string) {
    this.db.prepare(`
      INSERT INTO inbox_events(
        event_id, session_id, event_type, payload_hash, processed_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET payload = excluded.payload
    `).run(
      key,
      record.sessionId,
      record.eventType,
      record.payloadHash,
      record.processedAt,
      payload,
    );
  }

  private writeOutbox(key: string, record: OutboxEventRecord, payload: string) {
    this.db.prepare(`
      INSERT INTO outbox_events(
        idempotency_key, session_id, event_type, attempts,
        available_at, created_at, published_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        attempts = excluded.attempts,
        available_at = excluded.available_at,
        published_at = excluded.published_at,
        payload = excluded.payload
    `).run(
      key,
      record.sessionId,
      record.eventType,
      record.attempts,
      record.availableAt,
      record.createdAt,
      record.publishedAt ?? null,
      payload,
    );
  }
}

function tableFor(namespace: string) {
  const tables: Record<EventNamespace, { name: string; key: string }> = {
    inboxEvents: { name: "inbox_events", key: "event_id" },
    outboxEvents: { name: "outbox_events", key: "idempotency_key" },
  };
  return tables[namespace as EventNamespace];
}
