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
});

function payload(mode: string) {
  return {
    mode,
    sourceLanguage: "auto",
    targetLanguage: "en",
    voiceOutput: false,
  };
}
