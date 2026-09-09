import { describe, expect, it } from "vitest";
import { matchesRealtimeResultOperation, parseRealtimeProcessingRequest,
  processingMatchesSession, publicModelComponents } from "./processing-contract.js";
import type { RealtimeProcessingRequest } from "./processing-contract.js";

function processing(): RealtimeProcessingRequest {
  return {
    contractVersion: 1, processingMode: "online", modelPolicyRevision: "policy-r6-test",
    languagePolicy: { source: "fr", target: "ja", autoReverse: true, pair: ["fr", "ja"], revision: 2 },
    executionPlan: {
      asr: { execution: "public", scopeKey: "public/asr/fr/r1", reason: "online_selected" },
      translation: { execution: "public", scopeKey: "public/mt/fr-ja/r1", reason: "online_selected" },
      tts: { execution: "public", scopeKey: "public/tts/ja/voice1/r1", reason: "online_selected" },
    },
    syncRequested: true,
  };
}

describe("versioned realtime processing contract", () => {
  it("accepts auto source with a fixed target and no reverse pair", () => {
    const input = processing();
    input.languagePolicy = { source: "auto", target: "ja", autoReverse: false, revision: 1 };
    const parsed = parseRealtimeProcessingRequest(input);
    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") expect(parsed.value.languagePolicy).not.toHaveProperty("pair");
    input.languagePolicy.autoReverse = true;
    expect(parseRealtimeProcessingRequest(input).status).toBe("invalid");
  });
  it("keeps absent metadata legacy without silently accepting malformed metadata", () => {
    expect(parseRealtimeProcessingRequest(undefined)).toEqual({ status: "legacy" });
    for (const input of [null, true, [], {}, "online"]) {
      expect(parseRealtimeProcessingRequest(input).status).toBe("invalid");
    }
  });
  it("keeps the exact language pair and routes all enabled online model components to public", () => {
    const input = processing(); const before = structuredClone(input);
    const parsed = parseRealtimeProcessingRequest(input);
    expect(parsed).toEqual({ status: "valid", value: input });
    expect(publicModelComponents(input.executionPlan)).toEqual(["asr", "translation", "tts"]);
    if (parsed.status !== "valid") throw Error("expected valid");
    expect(parsed.value.languagePolicy.pair).not.toBe(input.languagePolicy.pair);
    parsed.value.languagePolicy = { ...parsed.value.languagePolicy, pair: ["en", "ja"] };
    parsed.value.executionPlan.asr.scopeKey = "changed";
    expect(input).toEqual(before);
  });
  it("accepts a fully device local plan without any server permission", () => {
    const input = processing(); input.processingMode = "local"; input.syncRequested = false;
    input.executionPlan.asr = { execution: "device", scopeKey: "phone/asr/fr/r1" };
    input.executionPlan.translation = { execution: "device", scopeKey: "phone/mt/fr-ja/r1" };
    input.executionPlan.tts = { execution: "disabled" };
    expect(parseRealtimeProcessingRequest(input).status).toBe("valid");
    input.syncRequested = true;
    expect(parseRealtimeProcessingRequest(input)).toMatchObject({ status: "invalid", reason: "local_processing_cannot_use_cloud" });
    input.syncRequested = false; input.executionPlan.translation = processing().executionPlan.translation;
    expect(parseRealtimeProcessingRequest(input).status).toBe("invalid");
  });
  it("rejects mixed device/public inference when the user selects online", () => {
    for (const component of ["asr", "translation", "tts"] as const) {
      const input = processing();
      input.executionPlan[component] = { execution: "device", scopeKey: "phone/" + component };
      expect(parseRealtimeProcessingRequest(input)).toMatchObject({ status: "invalid", reason: "online_processing_requires_public_models" });
    }
    const input = processing(); input.executionPlan.tts = { execution: "disabled" };
    expect(parseRealtimeProcessingRequest(input).status).toBe("valid");
  });
  it.each(["server", "hybrid", "onDevice", "private_cloud"])("rejects the non-product mode %s", (mode) => {
    expect(parseRealtimeProcessingRequest({ ...processing(), processingMode: mode }).status).toBe("invalid");
  });
  it.each([0, 2, "1", null])("rejects unsupported wire version %s", (contractVersion) => {
    expect(parseRealtimeProcessingRequest({ ...processing(), contractVersion })).toMatchObject({ reason: "unsupported_processing_contract_version" });
  });
  it("rejects server grants, credentials and unexpected nested fields in a request", () => {
    for (const key of ["publicAccess", "publicGrantRef", "syncPermission", "apiKey", "ownerId"]) {
      expect(parseRealtimeProcessingRequest({ ...processing(), [key]: true }).status).toBe("invalid");
    }
    const input = processing();
    expect(parseRealtimeProcessingRequest({ ...input, languagePolicy: { ...input.languagePolicy, qualified: true } }).status).toBe("invalid");
    expect(parseRealtimeProcessingRequest({ ...input, executionPlan: { ...input.executionPlan, speaker: { execution: "public" } } }).status).toBe("invalid");
  });
  it("rejects malformed, ambiguous and incomplete component plans", () => {
    for (const bad of [null, [], { execution: "device", scopeKey: "" },
      { execution: "device", scopeKey: "key", reason: "runtime_failure" },
      { execution: "public", scopeKey: "key" },
      { execution: "public", scopeKey: "key", reason: "not_evaluated" },
      { execution: "disabled" }, { execution: "both", scopeKey: "key" },
      { execution: "device", scopeKey: "x".repeat(241) }]) {
      const input = processing();
      expect(parseRealtimeProcessingRequest({ ...input, executionPlan: { ...input.executionPlan, asr: bad } }).status).toBe("invalid");
    }
  });
  it("rejects unsupported languages and pair conflicts without a fallback language", () => {
    const input = processing();
    for (const languagePolicy of [
      { ...input.languagePolicy, target: "invalid" },
      { ...input.languagePolicy, source: "en" },
      { ...input.languagePolicy, target: "en" },
      { ...input.languagePolicy, pair: ["fr", "fr"] },
      { ...input.languagePolicy, revision: -1 },
      { ...input.languagePolicy, source: "ja", autoReverse: false },
    ]) expect(parseRealtimeProcessingRequest({ ...input, languagePolicy }).status).toBe("invalid");
  });
  it("binds processing settings to the original session fields", () => {
    const input = processing();
    const session = { sourceLanguage: "fr", targetLanguage: "ja", autoReverseTargetLanguage: true, voiceOutput: true };
    expect(processingMatchesSession(input, session)).toBe(true);
    for (const patch of [{ sourceLanguage: "en" }, { targetLanguage: "zh" },
      { autoReverseTargetLanguage: false }, { voiceOutput: false }]) {
      expect(processingMatchesSession(input, { ...session, ...patch })).toBe(false);
    }
  });
});

