import { describe, expect, it, vi } from "vitest";
import { HttpAirDeviceGatewayClient } from
  "./http-air-device-gateway-client.js";

describe("HTTP Air device Gateway client", () => {
  it("sends one fully fenced DIAL command with bound room access", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "ack",
      providerCallId: "air_call_1",
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const client = new HttpAirDeviceGatewayClient(config(), fetchFn);

    const result = await client.dial(dial());

    expect(result).toEqual({ providerCallId: "air_call_1", state: "dialing" });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://air-gateway.example.cn/v1/device-commands",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer gateway-secret-12345678901234567",
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "dial", ...dial() }),
      }),
    );
  });

  it("maps an ACK-loss result to reconciliation instead of redial", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "timeout_reconcile_required",
      commandId: "op-1",
    }), { status: 202, headers: { "content-type": "application/json" } }));
    const client = new HttpAirDeviceGatewayClient(config(), fetchFn);

    await expect(client.dial(dial())).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects a definite stale fence without marking it retryable", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "blocked",
      reason: "stale_fence",
    }), { status: 409, headers: { "content-type": "application/json" } }));
    const client = new HttpAirDeviceGatewayClient(config(), fetchFn);

    await expect(client.dial(dial())).rejects.toMatchObject({
      name: "DeviceCommandRejected",
    });
  });

  it.each(["command_ledger_failed", "room_not_ready"])(
    "reports a pre-dispatch %s result as not dispatched",
    async (reason) => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      status: "unavailable",
      reason,
    }), { status: 503, headers: { "content-type": "application/json" } }));
    const client = new HttpAirDeviceGatewayClient(config(), fetchFn);

    await expect(client.dial(dial())).rejects.toMatchObject({
      name: "DeviceCommandNotDispatched",
    });
    },
  );
});

function config() {
  return {
    baseUrl: "https://air-gateway.example.cn",
    apiSecret: "gateway-secret-12345678901234567",
    timeoutMs: 1_000,
  };
}

function dial() {
  return {
    providerOperationId: "op-1",
    commandId: "op-1",
    idempotencyKey: "agent-dial:session-1",
    communicationSessionId: "session-1",
    providerCallId: "air_call_1",
    deviceId: "air-001",
    leaseId: "lease-1",
    fencingToken: 3,
    callGeneration: 3,
    phoneNumberReference: "+8613800138000",
    participantIdentity: "session-1:guest:air:air-001",
    roomName: "call_session-1",
    roomAccess: {
      wsUrl: "wss://livekit.example.cn",
      token: "device-room-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      mediaPolicy: "translation_isolated" as const,
    },
  };
}
