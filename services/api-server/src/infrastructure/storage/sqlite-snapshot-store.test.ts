import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyStoreSnapshot,
  type AppStoreSnapshot,
} from "./json-store.js";
import {
  SqliteSnapshotStore,
  StorageConflictError,
} from "./sqlite-snapshot-store.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("sqlite snapshot store", () => {
  it("commits different session ids without overwriting either writer", () => {
    const fixture = createFixture();
    const writerA = fixture.open();
    const writerB = fixture.open();
    const snapshotA = writerA.read();
    const snapshotB = writerB.read();
    snapshotA.sessions.push(session("session-a", "segment-a"));
    snapshotB.sessions.push(session("session-b", "segment-b"));

    writerA.save(snapshotA);
    writerB.save(snapshotB);
    writerA.close();
    writerB.close();

    const reader = fixture.open();
    const stored = reader.read();
    expect(stored.sessions.map((item) => item.id).sort()).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(stored.sessions[0]?.segments).toHaveLength(1);
    expect(reader.quickCheck()).toBe("ok");
    reader.close();
  });

  it("rejects a stale concurrent write to the same session id", () => {
    const fixture = createFixture();
    const seed = fixture.open();
    const initial = seed.read();
    initial.sessions.push(session("shared-session", "segment-one"));
    seed.save(initial);
    seed.close();

    const writerA = fixture.open();
    const writerB = fixture.open();
    const snapshotA = writerA.read();
    const snapshotB = writerB.read();
    snapshotA.sessions[0]!.segments.push(segment("segment-two"));
    snapshotB.sessions[0]!.consumedSeconds = 20;

    writerA.save(snapshotA);
    expect(() => writerB.save(snapshotB)).toThrow(StorageConflictError);
    writerA.close();
    writerB.close();

    const reader = fixture.open();
    expect(reader.read().sessions[0]).toMatchObject({
      consumedSeconds: 0,
      segments: [{ id: "segment-one" }, { id: "segment-two" }],
    });
    reader.close();
  });

  it("persists map values and cascades segment deletion with the session", () => {
    const fixture = createFixture();
    const store = fixture.open();
    const snapshot = store.read();
    snapshot.usageBalances["user-a"] = 300;
    snapshot.sessions.push(session("session-delete", "segment-delete"));
    store.save(snapshot);
    snapshot.sessions = [];
    store.save(snapshot);
    store.close();

    const reader = fixture.open();
    const stored = reader.read();
    expect(stored.usageBalances).toEqual({ "user-a": 300 });
    expect(stored.sessions).toEqual([]);
    expect(reader.quickCheck()).toBe("ok");
    reader.close();
  });
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "ai-phone-sqlite-"));
  cleanupPaths.push(directory);
  const file = join(directory, "store.sqlite");
  return {
    open: () => new SqliteSnapshotStore(file, createEmptyStoreSnapshot()),
  };
}

function session(id: string, segmentId: string): AppStoreSnapshot["sessions"][number] {
  return {
    id,
    userId: "user-a",
    mode: "conversation",
    status: "ended",
    consumedSeconds: 0,
    createdAt: "2026-07-13T00:00:00.000Z",
    segments: [segment(segmentId)],
  };
}

function segment(id: string) {
  return {
    id,
    sourceText: `source-${id}`,
    translatedText: `translation-${id}`,
  };
}
