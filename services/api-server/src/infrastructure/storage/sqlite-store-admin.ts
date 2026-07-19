import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEmptyStoreSnapshot,
  normalizeStoreSnapshot,
} from "./json-store.js";
import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";

const [command, ...args] = process.argv.slice(2);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runSqliteStoreAdmin(command, args);
}

export async function runSqliteStoreAdmin(
  action: string | undefined,
  values: string[],
) {
  if (action === "migrate-json") return migrateJson(values);
  if (action === "check") return check(values);
  if (action === "backup") return createBackup(values);
  if (action === "restore") return restoreBackup(values);
  throw new Error(
    "Usage: sqlite-store-admin <migrate-json|check|backup|restore> [paths]",
  );
}

function migrateJson(values: string[]) {
  const source = resolve(values[0] ?? process.env.API_DATA_FILE ?? ".data/api-store.json");
  const target = resolve(values[1] ?? process.env.API_SQLITE_FILE ?? ".data/api-store.sqlite");
  if (!existsSync(source)) throw new Error(`JSON source not found: ${source}`);
  const store = new SqliteSnapshotStore(target, createEmptyStoreSnapshot());
  try {
    if (!store.isEmpty()) throw new Error(`SQLite target is not empty: ${target}`);
    const snapshot = normalizeStoreSnapshot(JSON.parse(readFileSync(source, "utf8")));
    store.save(snapshot);
    assertHealthy(store, target);
    printResult("migrated", target, snapshot.sessions.length);
  } finally {
    store.close();
  }
}

function check(values: string[]) {
  const file = sqlitePath(values[0]);
  const store = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
  try {
    assertHealthy(store, file);
    printResult("ready", file, store.read().sessions.length);
  } finally {
    store.close();
  }
}

async function createBackup(values: string[]) {
  const source = sqlitePath(values[0]);
  const destination = resolve(
    values[1] ?? `${source}.backup-${Date.now()}`,
  );
  const store = new SqliteSnapshotStore(source, createEmptyStoreSnapshot());
  try {
    assertHealthy(store, source);
    await store.backupTo(destination);
  } finally {
    store.close();
  }
  const backupStore = new SqliteSnapshotStore(
    destination,
    createEmptyStoreSnapshot(),
  );
  try {
    assertHealthy(backupStore, destination);
    printResult("backed_up", destination, backupStore.read().sessions.length);
  } finally {
    backupStore.close();
  }
}

async function restoreBackup(values: string[]) {
  if (process.env.API_STORAGE_MAINTENANCE !== "true") {
    throw new Error("Set API_STORAGE_MAINTENANCE=true while the API is stopped");
  }
  if (!values[0]) throw new Error("Backup source path is required");
  const source = resolve(values[0]);
  const target = sqlitePath(values[1]);
  if (!existsSync(source)) throw new Error("Backup source not found");
  const sourceStore = new SqliteSnapshotStore(source, createEmptyStoreSnapshot());
  const temporary = `${target}.restore-${process.pid}`;
  try {
    assertHealthy(sourceStore, source);
    rmSync(temporary, { force: true });
    await sourceStore.backupTo(temporary);
  } finally {
    sourceStore.close();
  }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) copyFileSync(target, `${target}.pre-restore`);
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
  renameSync(temporary, target);
  check([target]);
}

function sqlitePath(value: string | undefined) {
  return resolve(value ?? process.env.API_SQLITE_FILE ?? ".data/api-store.sqlite");
}

function assertHealthy(store: SqliteSnapshotStore, file: string) {
  const result = store.quickCheck();
  if (result !== "ok") throw new Error(`SQLite quick_check failed for ${file}: ${result}`);
}

function printResult(status: string, file: string, sessions: number) {
  process.stdout.write(`${JSON.stringify({ status, file, sessions })}\n`);
}
