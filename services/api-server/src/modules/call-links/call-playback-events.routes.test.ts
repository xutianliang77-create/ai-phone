import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { registerCallLeg } from "./call-links.service.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";

describe("call playback event routes", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    configureEnv();
    resetStore();
    setCallRoomDataPublisherForTests({ async publish() {} });
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("persists one id-bound lifecycle, deduplicates retries, and rejects rollback", async () => {
    const app = await buildApp();
    const callId = await createCallWithLegs(app);
    const events = [
      transcriptEvent(),
      playbackEvent("playback.queued", 1),
      playbackEvent("playback.started", 2),
      playbackEvent("playback.ended", 3),
    ];

    const accepted = await postEvents(app, callId, events);
    const duplicate = await postEvents(app, callId, events);
    const rollback = await postEvents(app, callId, [
      playbackEvent("playback.failed", 4),
    ]);
    const detail = await app.inject({ method: "GET", url: `/sessions/${callId}` });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().playbackBindings).toEqual([
      {
        playbackId: "playback-1",
        generation: 1,
        sourceLegId: `${callId}:host`,
        targetLegId: `${callId}:guest`,
      },
    ]);
    expect(duplicate.json().duplicateCount).toBe(4);
    expect(rollback.statusCode).toBe(409);
    expect(detail.json().playbacks).toMatchObject([{
      id: "playback-1",
      segmentId: "segment-1",
      sourceLegId: `${callId}:host`,
      targetLegId: `${callId}:guest`,
      generation: 1,
      status: "completed",
    }]);
    expect(getStoreSnapshot().inboxEvents).toHaveLength(4);
  });

  it("interrupts active playback once when the owning call ends", async () => {
    const app = await buildApp();
    const callId = await createCallWithLegs(app);
    await postEvents(app, callId, [
      transcriptEvent(),
      playbackEvent("playback.queued", 1),
      playbackEvent("playback.started", 2),
    ]);

    const ended = await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
    const repeated = await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
    const detail = await app.inject({ method: "GET", url: `/sessions/${callId}` });
    await app.close();

    expect(ended.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(detail.json().playbacks).toMatchObject([{
      id: "playback-1",
      status: "interrupted",
      interruptReason: "session_end",
      endedAt: expect.any(String),
    }]);
  });
});

async function createCallWithLegs(app: Awaited<ReturnType<typeof buildApp>>) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const callId = created.json().callId as string;
  await registerCallLeg({
    callId,
    participantIdentity: `${callId}:host`,
    participantRole: "host",
    joinType: "app",
  });
  await registerCallLeg({
    callId,
    participantIdentity: `${callId}:guest`,
    participantRole: "guest",
    joinType: "web",
  });
  return callId;
}

function transcriptEvent() {
  return {
    type: "transcript.final",
    segmentId: "segment-1",
    speakerRole: "host",
    sourceLanguage: "zh",
    targetLanguage: "en",
    text: "你好",
    sourceText: "你好",
    timestampMs: 1,
  };
}

function playbackEvent(type: string, timestampMs: number) {
  return {
    type,
    segmentId: "segment-1",
    playbackId: "playback-1",
    generation: 1,
    speakerRole: "host",
    sourceLanguage: "zh",
    targetLanguage: "en",
    text: "hello",
    translatedText: "hello",
    timestampMs,
  };
}

function postEvents(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  events: object[],
) {
  return app.inject({
    method: "POST",
    url: `/internal/call-links/${callId}/events`,
    headers: { authorization: "Bearer internal-secret-123" },
    payload: { events },
  });
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
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
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
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.entitlementPlanCodes = {};
  store.entitlementOrderIds = {};
  store.paymentOrders = [];
  store.billingLedger = [];
  store.appleServerNotifications = [];
  store.appErrorReports = [];
  store.voiceProfiles = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}
