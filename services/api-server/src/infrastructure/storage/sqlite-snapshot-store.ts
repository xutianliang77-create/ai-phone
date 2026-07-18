import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type { AppStoreSnapshot } from "./json-store.js";
import { SqliteEventStore } from "./sqlite-event-store.js";
import { SqliteAuditStore } from "./sqlite-audit-store.js";
import {
  SqliteEnterpriseEventStore,
} from "./sqlite-enterprise-event-store.js";
import { SqliteSessionChildrenStore } from "./sqlite-session-children-store.js";
import {
  assignSnapshotRecord,
  deletionPriority,
  flattenSnapshot,
  splitSnapshotCompoundKey,
  stableSnapshotJson,
  withoutSessionCollections,
} from "./sqlite-snapshot-shape.js";

export class StorageConflictError extends Error {
  constructor(namespace: string, key: string) {
    super(`Concurrent storage update detected for ${namespace}/${key}`);
    this.name = "StorageConflictError";
  }
}

export class SqliteSnapshotStore {
  private readonly db: DatabaseSync;
  private readonly eventStore: SqliteEventStore;
  private readonly auditStore: SqliteAuditStore;
  private readonly enterpriseEventStore: SqliteEnterpriseEventStore;
  private readonly sessionChildren: SqliteSessionChildrenStore;
  private baseline: AppStoreSnapshot;

  constructor(
    file: string,
    private readonly emptySnapshot: AppStoreSnapshot,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.eventStore = new SqliteEventStore(this.db);
    this.auditStore = new SqliteAuditStore(this.db);
    this.enterpriseEventStore = new SqliteEnterpriseEventStore(this.db);
    this.sessionChildren = new SqliteSessionChildrenStore(this.db);
    this.configure();
    this.createSchema();
    this.baseline = this.readDatabase();
  }

  read() {
    const snapshot = this.readDatabase();
    this.baseline = structuredClone(snapshot);
    return snapshot;
  }

  save(snapshot: AppStoreSnapshot) {
    const current = flattenSnapshot(snapshot);
    const baseline = flattenSnapshot(this.baseline);
    const changes = [...new Set([...current.keys(), ...baseline.keys()])]
      .filter((key) => current.get(key) !== baseline.get(key))
      .sort((left, right) => deletionPriority(left, current) -
        deletionPriority(right, current));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const compoundKey of changes) {
        const next = current.get(compoundKey);
        const previous = baseline.get(compoundKey);
        const [namespace, key] = splitSnapshotCompoundKey(compoundKey);
        const stored = this.readEntity(namespace, key);
        if (stored !== previous) throw new StorageConflictError(namespace, key);
        if (next === undefined) {
          this.deleteEntity(namespace, key);
        } else {
          this.writeEntity(namespace, key, next);
        }
      }
      this.db.exec("COMMIT");
      this.baseline = structuredClone(snapshot);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  isEmpty() {
    const row = this.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM app_records) +
        (SELECT COUNT(*) FROM enterprise_audit_events) +
        (SELECT COUNT(*) FROM enterprise_inbox_events) +
        (SELECT COUNT(*) FROM enterprise_outbox_events) AS count`,
    ).get() as { count: number };
    return Number(row.count) === 0;
  }

  close() {
    this.db.close();
  }

  quickCheck() {
    const row = this.db.prepare("PRAGMA quick_check").get() as {
      quick_check: string;
    };
    return row.quick_check;
  }

  journalMode() {
    const row = this.db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    return row.journal_mode;
  }

  async backupTo(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    await backup(this.db, file);
  }

  private configure() {
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec("PRAGMA busy_timeout=5000");
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_records (
        namespace TEXT NOT NULL,
        record_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, record_key)
      ) STRICT;
    `);
    this.sessionChildren.createSchema();
    this.eventStore.createSchema();
    this.auditStore.createSchema();
    this.enterpriseEventStore.createSchema();
  }

  private readDatabase() {
    const snapshot = structuredClone(this.emptySnapshot);
    const rows = this.db.prepare(
      "SELECT namespace, record_key, payload FROM app_records ORDER BY namespace, record_key",
    ).all() as { namespace: string; record_key: string; payload: string }[];
    for (const row of rows) {
      const value = row.namespace === "sessions"
        ? this.readSession(row.record_key, row.payload)
        : JSON.parse(row.payload);
      assignSnapshotRecord(snapshot, row.namespace, row.record_key, value);
    }
    this.eventStore.readInto(snapshot);
    this.auditStore.readInto(snapshot);
    this.enterpriseEventStore.readInto(snapshot);
    return snapshot;
  }

  private readEntity(namespace: string, key: string) {
    const audit = this.auditStore.readEntity(namespace, key);
    if (audit.handled) {
      return audit.value === undefined
        ? undefined
        : stableSnapshotJson(JSON.parse(audit.value));
    }
    const event = this.eventStore.readEntity(namespace, key);
    if (event.handled) {
      return event.value === undefined
        ? undefined
        : stableSnapshotJson(JSON.parse(event.value));
    }
    const enterpriseEvent = this.enterpriseEventStore.readEntity(namespace, key);
    if (enterpriseEvent.handled) {
      return enterpriseEvent.value === undefined
        ? undefined
        : stableSnapshotJson(JSON.parse(enterpriseEvent.value));
    }
    const row = this.db.prepare(
      "SELECT payload FROM app_records WHERE namespace = ? AND record_key = ?",
    ).get(namespace, key) as { payload: string } | undefined;
    if (!row) return undefined;
    const value = namespace === "sessions"
      ? this.readSession(key, row.payload)
      : JSON.parse(row.payload);
    return stableSnapshotJson(value);
  }

  private readSession(sessionId: string, metadataJson: string): SessionRecord {
    const metadata = JSON.parse(metadataJson) as Omit<
      SessionRecord,
      "segments" | "callLegs" | "playbacks"
    >;
    return {
      ...metadata,
      ...this.sessionChildren.read(sessionId),
    };
  }

  private writeEntity(namespace: string, key: string, valueJson: string) {
    if (this.auditStore.writeEntity(namespace, valueJson)) return;
    if (this.eventStore.writeEntity(namespace, key, valueJson)) return;
    if (this.enterpriseEventStore.writeEntity(namespace, valueJson)) return;
    const value = JSON.parse(valueJson);
    const payload = namespace === "sessions"
      ? JSON.stringify(withoutSessionCollections(value as SessionRecord))
      : valueJson;
    this.db.prepare(`
      INSERT INTO app_records(namespace, record_key, payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, record_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(namespace, key, payload, new Date().toISOString());
    if (namespace === "sessions") {
      this.sessionChildren.write(value as SessionRecord);
    }
  }

  private deleteEntity(namespace: string, key: string) {
    if (this.auditStore.deleteEntity(namespace)) return;
    if (this.eventStore.deleteEntity(namespace, key)) return;
    if (this.enterpriseEventStore.deleteEntity(namespace)) return;
    this.db.prepare(
      "DELETE FROM app_records WHERE namespace = ? AND record_key = ?",
    ).run(namespace, key);
  }
}
