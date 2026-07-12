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
