import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { DeviceCallBindingConflict } from
  "./postgres-air-device-calls.repository.js";
import { setAirDeviceCarrierEventProcessorForTests } from
  "./air-device-call.routes.js";
import { setAirDeviceHeartbeatProcessorForTests } from
  "./air-device-call.routes.js";

describe("Air device carrier event route", () => {
  const previousSecret = process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET;

  beforeEach(() => {
    process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET = secret;
    const store = getStoreSnapshot();
    store.agentCallDrafts = [];
    store.agentRuns = [];
    store.agentSteps = [];
    store.agentToolExecutions = [];
    store.usageBalances = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => {
    setAirDeviceCarrierEventProcessorForTests(null);
    setAirDeviceHeartbeatProcessorForTests(null);
    if (previousSecret === undefined) {
      delete process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET;
    } else {
      process.env.AIR_DEVICE_GATEWAY_EVENT_SECRET = previousSecret;
    }
  });

  it("accepts one fully fenced carrier event through the inbox processor", async () => {
    const processCarrierEvent = vi.fn(async () => call);
    setAirDeviceCarrierEventProcessorForTests({ processCarrierEvent });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${secret}` },
      payload: event,
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "accepted", call });
    expect(processCarrierEvent).toHaveBeenCalledWith({
      ...event,
      claimOwner: expect.stringMatching(/^air-gateway-event:/),
    });
  });

  it("rejects unauthorized and stale-binding events without mutation", async () => {
    const processCarrierEvent = vi.fn()
      .mockRejectedValue(new DeviceCallBindingConflict());
    setAirDeviceCarrierEventProcessorForTests({ processCarrierEvent });
    const app = await buildApp();

    const unauthorized = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      payload: event,
    });
    const stale = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${secret}` },
      payload: event,
    });
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("air_device_call_binding_conflict");
    expect(processCarrierEvent).toHaveBeenCalledOnce();
  });

  it("accepts LiveKit state on a separate strict event route", async () => {
    const processLiveKitParticipantEvent = vi.fn(async () => ({
      ...call,
      liveKitParticipantState: "reconnecting" as const,
    }));
    setAirDeviceCarrierEventProcessorForTests({
      processCarrierEvent: vi.fn(),
      processLiveKitParticipantEvent,
    });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/internal/device-calls/livekit-events",
      headers: { authorization: `Bearer ${secret}` },
      payload: liveKitEvent,
    });
    const conflated = await app.inject({
      method: "POST",
      url: "/internal/device-calls/livekit-events",
      headers: { authorization: `Bearer ${secret}` },
      payload: { ...liveKitEvent, carrierState: "connected" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(conflated.statusCode).toBe(400);
    expect(processLiveKitParticipantEvent).toHaveBeenCalledWith({
      ...liveKitEvent,
      claimOwner: expect.stringMatching(/^air-gateway-event:/),
    });
  });

  it("converges a connected remote hangup to one completed Agent task", async () => {
    const store = getStoreSnapshot();
    store.agentCallDrafts.push({
      id: "draft-1",
      userId: "guest-user",
      scenario: "booking",
      status: "in_progress",
      objective: "预约复诊",
      suggestedScript: "您好",
      language: "zh",
      riskLevel: "low",
      riskReasons: [],
      callId: event.communicationSessionId,
      providerCallId: event.providerCallId,
      executionProvider: "air780_volte",
      createdAt: "2026-08-04T11:00:00.000Z",
      updatedAt: "2026-08-04T12:00:00.000Z",
    });
    const terminalEvent = {
      ...event,
      eventId: "air-780-1:boot-1:3:11",
      eventSequence: 11,
      carrierState: "disconnected" as const,
      carrierCause: "remote_hangup" as const,
      occurredAt: "2026-08-04T12:00:20.500Z",
    };
    const processCarrierEvent = vi.fn(async () => ({
      ...call,
      carrierState: "disconnected" as const,
      connectedAt: "2026-08-04T12:00:10.000Z",
      endedAt: terminalEvent.occurredAt,
    }));
    setAirDeviceCarrierEventProcessorForTests({ processCarrierEvent });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/internal/device-calls/carrier-events",
      headers: { authorization: `Bearer ${secret}` },
      payload: terminalEvent,
    });
    const detail = await app.inject({
      method: "GET",
      url: "/ai-calling-agent/drafts/draft-1",
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(detail.json().draft).toMatchObject({
      status: "completed",
      consumedSeconds: 11,
    });
    expect(detail.json().draft.carrierState).toBeUndefined();
    expect(store.agentCallDrafts[0]?.providerWebhookEventIds).toHaveLength(1);
  });

  it("accepts a strict device heartbeat on its own endpoint", async () => {
    const process = vi.fn(async () => ({ leaseRenewed: true }));
    setAirDeviceHeartbeatProcessorForTests({ process });
    const app = await buildApp();
    const heartbeat = {
      eventId: "air_hb_1",
      deviceId: "air-780-1",
      bootId: "boot-1",
      firmwareVersion: "production-r2",
      protocolVersion: "vuart-v1",
      supportedSampleRates: [16000],
      heartbeatSequence: 2,
      uptimeMs: "2000",
      deviceState: "in_call",
      observedAt: "2026-08-04T12:00:02.000Z",
      activeBinding: {
        communicationSessionId: event.communicationSessionId,
        providerCallId: event.providerCallId,
        deviceId: event.deviceId,
        leaseId: event.leaseId,
        fencingToken: event.fencingToken,
        callGeneration: event.callGeneration,
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/internal/device-calls/heartbeats",
      headers: { authorization: `Bearer ${secret}` },
      payload: heartbeat,
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/internal/device-calls/heartbeats",
      headers: { authorization: `Bearer ${secret}` },
      payload: { ...heartbeat, activeBinding: undefined },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(malformed.statusCode).toBe(400);
    expect(process).toHaveBeenCalledWith(heartbeat);
  });
});

const secret = "event-secret-123456789012345678901";

const event = {
  eventId: "air-780-1:boot-1:3:10",
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  eventSequence: 10,
  carrierState: "connected" as const,
  carrierCause: "none" as const,
  occurredAt: "2026-08-04T12:00:00.000Z",
};

const liveKitEvent = {
  eventId: "air-livekit-event-11",
  communicationSessionId: event.communicationSessionId,
  providerCallId: event.providerCallId,
  deviceId: event.deviceId,
  leaseId: event.leaseId,
  fencingToken: event.fencingToken,
  callGeneration: event.callGeneration,
  eventSequence: 11,
  liveKitParticipantState: "reconnecting" as const,
  occurredAt: "2026-08-04T12:00:01.000Z",
};

const call = {
  providerCallId: event.providerCallId,
  communicationSessionId: event.communicationSessionId,
  providerOperationId: "operation-1",
  deviceId: event.deviceId,
  leaseId: event.leaseId,
  fencingToken: event.fencingToken,
  carrierState: event.carrierState,
  liveKitParticipantState: "joined" as const,
  callGeneration: event.callGeneration,
  version: 2,
};
