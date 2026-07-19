import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";

describe("ended call room worker events", () => {
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

  it("acknowledges a late event without persisting or publishing it", async () => {
    const published: string[] = [];
    setCallRoomDataPublisherForTests({
      async publish(_roomName, event) {
        published.push(event.type);
      },
    });
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    await app.inject({ method: "POST", url: `/call-links/${callId}/end` });
    const publishedBeforeLateEvent = [...published];

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/events`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: { events: [lateTranscript()] },
    });
    const session = getStoreSnapshot().sessions.find((item) => item.id === callId);
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      callId,
      sessionId: callId,
      status: "ended",
      callEnded: true,
      publishedEvents: [],
    });
    expect(session?.segments).toEqual([]);
    expect(published).toEqual(publishedBeforeLateEvent);
  });
});

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

function lateTranscript() {
  return {
    type: "transcript.final",
    segmentId: "late-segment",
    speakerRole: "guest",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text: "late text",
    sourceText: "late text",
    timestampMs: 1,
  };
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
  store.billingLedger = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}
