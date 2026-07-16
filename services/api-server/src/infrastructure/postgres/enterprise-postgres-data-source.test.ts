import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyStoreSnapshot,
} from "../storage/json-store.js";
import { SqliteSnapshotStore } from "../storage/sqlite-snapshot-store.js";
import {
  readEnterpriseDataSource,
} from "./enterprise-postgres-data-source.js";
import {
  enterpriseDataTestSnapshot,
} from "./enterprise-postgres-data-test-fixture.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("enterprise PostgreSQL data source", () => {
  it("reads the six enterprise collections from JSON", () => {
    const directory = temporaryDirectory();
    const file = join(directory, "source.json");
    const snapshot = {
      ...createEmptyStoreSnapshot(),
      ...enterpriseDataTestSnapshot(),
    };
    writeFileSync(file, JSON.stringify(snapshot));
    expect(readEnterpriseDataSource("json", file)).toEqual(
      enterpriseDataTestSnapshot(),
    );
  });

  it("copies and checks SQLite without changing the source file", () => {
    const directory = temporaryDirectory();
    const file = join(directory, "source.sqlite");
    const store = new SqliteSnapshotStore(file, createEmptyStoreSnapshot());
    store.save({
      ...createEmptyStoreSnapshot(),
      ...enterpriseDataTestSnapshot(),
    });
    store.close();
    const before = fileHash(file);
    expect(readEnterpriseDataSource("sqlite", file)).toEqual(
      enterpriseDataTestSnapshot(),
    );
    expect(fileHash(file)).toBe(before);
  });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "enterprise-data-test-"));
  directories.push(directory);
  return directory;
}

function fileHash(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
