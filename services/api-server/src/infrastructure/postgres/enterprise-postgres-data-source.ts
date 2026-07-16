import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  createEmptyStoreSnapshot,
  normalizeStoreSnapshot,
} from "../storage/json-store.js";
import { SqliteSnapshotStore } from "../storage/sqlite-snapshot-store.js";
import {
  enterpriseDataSnapshot,
  type EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";

export type EnterpriseDataSourceType = "json" | "sqlite";

export function readEnterpriseDataSource(
  type: EnterpriseDataSourceType,
  file: string,
): EnterpriseDataSnapshot {
  const source = resolve(file);
  if (!existsSync(source)) throw new Error(`Enterprise data source not found: ${source}`);
  if (type === "json") {
    return enterpriseDataSnapshot(normalizeStoreSnapshot(
      JSON.parse(readFileSync(source, "utf8")),
    ));
  }
  const directory = mkdtempSync(join(tmpdir(), "wujie-enterprise-import-"));
  const copy = join(directory, basename(source));
  copyFileSync(source, copy);
  copySqliteCompanion(source, copy, "-wal");
  copySqliteCompanion(source, copy, "-shm");
  const store = new SqliteSnapshotStore(copy, createEmptyStoreSnapshot());
  try {
    if (store.quickCheck() !== "ok") {
      throw new Error("Enterprise SQLite source quick_check failed");
    }
    return enterpriseDataSnapshot(store.read());
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function copySqliteCompanion(source: string, copy: string, suffix: string) {
  if (existsSync(`${source}${suffix}`)) {
    copyFileSync(`${source}${suffix}`, `${copy}${suffix}`);
  }
}
