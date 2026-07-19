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

  it("persists call metadata and call legs with the owning session", () => {
    const fixture = createFixture();
    const writer = fixture.open();
    const snapshot = writer.read();
    snapshot.sessions.push(callSession("call-a"));
    writer.save(snapshot);
    writer.close();

    const reader = fixture.open();
    expect(reader.read().sessions[0]).toMatchObject({
      id: "call-a",
      mode: "call_link",
      callLink: {
        roomName: "call_call-a",
        roomProvider: "livekit",
      },
      callLegs: [{
        id: "call-a:host:one",
        participantIdentity: "call-a:host:one",
        participantRole: "host",
        status: "active",
      }],
    });
    reader.close();
  });

  it("allows sequential updates after session children change JSON field order", () => {
    const fixture = createFixture();
    const store = fixture.open();
    const snapshot = store.read();
    snapshot.sessions.push(callSession("call-sequential"));
    store.save(snapshot);

    snapshot.sessions[0]!.status = "active";
    expect(() => store.save(snapshot)).not.toThrow();
    store.close();

    const reader = fixture.open();
    expect(reader.read().sessions[0]).toMatchObject({
      id: "call-sequential",
      status: "active",
      callLegs: [{ participantRole: "host" }],
    });
    reader.close();
  });

  it("treats empty optional call collections like omitted child rows", () => {
    const fixture = createFixture();
    const store = fixture.open();
    const snapshot = store.read();
    const call = callSession("call-first-leg");
    call.callLegs = [];
    call.playbacks = [];
    snapshot.sessions.push(call);
    store.save(snapshot);

    call.callLegs.push({
      id: "call-first-leg:worker:one",
      participantIdentity: "call-first-leg:worker:one",
      participantRole: "worker",
      joinType: "worker",
      status: "active",
      joinedAt: "2026-07-13T00:00:02.000Z",
    });
    expect(() => store.save(snapshot)).not.toThrow();
    store.close();

    const reader = fixture.open();
    expect(reader.read().sessions[0]?.callLegs).toMatchObject([
      { participantRole: "worker", status: "active" },
    ]);
    reader.close();
  });

  it("persists playback with its session, segment, and call-leg bindings", () => {
    const fixture = createFixture();
    const writer = fixture.open();
    const snapshot = writer.read();
    snapshot.sessions.push(callSessionWithPlayback("call-playback"));
    writer.save(snapshot);
    writer.close();

    const reader = fixture.open();
    expect(reader.read().sessions[0]).toMatchObject({
      id: "call-playback",
      segments: [{ id: "call-playback:segment:one" }],
      callLegs: [
        { id: "call-playback:host:one", participantRole: "host" },
        { id: "call-playback:guest:one", participantRole: "guest" },
      ],
      playbacks: [{
        id: "call-playback:playback:one",
        segmentId: "call-playback:segment:one",
        sourceLegId: "call-playback:host:one",
        targetLegId: "call-playback:guest:one",
        generation: 1,
        status: "completed",
      }],
    });
    reader.close();
  });

  it("persists inbox and outbox records and removes them with the session", () => {
    const fixture = createFixture();
    const writer = fixture.open();
    const snapshot = writer.read();
    snapshot.sessions.push(callSession("call-events"));
    snapshot.inboxEvents.push({
      eventId: "event-1",
      sessionId: "call-events",
      eventType: "translation.final",
      payloadHash: "hash-1",
      receivedAt: "2026-07-13T00:00:01.000Z",
      processedAt: "2026-07-13T00:00:01.000Z",
    });
    snapshot.outboxEvents.push({
      idempotencyKey: "outbox:event-1",
      sessionId: "call-events",
      eventType: "call_room.data",
      payload: { type: "translation.final" },
      attempts: 0,
      availableAt: "2026-07-13T00:00:01.000Z",
      createdAt: "2026-07-13T00:00:01.000Z",
    });
    writer.save(snapshot);
    writer.close();

    const reader = fixture.open();
    const stored = reader.read();
    expect(stored.inboxEvents).toHaveLength(1);
    expect(stored.outboxEvents).toHaveLength(1);
    stored.sessions = [];
    stored.inboxEvents = [];
    stored.outboxEvents = [];
    reader.save(stored);
    reader.close();

    const finalReader = fixture.open();
    expect(finalReader.read()).toMatchObject({
      sessions: [],
      inboxEvents: [],
      outboxEvents: [],
    });
    expect(finalReader.quickCheck()).toBe("ok");
    finalReader.close();
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

function callSession(id: string): AppStoreSnapshot["sessions"][number] {
  return {
    id,
    userId: "user-a",
    mode: "call_link",
    status: "created",
    consumedSeconds: 0,
    createdAt: "2026-07-13T00:00:00.000Z",
    segments: [],
    callLink: {
      roomName: `call_${id}`,
      roomProvider: "livekit",
      joinUrl: `https://call.example.cn/join/${id}`,
      hostUrl: `https://call.example.cn/host/${id}`,
      expiresAt: "2026-07-13T01:00:00.000Z",
    },
    callLegs: [{
      id: `${id}:host:one`,
      participantIdentity: `${id}:host:one`,
      participantRole: "host",
      joinType: "app",
      status: "active",
      joinedAt: "2026-07-13T00:00:01.000Z",
    }],
  };
}

function callSessionWithPlayback(
  id: string,
): AppStoreSnapshot["sessions"][number] {
  const value = callSession(id);
  value.segments = [segment(`${id}:segment:one`)];
  value.callLegs = [
    ...(value.callLegs ?? []),
    {
      id: `${id}:guest:one`,
      participantIdentity: `${id}:guest:one`,
      participantRole: "guest",
      joinType: "web",
      status: "active",
      joinedAt: "2026-07-13T00:00:02.000Z",
    },
  ];
  value.playbacks = [{
    id: `${id}:playback:one`,
    segmentId: `${id}:segment:one`,
    sourceLegId: `${id}:host:one`,
    targetLegId: `${id}:guest:one`,
    generation: 1,
    status: "completed",
    queuedAt: "2026-07-13T00:00:03.000Z",
    startedAt: "2026-07-13T00:00:04.000Z",
    endedAt: "2026-07-13T00:00:05.000Z",
  }];
  return value;
}
