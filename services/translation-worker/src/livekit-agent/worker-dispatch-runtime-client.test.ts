import { describe, expect, it, vi } from "vitest";
import { WorkerDispatchRuntimeClient } from
  "./worker-dispatch-runtime-client.js";

const ticket = {
  v: 1 as const,
  callId: "call-1",
  sessionId: "call-1",
  roomName: "call_call-1",
  agentName: "translation-runtime",
  generation: 1,
  nonce: "nonce-1",
  iat: 1,
  exp: 2,
  ticket: "synthetic.ticket",
};
const accessSecret = "worker-tts-material-access-secret";

describe("WorkerDispatchRuntimeClient Call Link TTS material", () => {
  it("sends the separate material capability only on TTS routes and validates the echoed attempt", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new WorkerDispatchRuntimeClient({
      apiBaseUrl: "https://api.synthetic.invalid",
      internalApiSecret: "internal-api-secret",
      timeoutMs: 1000,
      fetchFn: vi.fn(async (url, init) => {
        calls.push({ url: String(url), init });
        const body = JSON.parse(String(init?.body));
        if (String(url).endsWith("worker-tts-material")) {
          return json({
            callId: "call-1",
            sessionId: "call-1",
            generation: 1,
            workerId: "worker-1",
            jobId: "job-1",
            profile: profile(),
            credentials: { secretId: "SYNTHETIC_ID", secretKey: "SYNTHETIC_KEY" },
          });
        }
        return json({
          event: body.event,
          recordedAt: "2026-09-20T00:00:00.000Z",
          costStatus: "unknown",
        });
      }),
    });
    const common = {
      ticket,
      participantIdentity: "call-1:worker:one",
      workerId: "worker-1",
      jobId: "job-1",
      credentialAccessSecret: accessSecret,
    };
    const material = await client.ttsMaterial(common);
    const event = {
      callId: "call-1",
      sessionId: "call-1",
      attemptId: "attempt-1",
      segmentId: "segment-1",
      revision: 1,
      providerId: "tencent" as const,
      modelId: material.profile.modelId,
      state: "dispatching" as const,
    };
    await client.recordTtsAttempt({ ...common, event });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.synthetic.invalid/internal/call-links/call-1/worker-tts-material",
      "https://api.synthetic.invalid/internal/call-links/call-1/worker-tts-attempt",
    ]);
    for (const call of calls) {
      expect(call.init?.headers).toMatchObject({
        authorization: "Bearer internal-api-secret",
        "x-wujie-worker-tts-credential": accessSecret,
      });
      expect(String(call.init?.body)).not.toContain(accessSecret);
    }
  });

  it("rejects a malformed material response before returning credentials", async () => {
    const client = new WorkerDispatchRuntimeClient({
      apiBaseUrl: "https://api.synthetic.invalid",
      timeoutMs: 1000,
      fetchFn: async () => json({ credentials: { secretId: "x" } }),
    });

    await expect(client.ttsMaterial({
      ticket,
      participantIdentity: "call-1:worker:one",
      workerId: "worker-1",
      jobId: "job-1",
      credentialAccessSecret: accessSecret,
    })).rejects.toThrow("material binding is invalid");
  });
});

function profile() {
  return {
    providerId: "tencent",
    protocol: "tencent_tts_ws",
    endpoint: "wss://tts.cloud.tencent.com/stream_wsv2",
    modelId: "service:tencent_tts_ws",
    appId: "10001",
    voice: "101001",
    volume: 4,
    timeoutMs: 1000,
    sampleRate: 16000,
  };
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
