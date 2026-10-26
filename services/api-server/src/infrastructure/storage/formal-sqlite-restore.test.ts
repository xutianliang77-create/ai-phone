import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEmptyStoreSnapshot } from "./json-store.js";
import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";
import { runSqliteStoreAdmin } from "./sqlite-store-admin.js";

describe("formal metadata backup and recovery on disposable SQLite only", () => {
  it("restores old history, new stop proof and pending holds without replaying an event", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wujie-p1-restore-"));
    const source = join(directory, "source.sqlite");
    const backup = join(directory, "backup.sqlite");
    const restored = join(directory, "isolated-restored.sqlite");
    const snapshot = createEmptyStoreSnapshot();
    const base = { userId: "fixture-owner", mode: "conversation" as const,
      status: "ended" as const, consumedSeconds: 12, createdAt: "2026-10-26T00:00:00Z", segments: [] };
    snapshot.sessions.push({ ...base, id: "legacy-history" }, { ...base, id: "formal-history",
      ownerAuthSessionHash: "fixture-hash", gatewayFinalizationReceipt: "fixture-proof" });
    snapshot.usageBalances["fixture-owner"] = 88;
    snapshot.usageHolds.push({ id: "pending-hold", userId: "fixture-owner", seconds: 30,
      status: "active", createdAt: base.createdAt, expiresAt: "2026-10-26T00:30:00Z",
      note: "realtime_session_hold:gateway_stop_v1" });
    snapshot.outboxEvents.push({ idempotencyKey: "fixture-pending-event", sessionId: "formal-history",
      eventType: "call_room.data", payload: { type: "worker.status" }, attempts: 0,
      availableAt: base.createdAt, createdAt: base.createdAt });
    const writer = new SqliteSnapshotStore(source, createEmptyStoreSnapshot());
    try { writer.save(snapshot); } finally { writer.close(); }
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("API_STORAGE_MAINTENANCE", "true");
    try {
      await runSqliteStoreAdmin("backup", [source, backup]);
      await runSqliteStoreAdmin("restore", [backup, restored]);
      const reader = new SqliteSnapshotStore(restored, createEmptyStoreSnapshot());
      const unchanged = new SqliteSnapshotStore(source, createEmptyStoreSnapshot());
      try {
        expect(reader.quickCheck()).toBe("ok");
        expect(reader.read()).toEqual(unchanged.read());
        expect(reader.read().sessions.find((s) => s.id === "formal-history"))
          .toMatchObject({ ownerAuthSessionHash: "fixture-hash", gatewayFinalizationReceipt: "fixture-proof" });
        expect(reader.read().outboxEvents[0].attempts).toBe(0);
        expect(reader.read().usageHolds[0].status).toBe("active");
      } finally { reader.close(); unchanged.close(); }
    } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); }
  });
});
