import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { recoverPendingCallRoomOutbox } from "./call-room-outbox-recovery.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";

describe("call room reliable event routes", () => {
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

  it("deduplicates repeated events and detects a stale session version", async () => {
    const published: string[] = [];
    setCallRoomDataPublisherForTests({
      async publish(_roomName, event) {
        published.push(event.segmentId);
      },
    });
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const version = created.json().version as number;
    const payload = {
      expectedVersion: version,
      events: [eventPayload("segment-1", "hello")],
    };

    const accepted = await postEvents(app, callId, payload);
    const duplicate = await postEvents(app, callId, payload);
    const conflict = await postEvents(app, callId, {
      expectedVersion: version,
      events: [eventPayload("segment-2", "next")],
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().sessionVersion).toBeGreaterThan(version);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicateCount).toBe(1);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "session_version_conflict" },
      expectedVersion: version,
      currentVersion: accepted.json().sessionVersion,
    });
    expect(published).toEqual(["segment-1"]);
    expect(getStoreSnapshot().inboxEvents).toHaveLength(1);
    expect(getStoreSnapshot().outboxEvents).toMatchObject([
      { publishedAt: expect.any(String) },
    ]);
  });

  it("recovers a persisted outbox event after a publish failure", async () => {
    setCallRoomDataPublisherForTests({
      async publish() {
        throw new Error("livekit unavailable");
      },
    });
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const failed = await postEvents(app, callId, {
      events: [eventPayload("segment-1", "saved")],
    });
    const published: string[] = [];
    setCallRoomDataPublisherForTests({
      async publish(_roomName, event) {
        published.push(event.text);
      },
    });
    const recovery = await recoverPendingCallRoomOutbox(
      new Date(Date.now() + 2_000),
    );
    await app.close();

    expect(failed.statusCode).toBe(503);
    expect(getStoreSnapshot().sessions.find((item) => item.id === callId))
      .toMatchObject({ segments: [{ sourceText: "saved" }] });
    expect(recovery).toEqual({
      publishedSessionCount: 1,
      failedSessionIds: [],
    });
    expect(published).toEqual(["saved"]);
    expect(getStoreSnapshot().outboxEvents[0]?.publishedAt).toBeTruthy();
  });

  it("accepts a newer revision while deduplicating a replay of that revision", async () => {
    const published: Array<{ revision?: number; text: string }> = [];
    setCallRoomDataPublisherForTests({
      async publish(_roomName, event) {
        published.push({ revision: event.revision, text: event.text });
      },
    });
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const first = {
      events: [{
        ...eventPayload("segment-1", "call fifteen"),
        speechId: "speech-1",
        turnId: "turn-1",
        revision: 0,
        pipelineGeneration: 1,
      }],
    };
    const corrected = {
      events: [{
        ...eventPayload("segment-1", "call fifty"),
        speechId: "speech-1",
        turnId: "turn-1",
        revision: 1,
        pipelineGeneration: 2,
        pipelineTiming: {
          asrStartedAtMs: 100,
          asrFinalAtMs: 220,
          translationFinalAtMs: 300,
          eventPublishStartedAtMs: 310,
        },
      }],
    };

    const firstResponse = await postEvents(app, callId, first);
    const correctedResponse = await postEvents(app, callId, corrected);
    const replayResponse = await postEvents(app, callId, corrected);
    await app.close();

    expect(firstResponse.statusCode).toBe(200);
    expect(correctedResponse.statusCode).toBe(200);
    expect(replayResponse.json().duplicateCount).toBe(1);
    expect(published).toEqual([
      { revision: 0, text: "call fifteen" },
      { revision: 1, text: "call fifty" },
    ]);
    expect(getStoreSnapshot().sessions.find((item) => item.id === callId))
      .toMatchObject({
        segments: [{
          id: "segment-1",
          speechId: "speech-1",
          turnId: "turn-1",
          revision: 1,
          pipelineGeneration: 2,
          pipelineTiming: {
            asrStartedAtMs: 100,
            asrFinalAtMs: 220,
            translationFinalAtMs: 300,
            eventPublishStartedAtMs: 310,
          },
          sourceText: "call fifty",
        }],
      });
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

function eventPayload(segmentId: string, text: string) {
  return {
    type: "transcript.final",
    segmentId,
    speakerRole: "guest",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text,
    sourceText: text,
    timestampMs: 1,
  };
}

function postEvents(app: Awaited<ReturnType<typeof buildApp>>, callId: string, payload: object) {
  return app.inject({
    method: "POST",
    url: `/internal/call-links/${callId}/events`,
    headers: { authorization: "Bearer internal-secret-123" },
    payload,
  });
}

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
  store.inboxEvents = [];
  store.outboxEvents = [];
}
