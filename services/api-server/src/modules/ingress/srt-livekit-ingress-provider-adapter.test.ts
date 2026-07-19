import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapterResult } from "@translation/contracts";
import { SrtLiveKitIngressProviderAdapter } from
  "./srt-livekit-ingress-provider-adapter.js";

describe("SrtLiveKitIngressProviderAdapter", () => {
  it("reconciles the bridge when LiveKit hides replayed credentials", async () => {
    const livekit = livekitFake({
      ok: true,
      provider: "livekit_ingress",
      capabilities: ["ingress"],
      result: {
        ingressId: "ingress_1",
        roomName: "room_1",
        participantIdentity: "external:source_1",
        status: "inactive",
        replayed: true,
      },
    });
    const bridge = bridgeFake();
    bridge.getByIdempotency.mockResolvedValue({
      ok: true,
      job: { bridgeId: validBridgeId, status: "running", replayed: true },
    });
    const result = await adapter(livekit, bridge).create(request);
    expect(result.ok && result.result.bridgeId).toBe(validBridgeId);
    expect(result.ok && result.result.connectionUrl).toBeUndefined();
    expect(bridge.create).not.toHaveBeenCalled();
    expect(livekit.delete).not.toHaveBeenCalled();
  });

  it("does not create a second bridge for an exact bridge replay", async () => {
    const livekit = livekitFake(successfulIngress());
    const bridge = bridgeFake();
    bridge.create.mockResolvedValue({
      ok: true,
      job: { bridgeId: validBridgeId, status: "running", replayed: true },
    });
    const result = await adapter(livekit, bridge).create(request);
    expect(result.ok && result.result.bridgeId).toBe(validBridgeId);
    expect(result.ok && result.result.replayed).toBe(true);
  });
});

const request = {
  operationId: "op_ingress",
  sessionId: "session_1",
  expectedVersion: 1,
  idempotencyKey: "ingress-create:source_1",
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  payload: {
    roomName: "room_1",
    inputType: "srt" as const,
    participantIdentity: "external:source_1",
    sourcePolicyVersion: "external-media-v1",
    enableTranscoding: true,
  },
};

const config = {
  livekitUrl: "ws://127.0.0.1:7880",
  apiKey: "key",
  apiSecret: "secret",
  requestTimeoutSeconds: 10,
  srtBridgeBaseUrl: "http://127.0.0.1:3310",
  srtBridgeApiKey: "0123456789abcdef",
};

const validBridgeId = "11111111-1111-4111-8111-111111111111";

function adapter(livekit: ReturnType<typeof livekitFake>, bridge: ReturnType<typeof bridgeFake>) {
  return new SrtLiveKitIngressProviderAdapter(config, { livekit, bridge });
}

function livekitFake(createResult: ProviderAdapterResult<{
  ingressId: string;
  roomName: string;
  participantIdentity: string;
  status: "inactive";
  connectionUrl?: string;
  streamKey?: string;
  replayed?: boolean;
}>) {
  return {
    create: vi.fn().mockResolvedValue(createResult),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
}

function bridgeFake() {
  return {
    create: vi.fn(),
    get: vi.fn(),
    getByIdempotency: vi.fn(),
    delete: vi.fn(),
  };
}

function successfulIngress(): ProviderAdapterResult<{
  ingressId: string;
  roomName: string;
  participantIdentity: string;
  status: "inactive";
  connectionUrl: string;
  streamKey: string;
}> {
  return {
    ok: true,
    provider: "livekit_ingress",
    capabilities: ["ingress"],
    result: {
      ingressId: "ingress_1",
      roomName: "room_1",
      participantIdentity: "external:source_1",
      status: "inactive",
      connectionUrl: "rtmp://ingress.example.cn/live",
      streamKey: "stream_key_123",
    },
  };
}
