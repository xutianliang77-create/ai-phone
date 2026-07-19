import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SqliteSnapshotStore,
  StorageConflictError,
} from "./sqlite-snapshot-store.js";
import { appendPostgresProjectionEvents } from "./postgres-projection-outbox.js";
import {
  createEmptyStoreSnapshot,
  normalizeStoreSnapshot,
  type AppStoreSnapshot,
} from "./json-store-snapshot.js";

export {
  createEmptyStoreSnapshot,
  normalizeStoreSnapshot,
};
export type { AppStoreSnapshot } from "./json-store-snapshot.js";

let snapshot: AppStoreSnapshot | null = null;
let persistedSnapshot: AppStoreSnapshot | null = null;
let sqliteStore: SqliteSnapshotStore | null = null;
let transactionDepth = 0;
let transactionDirty = false;

export function getStoreSnapshot() {
  if (!snapshot) {
    snapshot = readSnapshot();
    persistedSnapshot = structuredClone(snapshot);
  }
  return snapshot;
}

export function persistStoreSnapshot() {
  if (transactionDepth > 0) {
    transactionDirty = true;
    return;
  }
  persistStoreSnapshotNow();
}

export function runStoreTransaction<T>(operation: () => T): T {
  if (transactionDepth > 0) return operation();
  const before = structuredClone(getStoreSnapshot());
  transactionDepth = 1;
  transactionDirty = false;
  try {
    const result = operation();
    if (isPromiseLike(result)) {
      throw new Error("Store transactions must be synchronous");
    }
    if (transactionDirty) persistStoreSnapshotNow();
    return result;
  } catch (error) {
    snapshot = storageDriver() === "sqlite" && error instanceof StorageConflictError
      ? getSqliteStore().read()
      : before;
    throw error;
  } finally {
    transactionDepth = 0;
    transactionDirty = false;
  }
}

function persistStoreSnapshotNow() {
  if (!snapshot) return;
  if (persistedSnapshot) {
    appendPostgresProjectionEvents(persistedSnapshot, snapshot);
  }
  if (storageDriver() === "sqlite") {
    const store = getSqliteStore();
    try {
      store.save(snapshot);
    } catch (error) {
      snapshot = store.read();
      persistedSnapshot = structuredClone(snapshot);
      throw error;
    }
    persistedSnapshot = structuredClone(snapshot);
    return;
  }
  const file = dataFile();
  if (!file) {
    persistedSnapshot = structuredClone(snapshot);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, file);
  persistedSnapshot = structuredClone(snapshot);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null &&
    "then" in value && typeof value.then === "function";
}

export function getStorageStatus() {
  const driver = storageDriver();
  if (driver !== "sqlite") {
    return { driver, status: driver === "memory" ? "ephemeral" : "legacy" };
  }
  const store = getSqliteStore();
  return {
    driver,
    status: store.quickCheck() === "ok" ? "ready" : "not_ready",
    journalMode: store.journalMode(),
  };
}

function readSnapshot(): AppStoreSnapshot {
  if (storageDriver() === "sqlite") {
    const store = getSqliteStore();
    const stored = store.read();
    if (!store.isEmpty()) return stored;
    const legacy = readJsonSnapshot();
    if (hasSnapshotData(legacy)) store.save(legacy);
    return legacy;
  }
  return readJsonSnapshot();
}

function readJsonSnapshot(): AppStoreSnapshot {
  const file = dataFile();
  if (!file || !existsSync(file)) return createEmptyStoreSnapshot();
  try {
    return normalizeStoreSnapshot(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return createEmptyStoreSnapshot();
  }
}

function getSqliteStore() {
  sqliteStore ??= new SqliteSnapshotStore(
    sqliteFile(),
    createEmptyStoreSnapshot(),
  );
  return sqliteStore;
}

function storageDriver() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "memory";
  const value = process.env.API_STORAGE_DRIVER?.trim().toLowerCase();
  if (!value || value === "json") return "json";
  if (value === "sqlite") return "sqlite";
  throw new Error(`Unsupported API_STORAGE_DRIVER: ${value}`);
}

function sqliteFile() {
  return resolve(process.env.API_SQLITE_FILE ?? ".data/api-store.sqlite");
}

function hasSnapshotData(value: AppStoreSnapshot) {
  return value.sessions.length > 0 ||
    value.accounts.length > 0 ||
    value.billingLedger.length > 0 ||
    Object.keys(value.usageBalances).length > 0;
}

function dataFile() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  return resolve(process.env.API_DATA_FILE ?? ".data/api-store.json");
}
