import { describe, expect, it, vi } from "vitest";
import { IngressInput, type IngressInfo } from "livekit-server-sdk";
import { LiveKitIngressProviderAdapter } from
  "./livekit-ingress-provider-adapter.js";

const request = {
  operationId: "op_ingress",
  sessionId: "session_1",
  expectedVersion: 1,
  idempotencyKey: "ingress-create:source_1",
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  payload: {
    roomName: "room_1",
    inputType: "rtmp" as const,
    participantIdentity: "external:source_1",
    sourcePolicyVersion: "external-media-v1",
    enableTranscoding: true,
  },
};

describe("LiveKitIngressProviderAdapter", () => {
  it("reconciles an existing deterministic participant before create", async () => {
    const existing = ingressInfo();
    const createIngress = vi.fn();
    const adapter = new LiveKitIngressProviderAdapter(config, {
      createIngress,
      listIngress: vi.fn().mockResolvedValue([existing]),
      deleteIngress: vi.fn(),
    });
    const result = await adapter.create(request);
    expect(result.ok && result.result.replayed).toBe(true);
    expect(result.ok && result.result.ingressId).toBe("ingress_1");
    expect(createIngress).not.toHaveBeenCalled();
  });

  it("creates only after an empty reconciliation lookup", async () => {
    const createIngress = vi.fn().mockResolvedValue(ingressInfo());
    const adapter = new LiveKitIngressProviderAdapter(config, {
      createIngress,
      listIngress: vi.fn().mockResolvedValue([]),
      deleteIngress: vi.fn(),
    });
    const result = await adapter.create(request);
    expect(result.ok).toBe(true);
    expect(createIngress).toHaveBeenCalledWith(
      IngressInput.RTMP_INPUT,
      expect.objectContaining({ roomName: "room_1" }),
    );
  });
});

const config = {
  livekitUrl: "ws://127.0.0.1:7880",
  apiKey: "key",
  apiSecret: "secret",
  requestTimeoutSeconds: 10,
};

function ingressInfo() {
  return {
    ingressId: "ingress_1",
    roomName: "room_1",
    participantIdentity: "external:source_1",
    url: "rtmp://ingress.example.cn/live",
    streamKey: "stream_key_123",
  } as IngressInfo;
}
