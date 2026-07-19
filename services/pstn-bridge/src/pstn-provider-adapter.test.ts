import { describe, expect, it, vi } from "vitest";
import { PstnProviderAdapter } from "./pstn-provider-adapter.js";
import type { PstnProvider } from "./types.js";

describe("PSTN provider adapter", () => {
  it("normalizes a legacy call result into the unified adapter contract", async () => {
    const delegate = fakeProvider();
    const adapter = new PstnProviderAdapter("fonoster", delegate);

    const result = await adapter.execute({
      operationId: "operation-1",
      sessionId: "call-1",
      expectedVersion: 1,
      idempotencyKey: "pstn:place:call-1",
      deadlineAt: "2026-07-17T00:00:00.000Z",
      payload: callRequest(),
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "pstn_fonoster",
      externalOperationId: "provider-call-1",
      externalResourceId: "stream-1",
      capabilities: ["sip_outbound", "publish_audio"],
    });
  });

  it("keeps the production PstnProvider surface while routing through execute", async () => {
    const delegate = fakeProvider();
    const adapter = new PstnProviderAdapter("http", delegate);
    const execute = vi.spyOn(adapter, "execute");

    const result = await adapter.placeCall(callRequest());

    expect(result.providerCallId).toBe("provider-call-1");
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "pstn:place:call-1",
      idempotencyKey: "pstn:place:call-1",
      payload: callRequest(),
    }));
  });

  it("classifies upstream errors without exposing their message", async () => {
    const delegate = fakeProvider();
    vi.mocked(delegate.placeCall).mockRejectedValueOnce(
      new Error("provider credential secret"),
    );
    const adapter = new PstnProviderAdapter("http", delegate);

    const result = await adapter.execute({
      operationId: "operation-1",
      sessionId: "call-1",
      expectedVersion: 1,
      idempotencyKey: "pstn:place:call-1",
      deadlineAt: "2026-07-17T00:00:00.000Z",
      payload: callRequest(),
    });

    expect(result).toMatchObject({
      ok: false,
      provider: "pstn_http",
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: true,
    });
    expect(JSON.stringify(result)).not.toContain("credential");
  });
});

function fakeProvider(): PstnProvider {
  return {
    placeCall: vi.fn(async () => ({
      status: "in_progress" as const,
      providerCallId: "provider-call-1",
      mediaStreamId: "stream-1",
    })),
    playTranslatedAudio: vi.fn(async () => ({ status: "queued" as const })),
  };
}

function callRequest() {
  return {
    idempotencyKey: "pstn:place:call-1",
    draftId: "draft-1",
    callId: "call-1",
    targetPhone: "13800138000",
    objective: "book a table",
    suggestedScript: "hello",
    language: "zh",
  };
}
