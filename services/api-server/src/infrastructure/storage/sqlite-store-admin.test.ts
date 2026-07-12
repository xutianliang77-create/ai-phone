import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyStoreSnapshot } from "./json-store.js";
import { runSqliteStoreAdmin } from "./sqlite-store-admin.js";
import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("sqlite store admin", () => {
  it("migrates JSON and creates a verified consistent backup", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const directory = mkdtempSync(join(tmpdir(), "ai-phone-admin-"));
    cleanupPaths.push(directory);
    const source = join(directory, "api-store.json");
    const database = join(directory, "api-store.sqlite");
    const backup = join(directory, "backup.sqlite");
    const snapshot = createEmptyStoreSnapshot();
    snapshot.usageBalances["user-a"] = 120;
    snapshot.sessions.push({
      id: "migrated-session",
      userId: "user-a",
      mode: "conversation",
      status: "ended",
      consumedSeconds: 10,
      createdAt: "2026-07-13T00:00:00.000Z",
      segments: [
        { id: "segment-one", sourceText: "hello", translatedText: "你好" },
      ],
    });
    writeFileSync(source, JSON.stringify(snapshot));

    await runSqliteStoreAdmin("migrate-json", [source, database]);
    await runSqliteStoreAdmin("backup", [database, backup]);

    const store = new SqliteSnapshotStore(backup, createEmptyStoreSnapshot());
    expect(store.quickCheck()).toBe("ok");
    expect(store.read()).toMatchObject({
      usageBalances: { "user-a": 120 },
      sessions: [{ id: "migrated-session", segments: [{ id: "segment-one" }] }],
    });
    store.close();
    expect(readFileSync(source, "utf8")).toContain("migrated-session");
  });

  it("requires maintenance mode before restore", async () => {
    const previous = process.env.API_STORAGE_MAINTENANCE;
    delete process.env.API_STORAGE_MAINTENANCE;
    try {
      await expect(runSqliteStoreAdmin("restore", ["backup", "target"]))
        .rejects.toThrow("API_STORAGE_MAINTENANCE=true");
    } finally {
      if (previous === undefined) delete process.env.API_STORAGE_MAINTENANCE;
      else process.env.API_STORAGE_MAINTENANCE = previous;
    }
  });
});