describe("sync and finalize operation boundaries", () => {
  it("keeps legacy operation semantics when no new tag exists", () => {
    expect(matchesRealtimeResultOperation({ segments: [] }, "sync")).toBe(true);
    expect(matchesRealtimeResultOperation({ segments: [], billableSeconds: 7 }, "finalize")).toBe(true);
  });
  it("never treats a sync operation as finalize or a finalize operation as sync", () => {
    expect(matchesRealtimeResultOperation({ operation: "sync", segments: [] }, "finalize")).toBe(false);
    expect(matchesRealtimeResultOperation({ sync: {}, segments: [] }, "finalize")).toBe(false);
    expect(matchesRealtimeResultOperation({ operation: "finalize", segments: [] }, "sync")).toBe(false);
    for (const key of ["billableSeconds", "idempotencyKey", "stopWatermark"]) {
      expect(matchesRealtimeResultOperation({ operation: "sync", [key]: 0, segments: [] }, "sync")).toBe(false);
    }
  });
  it("fails closed on invalid payloads and operation tags", () => {
    for (const input of [null, [], { operation: null }, { operation: "unknown" }]) {
      expect(matchesRealtimeResultOperation(input, "sync")).toBe(false);
      expect(matchesRealtimeResultOperation(input, "finalize")).toBe(false);
    }
  });
});
