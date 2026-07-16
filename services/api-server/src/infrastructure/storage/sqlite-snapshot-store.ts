import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type { AppStoreSnapshot } from "./json-store.js";
import { SqliteEventStore } from "./sqlite-event-store.js";
import { SqliteSessionChildrenStore } from "./sqlite-session-children-store.js";

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
  spec("voiceIdentities", "id"),
  spec("enterpriseTenants", "id"),
  spec("enterpriseMembers", "id"),
  spec("enterpriseTenantJobs", "id"),
  spec("inboxEvents", "eventId"),
  spec("outboxEvents", "idempotencyKey"),
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
  private readonly eventStore: SqliteEventStore;
  private readonly sessionChildren: SqliteSessionChildrenStore;
  private baseline: AppStoreSnapshot;

  constructor(
    file: string,
    private readonly emptySnapshot: AppStoreSnapshot,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.eventStore = new SqliteEventStore(this.db);
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
    const current = flatten(snapshot);
    const baseline = flatten(this.baseline);
    const changes = [...new Set([...current.keys(), ...baseline.keys()])]
      .filter((key) => current.get(key) !== baseline.get(key))
      .sort((left, right) => deletionPriority(left, current) -
        deletionPriority(right, current));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const compoundKey of changes) {
        const next = current.get(compoundKey);
        const previous = baseline.get(compoundKey);
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
    `);
    this.sessionChildren.createSchema();
    this.eventStore.createSchema();
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
    this.eventStore.readInto(snapshot);
    return snapshot;
  }

  private readEntity(namespace: string, key: string) {
    const event = this.eventStore.readEntity(namespace, key);
    if (event.handled) {
      return event.value === undefined
        ? undefined
        : stableJson(JSON.parse(event.value));
    }
    const row = this.db.prepare(
      "SELECT payload FROM app_records WHERE namespace = ? AND record_key = ?",
    ).get(namespace, key) as { payload: string } | undefined;
    if (!row) return undefined;
    const value = namespace === "sessions"
      ? this.readSession(key, row.payload)
      : JSON.parse(row.payload);
    return stableJson(value);
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
    if (this.eventStore.writeEntity(namespace, key, valueJson)) return;
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
    if (this.eventStore.deleteEntity(namespace, key)) return;
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
      const comparable = spec.namespace === "sessions"
        ? normalizedSession(value as SessionRecord)
        : value;
      records.set(compoundKey(String(spec.namespace), key), stableJson(comparable));
    }
  }
  for (const namespace of mapNamespaces) {
    const values = snapshot[namespace] as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      records.set(compoundKey(String(namespace), key), stableJson(value));
    }
  }
  return records;
}

function normalizedSession(session: SessionRecord): SessionRecord {
  const normalized = structuredClone(session);
  normalized.segments ??= [];
  if (!normalized.callLegs?.length) delete normalized.callLegs;
  if (!normalized.playbacks?.length) delete normalized.playbacks;
  return normalized;
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJsonKeys(value));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonKeys(item)]),
  );
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

function withoutSessionCollections(session: SessionRecord) {
  const {
    segments: _segments,
    callLegs: _callLegs,
    playbacks: _playbacks,
    ...metadata
  } = session;
  return metadata;
}

function compoundKey(namespace: string, key: string) {
  return `${namespace}\u0000${key}`;
}

function splitCompoundKey(value: string) {
  const separator = value.indexOf("\u0000");
  return [value.slice(0, separator), value.slice(separator + 1)] as const;
}

function deletionPriority(key: string, current: Map<string, string>) {
  if (current.has(key)) return 1;
  const [namespace] = splitCompoundKey(key);
  return namespace === "inboxEvents" || namespace === "outboxEvents" ? 0 : 1;
}
