import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  resetCallRoomEventRateLimitsForTests,
} from "./call-room-event-rate-limit.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call room event route resource limits", () => {
  const previous = Object.fromEntries(envKeys.map(
    (key) => [key, process.env[key]],
  ));

  beforeEach(() => {
    configureEnv();
    resetStore();
    resetCallRoomEventRateLimitsForTests();
    setCallRoomDataPublisherForTests({
      async ensureRoom() {},
      async publish() {},
    } satisfies CallRoomDataPublisher);
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    resetCallRoomEventRateLimitsForTests();
    restoreEnv(previous);
  });

  it("returns 429 after the configured per-session request rate", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const first = await publishEvent(app, callId, "event-1");
    const limited = await publishEvent(app, callId, "event-2");
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("call_room_event_rate_limited");
  });
});

function publishEvent(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  segmentId: string,
) {
  return app.inject({
    method: "POST",
    url: `/internal/call-links/${callId}/events`,
    headers: { authorization: "Bearer internal-secret-123" },
    payload: { events: [{
      type: "transcript.final",
      segmentId,
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "你好",
    }] },
  });
}

const envKeys = [
  "CALL_ROOM_PROVIDER",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "CALL_ROOM_TOKEN_TTL_SECONDS",
  "INTERNAL_API_SECRET",
  "CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND",
];

function configureEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "120";
  process.env.INTERNAL_API_SECRET = "internal-secret-123";
  process.env.CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND = "1";
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
  store.usageHolds = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}
