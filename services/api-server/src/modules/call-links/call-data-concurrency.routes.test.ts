import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";

describe("call data concurrency", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("isolates 50 concurrent sessions and settles every session once", async () => {
    const published = new Set<string>();
    setCallRoomDataPublisherForTests({
      async publish(_roomName, event) {
        published.add(event.eventId ?? `${event.callId}:${event.segmentId}`);
      },
    });
    const app = await buildApp();
    const created = await Promise.all(Array.from({ length: 50 }, () =>
      app.inject({ method: "POST", url: "/call-links" })
    ));
    const calls = created.map((response, index) => ({
      callId: response.json().callId as string,
      version: response.json().version as number,
      index,
    }));
    for (const call of calls) ageSession(call.callId, 8_000);

    const events = await Promise.all(calls.map((call) => app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/events`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: {
        expectedVersion: call.version,
        events: [eventPayload(call.index)],
      },
    })));
    const endResponses = await Promise.all(calls.flatMap((call) => [
      app.inject({ method: "POST", url: `/call-links/${call.callId}/end` }),
      app.inject({ method: "POST", url: `/call-links/${call.callId}/end` }),
    ]));
    await app.close();

    expect(created.every((response) => response.statusCode === 200)).toBe(true);
    expect(events.every((response) => response.statusCode === 200)).toBe(true);
    expect(endResponses.every((response) => response.statusCode === 200)).toBe(true);
    const callIds = new Set(calls.map((call) => call.callId));
    const store = getStoreSnapshot();
    const sessions = store.sessions.filter((session) => callIds.has(session.id));
    expect(sessions).toHaveLength(50);
    expect(sessions.every((session) =>
      session.status === "ended" &&
      session.segments.length === 1 &&
      session.segments[0]?.sourceText === `source-${calls.find(
        (call) => call.callId === session.id
      )?.index}`
    )).toBe(true);
    expect(store.billingLedger.filter((entry) =>
      entry.sessionId && callIds.has(entry.sessionId)
    )).toHaveLength(50);
    expect(store.usageHolds.filter((hold) =>
      hold.sessionId && callIds.has(hold.sessionId) && hold.status === "active"
    )).toHaveLength(0);
    expect(store.inboxEvents.filter((event) => callIds.has(event.sessionId)))
      .toHaveLength(50);
    expect(store.outboxEvents.filter((event) => callIds.has(event.sessionId)))
      .toHaveLength(100);
    expect(new Set(store.inboxEvents.map((event) => event.eventId)).size)
      .toBe(store.inboxEvents.length);
    expect(new Set(store.outboxEvents.map((event) => event.idempotencyKey)).size)
      .toBe(store.outboxEvents.length);
    expect(published).toHaveLength(100);
  }, 20_000);
});

function eventPayload(index: number) {
  return {
    type: "transcript.final",
    segmentId: `segment-${index}`,
    speakerRole: "guest",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text: `source-${index}`,
    sourceText: `source-${index}`,
    timestampMs: index + 1,
  };
}

function ageSession(sessionId: string, ageMs: number) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Missing session ${sessionId}`);
  session.createdAt = new Date(Date.now() - ageMs).toISOString();
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
];

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function resetStore() {
  const store = getStoreSnapshot();
  store.sessions = [];
  store.usageBalances = { "guest-user": 100_000 };
  store.usagePlanCodes = { "guest-user": "free" };
  store.usageHolds = [];
  store.billingLedger = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}
