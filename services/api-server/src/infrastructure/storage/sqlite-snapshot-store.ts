import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type { AppStoreSnapshot } from "./json-store.js";

interface CollectionSpec {
  namespace: keyof AppStoreSnapshot;
  key: (record: Record<string, unknown>) => string;
}

const collectionSpecs: CollectionSpec[] = [
  spec("sessions", "id"),
  spec("accounts", "id"),
  spec("authSessions", "token"),
  spec("smsOtpChallenges", "id"),
  spec("accountConsentRecords", "id"),
  spec("usageHolds", "id"),
  spec("paymentOrders", "id"),
  spec("billingLedger", "id"),
  spec("appleServerNotifications", "notificationUUID"),
  spec("appErrorReports", "id"),
  spec("termbaseTerms", "id"),
  spec("agentCallDrafts", "id"),
  spec("voiceProfiles", "id"),
];

const mapNamespaces: (keyof AppStoreSnapshot)[] = [
  "usageBalances",
  "usagePlanCodes",
  "entitlementPlanCodes",
  "entitlementOrderIds",
];

export class StorageConflictError extends Error {
  constructor(namespace: string, key: string) {
    super(`Concurrent storage update detected for ${namespace}/${key}`);
    this.name = "StorageConflictError";
  }
}

export class SqliteSnapshotStore {
  private readonly db: DatabaseSync;
  private baseline: AppStoreSnapshot;

  constructor(
    file: string,
    private readonly emptySnapshot: AppStoreSnapshot,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
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
    const current = flatten(snapshot);
    const baseline = flatten(this.baseline);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const compoundKey of new Set([...current.keys(), ...baseline.keys()])) {
        const next = current.get(compoundKey);
        const previous = baseline.get(compoundKey);
        if (next === previous) continue;
        const [namespace, key] = splitCompoundKey(compoundKey);
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
      "SELECT COUNT(*) AS count FROM app_records",
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
      CREATE TABLE IF NOT EXISTS session_segments (
        session_namespace TEXT NOT NULL DEFAULT 'sessions'
          CHECK (session_namespace = 'sessions'),
        session_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, segment_id),
        UNIQUE (session_id, position),
        FOREIGN KEY (session_namespace, session_id)
          REFERENCES app_records(namespace, record_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_session_segments_order
        ON session_segments(session_id, position);
    `);
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
      assignRecord(snapshot, row.namespace, row.record_key, value);
    }
    return snapshot;
  }

  private readEntity(namespace: string, key: string) {
    const row = this.db.prepare(
      "SELECT payload FROM app_records WHERE namespace = ? AND record_key = ?",
    ).get(namespace, key) as { payload: string } | undefined;
    if (!row) return undefined;
    const value = namespace === "sessions"
      ? this.readSession(key, row.payload)
      : JSON.parse(row.payload);
    return JSON.stringify(value);
  }

  private readSession(sessionId: string, metadataJson: string): SessionRecord {
    const metadata = JSON.parse(metadataJson) as Omit<SessionRecord, "segments">;
    const segmentRows = this.db.prepare(
      "SELECT payload FROM session_segments WHERE session_id = ? ORDER BY position",
    ).all(sessionId) as { payload: string }[];
    return {
      ...metadata,
      segments: segmentRows.map((row) => JSON.parse(row.payload)),
    };
  }

  private writeEntity(namespace: string, key: string, valueJson: string) {
    const value = JSON.parse(valueJson);
    const payload = namespace === "sessions"
      ? JSON.stringify(withoutSegments(value as SessionRecord))
      : valueJson;
    this.db.prepare(`
      INSERT INTO app_records(namespace, record_key, payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, record_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(namespace, key, payload, new Date().toISOString());
    if (namespace === "sessions") this.writeSegments(value as SessionRecord);
  }

  private writeSegments(session: SessionRecord) {
    this.db.prepare("DELETE FROM session_segments WHERE session_id = ?")
      .run(session.id);
    const insert = this.db.prepare(`
      INSERT INTO session_segments(session_id, segment_id, position, payload)
      VALUES (?, ?, ?, ?)
    `);
    session.segments.forEach((segment, position) => {
      insert.run(session.id, segment.id, position, JSON.stringify(segment));
    });
  }

  private deleteEntity(namespace: string, key: string) {
    this.db.prepare(
      "DELETE FROM app_records WHERE namespace = ? AND record_key = ?",
    ).run(namespace, key);
  }
}

function spec(namespace: keyof AppStoreSnapshot, keyField: string): CollectionSpec {
  return {
    namespace,
    key: (record) => String(record[keyField]),
  };
}

function flatten(snapshot: AppStoreSnapshot) {
  const records = new Map<string, string>();
  for (const spec of collectionSpecs) {
    const values = snapshot[spec.namespace] as unknown[];
    for (const value of values) {
      const key = spec.key(value as Record<string, unknown>);
      records.set(compoundKey(String(spec.namespace), key), JSON.stringify(value));
    }
  }
  for (const namespace of mapNamespaces) {
    const values = snapshot[namespace] as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      records.set(compoundKey(String(namespace), key), JSON.stringify(value));
    }
  }
  return records;
}

function assignRecord(
  snapshot: AppStoreSnapshot,
  namespace: string,
  key: string,
  value: unknown,
) {
  if (mapNamespaces.includes(namespace as keyof AppStoreSnapshot)) {
    (snapshot[namespace as keyof AppStoreSnapshot] as Record<string, unknown>)[key] = value;
    return;
  }
  const spec = collectionSpecs.find((item) => item.namespace === namespace);
  if (spec) (snapshot[spec.namespace] as unknown[]).push(value);
}

function withoutSegments(session: SessionRecord) {
  const { segments: _segments, ...metadata } = session;
  return metadata;
}

function compoundKey(namespace: string, key: string) {
  return `${namespace}\u0000${key}`;
}

function splitCompoundKey(value: string) {
  const separator = value.indexOf("\u0000");
  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}
