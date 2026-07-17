import { describe, expect, test, vi } from "vitest";
import type { AgentDispatch } from "livekit-server-sdk";
import { LiveKitDispatchProviderAdapter } from "./livekit-dispatch-provider-adapter.js";
import type { LiveKitDispatchConfig } from "./livekit-dispatch-readiness.js";

describe("LiveKitDispatchProviderAdapter", () => {
  test("converts LiveKit dispatch nanoseconds to an ISO timestamp", async () => {
    const adapter = new LiveKitDispatchProviderAdapter(config(), {
      createDispatch: vi.fn(),
      getDispatch: vi.fn(),
      listDispatch: vi.fn(async () => [dispatch()]),
      deleteDispatch: vi.fn(),
    });

    const result = await adapter.list("call-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result[0]).toMatchObject({
      dispatchId: "dispatch-1",
      createdAt: "2026-07-17T04:57:05.930Z",
      jobIds: [],
    });
  });
});

function config(): LiveKitDispatchConfig {
  return {
    livekitUrl: "wss://livekit.example.test",
    apiKey: "key",
    apiSecret: "secret",
    ticketSecret: "ticket-secret-that-is-at-least-32-bytes",
    agentName: "translation-runtime",
    maxActiveJobs: 4,
    leaseSeconds: 45,
    heartbeatSeconds: 15,
    readyTimeoutSeconds: 20,
    requestTimeoutSeconds: 10,
    maxMetadataBytes: 2048,
  };
}

function dispatch() {
  return {
    id: "dispatch-1",
    room: "call-1",
    agentName: "translation-runtime",
    metadata: "metadata",
    state: {
      createdAt: 1_784_264_225_930_714_277n,
      jobs: [],
    },
  } as unknown as AgentDispatch;
}
