import { describe, expect, it, vi } from "vitest";
import { LiveKitRoomProviderAdapter } from "./livekit-room-provider-adapter.js";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";

describe("LiveKit room provider adapter", () => {
  it("applies bounded room resources and caches an ensured room", async () => {
    const client = fakeClient();
    const adapter = new LiveKitRoomProviderAdapter(config(), client);
    const request = ensureRequest();

    const first = await adapter.ensureRoom(request);
    const repeated = await adapter.ensureRoom(request);

    expect(first).toMatchObject({
      ok: true,
      provider: "livekit",
      externalResourceId: "call_1",
    });
    expect(repeated.ok).toBe(true);
    expect(client.createRoom).toHaveBeenCalledTimes(1);
    expect(client.createRoom).toHaveBeenCalledWith({
      name: "call_1",
      emptyTimeout: 300,
      maxParticipants: 3,
    });
  });

  it("normalizes provider failure without leaking provider details", async () => {
    const client = fakeClient();
    client.createRoom.mockRejectedValueOnce(new Error("socket secret detail"));
    const adapter = new LiveKitRoomProviderAdapter(config(), client);

    const result = await adapter.ensureRoom(ensureRequest());

    expect(result).toEqual({
      ok: false,
      provider: "livekit",
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: false,
    });
    expect(JSON.stringify(result)).not.toContain("socket secret detail");
  });

  it("publishes reliable topic-bound data through the adapter", async () => {
    const client = fakeClient();
    const adapter = new LiveKitRoomProviderAdapter(config(), client);

    await adapter.publish("call_1", new Uint8Array([1, 2]), "translation.captions");

    expect(client.sendData).toHaveBeenCalledWith(
      "call_1",
      new Uint8Array([1, 2]),
      expect.anything(),
      { topic: "translation.captions" },
    );
  });

  it("removes a rejected duplicate participant", async () => {
    const client = fakeClient();
    const adapter = new LiveKitRoomProviderAdapter(config(), client);

    await adapter.removeParticipant("call_1", "call_1:guest:duplicate");

    expect(client.removeParticipant).toHaveBeenCalledWith(
      "call_1",
      "call_1:guest:duplicate",
    );
  });
});

function fakeClient() {
  return {
    createRoom: vi.fn(async () => ({})),
    listParticipants: vi.fn(async () => []),
    removeParticipant: vi.fn(async () => ({})),
    sendData: vi.fn(async () => ({})),
  };
}

function ensureRequest() {
  return {
    operationId: "room:ensure:call_1",
    sessionId: "1",
    expectedVersion: 1,
    idempotencyKey: "room:ensure:call_1",
    deadlineAt: "2026-07-17T00:00:00.000Z",
    payload: { roomName: "call_1" },
  };
}

function config(): LiveKitRoomConfig {
  return {
    livekitUrl: "wss://livekit.example.cn",
    apiKey: "key",
    apiSecret: "secret",
    tokenTtlSeconds: 120,
    resourceLimits: {
      guestTicketTtlSeconds: 300,
      maxParticipants: 3,
      maxSessionSeconds: 3600,
      emptyTimeoutSeconds: 300,
      maxDataPacketBytes: 12_288,
      maxEventsPerRequest: 20,
      maxEventRequestsPerSecond: 40,
      maxParticipantNameCharacters: 80,
    },
  };
}
