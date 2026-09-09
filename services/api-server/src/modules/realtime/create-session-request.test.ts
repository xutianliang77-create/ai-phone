import { describe, expect, it } from "vitest";
import { validateCreateRealtimeSessionRequest } from "./create-session-request.js";

describe("create realtime session request", () => {
  it("defaults conversation and listening-style modes to four speakers", () => {
    for (const mode of ["conversation", "meeting", "classroom", "business"]) {
      const result = validateCreateRealtimeSessionRequest(payload(mode));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.speakerAttribution).toEqual({
          mode: "auto",
          maxSpeakers: 4,
          allowVoiceIdentity: false,
        });
      }
    }
  });

  it("normalizes old two-speaker auto clients to model capacity", () => {
    const result = validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      speakerAttribution: { mode: "auto", maxSpeakers: 2 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.speakerAttribution?.maxSpeakers).toBe(4);
    }
  });

  it("does not apply a diarization capacity to participant tracks", () => {
    const result = validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      speakerAttribution: { mode: "participant_track", maxSpeakers: 2 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.speakerAttribution).toEqual({
        mode: "participant_track",
      });
    }
  });

  it("keeps a valid natural voice preset id", () => {
    const result = validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      voiceOutput: true,
      voice: { mode: "preset", presetId: "zh_female_natural" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.voice).toEqual({
        mode: "preset",
        presetId: "zh_female_natural",
        quality: "standard",
      });
    }
  });

  it("rejects an invalid natural voice preset id", () => {
    const result = validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      voiceOutput: true,
      voice: { mode: "preset", presetId: "../../voice" },
    });

    expect(result.ok).toBe(false);
  });

  it("keeps supported session-scoped domain lexicon packs", () => {
    const result = validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      domainLexiconPacks: ["product", "technology", "technology"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domainLexiconPacks).toEqual(["product", "technology"]);
    }
  });

  it("rejects unsupported or empty domain lexicon selections", () => {
    expect(validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      domainLexiconPacks: [],
    }).ok).toBe(false);
    expect(validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      domainLexiconPacks: ["legal"],
    }).ok).toBe(false);
    expect(validateCreateRealtimeSessionRequest({
      ...payload("conversation"),
      domainLexiconPacks: ["cultivation"],
    }).ok).toBe(false);
  });

  it("preserves legacy parsing without new processing fields", () => {
    const result = validateCreateRealtimeSessionRequest(payload("conversation"));
    if (!result.ok) throw Error("expected legacy request");
    expect(result.value).not.toHaveProperty("processing");
  });

  it("validates additive processing metadata and binds original settings", () => {
    const base = payload("meeting");
    const processing = {
      contractVersion: 1, processingMode: "online", modelPolicyRevision: "test-policy",
      languagePolicy: { source: "auto", target: "en", autoReverse: false, pair: ["zh", "en"], revision: 1 },
      executionPlan: { asr: { execution: "public", scopeKey: "asr/zh-en", reason: "online_selected" },
        translation: { execution: "public", scopeKey: "mt/zh-en", reason: "online_selected" }, tts: { execution: "disabled" } },
      syncRequested: true,
    };
    const result = validateCreateRealtimeSessionRequest({ ...base, processing });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.processing).toEqual(processing);
    const { pair: _pair, ...withoutPair } = processing.languagePolicy;
    expect(validateCreateRealtimeSessionRequest({ ...base,
      processing: { ...processing, languagePolicy: withoutPair } }).ok).toBe(true);
    for (const patch of [{ targetLanguage: "ja" }, { sourceLanguage: "fr" },
      { voiceOutput: true }, { autoReverseTargetLanguage: true }]) {
      expect(validateCreateRealtimeSessionRequest({ ...base, ...patch, processing }).ok).toBe(false);
    }
    expect(validateCreateRealtimeSessionRequest({ ...base, processing: { ...processing, publicGrantRef: "client-forged" } }).ok).toBe(false);
  });

  it("does not silently discard incomplete or misplaced 1.1 intent", () => {
    for (const processing of [null, {}, { contractVersion: 2 }]) {
      expect(validateCreateRealtimeSessionRequest({ ...payload("conversation"), processing }).ok).toBe(false);
    }
    for (const key of ["processingMode", "executionPlan", "modelPolicyRevision", "publicAccess"]) {
      expect(validateCreateRealtimeSessionRequest({ ...payload("conversation"), [key]: "online" }).ok).toBe(false);
    }
  });
});

function payload(mode: string) {
  return {
    mode,
    sourceLanguage: "auto",
    targetLanguage: "en",
    voiceOutput: false,
  };
}
