import { describe, expect, it } from "vitest";
import { publicProcessingDiagnostics } from "./public-processing-diagnostics.js";

describe("public processing diagnostics", () => {
  it("separates device ownership, public execution, provider usage, and server settlement", () => {
    const value = publicProcessingDiagnostics(session());

    expect(value.ownership).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: "asr", owner: "public", confirmedAttemptCount: 1, providerIds: ["tencent"], modelIds: ["16k_en"] }),
      expect.objectContaining({ component: "translation", owner: "public", confirmedAttemptCount: 2 }),
      expect.objectContaining({ component: "tts", owner: "disabled", publicAttemptCount: 0 }),
    ]));
    expect(value.totals).toMatchObject({ publicComponentCount: 2, deviceComponentCount: 0, disabledComponentCount: 1, publicAttemptCount: 3, confirmedPublicAttemptCount: 3, duplicateConfirmedComputeCount: 1, unexpectedPublicAttemptCount: 0 });
    expect(value.providerUsage).toMatchObject({ reported: { audioSeconds: 29, promptTokens: 5, totalTokens: 8 }, moneyCostStatus: "unknown", reconciliation: { providerId: "tencent", providerUsageSeconds: 29 } });
    expect(value.finalization).toEqual({ serverConsumedSeconds: 31, finalizationPersisted: true, originalRuntimeUncertain: true });
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(JSON.stringify(value)).not.toContain("transcript");
  });

  it("flags public work on a device-owned component and never fabricates a money cost", () => {
    const input = session();
    input.processingAuthorization.executionPlan.asr.execution = "device";
    const value = publicProcessingDiagnostics(input);

    expect(value.ownership.find((item) => item.component === "asr")).toMatchObject({ owner: "device" });
    expect(value.totals).toMatchObject({ publicComponentCount: 1, deviceComponentCount: 1, unexpectedPublicAttemptCount: 1 });
    expect(value.providerUsage.moneyCostStatus).toBe("unknown");
  });
});

function session(): any {
  const attempt = (component: "asr" | "translation", attemptId: string, usage?: Record<string, number>) => ({
    ownerId: "owner", deploymentId: "public", createdAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:01.000Z",
    event: { sessionId: "s", leaseId: "lease", attemptId, segmentId: component === "asr" ? "seg-asr" : "seg-mt", revision: 1, component, providerId: "tencent", modelId: component === "asr" ? "16k_en" : "service:tencent_tmt", state: "confirmed", ...(component === "asr" ? { audioStartSample: 0, audioEndSample: 464000, audioSampleRate: 16000 } : {}), ...(usage ? { metadata: { usage } } : {}) },
  });
  return {
    id: "s", status: "ended", consumedSeconds: 31,
    processingAuthorization: { executionPlan: { asr: { execution: "public" }, translation: { execution: "public" }, tts: { execution: "disabled" } } },
    publicModelAttempts: [attempt("asr", "a", { audioSeconds: 29 }), attempt("translation", "b", { promptTokens: 5, totalTokens: 8 }), attempt("translation", "c")],
    publicProviderReconciliation: { providerId: "tencent", evidenceScope: "isolated_candidate_day", providerUsageCount: 1, providerUsageSeconds: 29 },
    publicRuntime: { uncertain: true }, publicFinalization: { ack: {} },
  };
}
