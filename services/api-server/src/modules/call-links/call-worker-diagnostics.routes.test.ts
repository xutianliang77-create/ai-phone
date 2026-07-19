import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { setCallRoomDataPublisherForTests } from "./call-room-worker.js";

describe("Call Worker diagnostics", () => {
  const previousSecret = process.env.INTERNAL_API_SECRET;
  const previousProvider = process.env.CALL_ROOM_PROVIDER;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = "internal-secret-123";
    process.env.CALL_ROOM_PROVIDER = "mock";
    const store = getStoreSnapshot();
    store.sessions = [];
    store.usageBalances = {};
    store.usageHolds = [];
    store.billingLedger = [];
    setCallRoomDataPublisherForTests({ async publish() {} });
  });

  afterEach(() => {
    restore("INTERNAL_API_SECRET", previousSecret);
    restore("CALL_ROOM_PROVIDER", previousProvider);
    setCallRoomDataPublisherForTests(null);
  });

  it("merges retry-safe node reports after the call has ended", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const { callId, sessionId } = created.json() as {
      callId: string;
      sessionId: string;
    };
    await app.inject({ method: "POST", url: `/call-links/${callId}/end` });

    const first = await report(app, callId, node("node-a", "runtime-a", 100));
    await report(app, callId, node("node-a", "runtime-a", 100));
    const second = await report(app, callId, node("node-b", "runtime-b", 200));
    const detail = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    const quality = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/quality-report`,
    });
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.json().nodeCount).toBe(2);
    expect(detail.json().diagnostics).toMatchObject({
      audio: { receivedFrameCount: 20, processedBatchCount: 16 },
      nodes: [{ runtimeId: "runtime-a" }, { runtimeId: "runtime-b" }],
    });
    expect(quality.json()).toMatchObject({
      ingest: { nodeCount: 2, runtimeCount: 2, legCount: 2 },
      rtc: { sampleCount: 2, packetsReceived: 180, packetsLost: 20 },
    });
  });

  it("rejects unauthorized and inconsistent reports", async () => {
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/call-links" });
    const callId = created.json().callId as string;
    const unauthorized = await app.inject({
      method: "POST",
      url: `/internal/call-links/${callId}/diagnostics`,
      payload: { version: 1, node: node("node-a", "runtime-a", 100) },
    });
    const invalidNode = node("node-a", "runtime-a", 100);
    invalidNode.audioLegs[0]!.receivedFrames = 99;
    const invalid = await report(app, callId, invalidNode);
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
  });
});

function report(
  app: Awaited<ReturnType<typeof buildApp>>,
  callId: string,
  nodeDiagnostics: ReturnType<typeof node>,
) {
  return app.inject({
    method: "POST",
    url: `/internal/call-links/${callId}/diagnostics`,
    headers: { authorization: "Bearer internal-secret-123" },
    payload: { version: 1, node: nodeDiagnostics },
  });
}

function node(nodeId: string, runtimeId: string, startedAtMs: number) {
  return {
    nodeId,
    runtimeId,
    startedAtMs,
    endedAtMs: startedAtMs + 100,
    audioLegs: [{
      legId: "guest:1",
      speakerRole: "guest",
      dropPolicy: "drop_oldest",
      capacityFrames: 20,
      receivedFrames: 10,
      dequeuedFrames: 8,
      processedFrames: 8,
      failedFrames: 0,
      inFlightFrames: 0,
      droppedFrames: 2,
      overflowDroppedFrames: 2,
      shutdownDiscardedFrames: 0,
      sequenceGapFrames: 2,
      queueDepthFrames: 0,
      highWatermarkFrames: 20,
      backpressureEvents: 2,
    }],
    rtc: {
      attemptedSampleCount: 1,
      unavailableSampleCount: 0,
      discardedSampleCount: 0,
      samples: [{
        observedAtMs: startedAtMs + 50,
        rttMs: startedAtMs,
        jitterMs: 20,
        packetsReceived: 90,
        packetsLost: 10,
      }],
    },
    modelFingerprints: [{
      stage: "asr",
      provider: "http_asr",
      fingerprint: (nodeId === "node-a" ? "a" : "b").repeat(64),
    }],
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
