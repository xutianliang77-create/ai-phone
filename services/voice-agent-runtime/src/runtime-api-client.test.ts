import { describe, expect, it, vi } from "vitest";
import { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import { VoiceAgentRuntimeApiError } from "./runtime-api-http.js";

describe("VoiceAgentRuntimeApiClient", () => {
  it("binds snapshot requests to the dispatched call and internal secret", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ callId: "c1" }));
    const client = createClient(fetchFn);

    await client.snapshot({
      ticket: ticket(),
      participantIdentity: "agent-worker",
      workerId: "worker-1",
      jobId: "job-1",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "http://api/internal/voice-agent/calls/c1/runtime-snapshot",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer internal-secret-value",
        }),
      }),
    );
  });

  it("uses the privileged hangup endpoint with an explicit terminal reason", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      status: "succeeded",
      replayed: false,
    }));
    const client = createClient(fetchFn);

    await client.hangup({
      snapshot: { draftId: "d1" } as never,
      ticket: ticket(),
      reason: "task_finished",
    });

    const request = fetchFn.mock.calls[0]![1]!;
    expect(fetchFn.mock.calls[0]![0]).toBe(
      "http://api/internal/ai-calling-agent/drafts/d1/tools/hangup_call/execute",
    );
    expect(JSON.parse(request.body as string)).toEqual({
      ticket: "signed-ticket",
      reason: "task_finished",
    });
  });

  it("preserves a bounded structured API code without exposing its message", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          code: "delivery_owner_stale",
          message: "private ownership diagnostics",
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));

    await expect(createClient(fetchFn).authorizeDelivery({
      snapshot: { draftId: "d1" } as never,
      ticket: ticket(),
      command: { deliveryAttemptId: "delivery-1" } as never,
    })).rejects.toMatchObject({
      name: "VoiceAgentRuntimeApiError",
      code: "delivery_owner_stale",
      statusCode: 409,
      retryable: false,
      message: expect.not.stringContaining("private ownership diagnostics"),
    });
  });

  it("falls back safely when an error body exceeds the read limit", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      "x".repeat(16 * 1024 + 1),
      { status: 503 },
    ));

    await expect(createClient(fetchFn).hangup({
      snapshot: { draftId: "d1" } as never,
      ticket: ticket(),
      reason: "runtime_failed",
    })).rejects.toEqual(expect.objectContaining<Partial<VoiceAgentRuntimeApiError>>({
      code: "voice_agent_api_http_503",
      statusCode: 503,
      retryable: true,
    }));
  });
});

function createClient(fetchFn: typeof fetch) {
  return new VoiceAgentRuntimeApiClient({
    apiBaseUrl: "http://api",
    internalApiSecret: "internal-secret-value",
    timeoutMs: 1000,
    fetchFn,
  });
}

function ticket() {
  return {
    callId: "c1",
    sessionId: "c1",
    roomName: "call_c1",
    generation: 1,
    agentName: "voice-agent-runtime",
    ticket: "signed-ticket",
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
