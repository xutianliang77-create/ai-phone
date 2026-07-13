import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  setCallRoomDataPublisherForTests,
  type CallRoomDataPublisher,
} from "./call-room-worker.js";

describe("call room worker event routes", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    clearEnv();
    resetStore();
  });

  afterEach(() => {
    setCallRoomDataPublisherForTests(null);
    restoreEnv(previousEnv);
  });

  it("publishes worker events and persists them to call history", async () => {
    configureCallRoomEnv();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    const published: Array<{
      roomName: string;
      type: string;
      text: string;
      stage?: string;
      retryable?: boolean;
      voiceMode?: string;
      voiceProfileId?: string;
    }> = [];
    setCallRoomDataPublisherForTests({
      async publish(roomName, event) {
        published.push({
          roomName,
          type: event.type,
          text: event.text,
          stage: event.stage,
          retryable: event.retryable,
          ...(event.voiceMode ? { voiceMode: event.voiceMode } : {}),
          ...(event.voiceProfileId
            ? { voiceProfileId: event.voiceProfileId }
            : {}),
        });
      },
    } satisfies CallRoomDataPublisher);
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/events`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: {
        events: [
          workerStatusPayload("asr-failed-host-7", "ASR 识别失败，已继续监听"),
          eventPayload("transcript.final", "segment-1", "hello from guest"),
          eventPayload("translation.final", "segment-1", "你好，来自访客。", {
            translatedText: "你好，来自访客。",
          }),
          eventPayload("tts.ready", "segment-1", "你好，来自访客。", {
            translatedText: "你好，来自访客。",
            provider: "fake-tts",
            model: "fake-voice",
            voiceMode: "personal_clone",
            voiceProfileId: "my_voice",
            firstAudioMs: 120,
            audioDurationMs: 900,
          }),
        ],
      },
    });
    const session = await app.inject({
      method: "GET",
      url: `/sessions/${created.json().sessionId}`,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      callId,
      sessionId: callId,
      roomName: `call_${callId}`,
      topic: "translation.captions",
      publishedEvents: [
        "worker.status",
        "transcript.final",
        "translation.final",
        "tts.ready",
      ],
    });
    expect(published).toEqual([
      {
        roomName: `call_${callId}`,
        type: "worker.status",
        text: "ASR 识别失败，已继续监听",
        stage: "asr",
        retryable: true,
      },
      {
        roomName: `call_${callId}`,
        type: "transcript.final",
        text: "hello from guest",
        stage: undefined,
        retryable: undefined,
      },
      {
        roomName: `call_${callId}`,
        type: "translation.final",
        text: "你好，来自访客。",
        stage: undefined,
        retryable: undefined,
      },
      {
        roomName: `call_${callId}`,
        type: "tts.ready",
        text: "你好，来自访客。",
        stage: undefined,
        retryable: undefined,
        voiceMode: "personal_clone",
        voiceProfileId: "my_voice",
      },
    ]);
    expect(session.json().segments).toEqual([
      {
        id: "segment-1",
        sourceText: "hello from guest",
        translatedText: "你好，来自访客。",
        speaker: {
          speakerId: "guest",
          role: "guest",
          source: "participant_track",
          confidence: 1,
        },
        timing: {
          startMs: 1,
          endMs: 1,
          source: "participant_track",
        },
      },
    ]);
  });

  it("requires internal authorization when configured", async () => {
    configureCallRoomEnv();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${created.json().callId}/events`,
      payload: {
        events: [eventPayload("transcript.final", "segment-1", "hello")],
      },
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("internal_error");
  });

  it("issues worker room tokens only through the internal API", async () => {
    configureCallRoomEnv();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;

    const publicResponse = await app.inject({
      method: "POST",
      url: `/call-links/${callId}/room-token`,
      payload: { participantRole: "worker" },
    });
    const internalResponse = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/worker-room-token`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: { participantName: "worker-1" },
    });
    await app.close();

    const payload = decodeJwtPayload(internalResponse.json().token);
    expect(publicResponse.statusCode).toBe(400);
    expect(internalResponse.statusCode).toBe(200);
    expect(internalResponse.json()).toMatchObject({
      callId,
      sessionId: callId,
      participantRole: "worker",
      roomName: `call_${callId}`,
    });
    expect(payload.video).toMatchObject({
      room: `call_${callId}`,
      canPublish: true,
      canSubscribe: true,
    });
  });

  it("requires internal authorization for worker room tokens", async () => {
    configureCallRoomEnv();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${created.json().callId}/worker-room-token`,
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("internal_error");
  });

  it("rejects malformed worker events", async () => {
    configureCallRoomEnv();
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${created.json().callId}/events`,
      headers: { authorization: "Bearer internal-secret-123" },
      payload: { events: [{ type: "partial", segmentId: "segment-1" }] },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_call_room_event");
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

function eventPayload(
  type: "transcript.final" | "translation.final" | "tts.ready",
  segmentId: string,
  text: string,
  extra: Record<string, string | number> = {},
) {
  return {
    type,
    segmentId,
    speakerRole: "guest",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text,
    sourceText: type === "transcript.final" ? text : "hello from guest",
    timestampMs: 1,
    ...extra,
  };
}

function workerStatusPayload(segmentId: string, text: string) {
  return {
    type: "worker.status",
    segmentId,
    speakerRole: "worker",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text,
    stage: "asr",
    retryable: true,
    timestampMs: 1,
  };
}

function configureCallRoomEnv() {
  process.env.CALL_ROOM_PROVIDER = "livekit";
  process.env.LIVEKIT_URL = "wss://livekit.example.cn";
  process.env.LIVEKIT_API_KEY = "lk_key";
  process.env.LIVEKIT_API_SECRET = "lk_secret";
  process.env.CALL_ROOM_TOKEN_TTL_SECONDS = "3600";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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
}

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
