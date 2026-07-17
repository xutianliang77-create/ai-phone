import { describe, expect, it, vi } from "vitest";
import { LiveKitSipProviderAdapter } from "./livekit-sip-provider-adapter.js";
import type { LiveKitSipConfig } from "./livekit-sip-readiness.js";

describe("LiveKit SIP provider adapter", () => {
  it("creates one bounded, privacy-preserving SIP participant", async () => {
    const client = fakeClient();
    const adapter = new LiveKitSipProviderAdapter(config(), client);

    const result = await adapter.createParticipant(request());

    expect(result).toMatchObject({
      ok: true,
      provider: "livekit_sip",
      externalOperationId: "sip-call-1",
      externalResourceId: "PA_1",
    });
    expect(client.createSipParticipant).toHaveBeenCalledWith(
      "ST_testtrunk",
      "+8613800000000",
      "call_session-1",
      expect.objectContaining({
        hidePhoneNumber: true,
        waitUntilAnswered: false,
        ringingTimeout: 45,
        maxCallDuration: 3600,
        timeout: 10,
        participantMetadata: JSON.stringify({
          callId: "session-1",
          participantRole: "guest",
          joinType: "sip",
        }),
        participantAttributes: {
          "translation.operationId": "op-1",
          "translation.sessionId": "session-1",
          "translation.role": "guest",
        },
      }),
    );
  });

  it("rejects invalid numbers before reaching LiveKit", async () => {
    const client = fakeClient();
    const adapter = new LiveKitSipProviderAdapter(config(), client);

    const result = await adapter.createParticipant(request({
      payload: { ...request().payload, phoneNumberReference: "13800000000" },
    }));

    expect(result).toMatchObject({ ok: false, errorClass: "invalid_request" });
    expect(client.createSipParticipant).not.toHaveBeenCalled();
  });

  it("marks timeouts unknown so reconciliation must decide the outcome", async () => {
    const client = fakeClient();
    const timeout = new Error("provider detail must not escape");
    timeout.name = "TimeoutError";
    client.createSipParticipant.mockRejectedValueOnce(timeout);
    const adapter = new LiveKitSipProviderAdapter(config(), client);

    const result = await adapter.createParticipant(request());

    expect(result).toEqual({
      ok: false,
      provider: "livekit_sip",
      errorClass: "timeout",
      retryable: true,
      reconciliationRequired: true,
    });
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });
});

function fakeClient() {
  return {
    createSipParticipant: vi.fn(async () => ({
      participantId: "PA_1",
      participantIdentity: "session-1:guest:sip:op-1",
      roomName: "call_session-1",
      sipCallId: "sip-call-1",
    })),
    transferSipParticipant: vi.fn(async () => {}),
  };
}

function request(overrides = {}) {
  return {
    operationId: "op-1",
    sessionId: "session-1",
    expectedVersion: 1,
    idempotencyKey: "sip-outbound:session-1",
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    payload: {
      roomName: "call_session-1",
      phoneNumberReference: "+8613800000000",
      participantIdentity: "session-1:guest:sip:op-1",
    },
    ...overrides,
  };
}

function config(): LiveKitSipConfig {
  return {
    livekitUrl: "wss://livekit.qkxy.cn",
    apiKey: "livekit_key",
    apiSecret: "livekit_secret_12345678901234567",
    outboundTrunkId: "ST_testtrunk",
    ringingTimeoutSeconds: 45,
    maxCallDurationSeconds: 3600,
    requestTimeoutSeconds: 10,
  };
}
