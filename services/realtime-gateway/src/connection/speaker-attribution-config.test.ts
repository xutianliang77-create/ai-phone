import { describe, expect, it } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import { resolveSpeakerAttribution } from "./speaker-attribution-config.js";

const claims: RealtimeTokenClaims = {
  userId: "user_1",
  sessionId: "sess_1",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  voiceOutput: false,
  planCode: "free",
  maxDurationSeconds: 60,
  issuedAt: 1,
  expiresAt: 2,
};

describe("speaker attribution config", () => {
  it("enables four-speaker attribution for legacy claims", () => {
    expect(resolveSpeakerAttribution(claims)).toEqual({
      mode: "auto",
      maxSpeakers: 4,
      allowVoiceIdentity: false,
    });
  });

  it("keeps an explicit speaker configuration", () => {
    const explicit = {
      mode: "diarization" as const,
      maxSpeakers: 3 as const,
      allowVoiceIdentity: false,
    };
    expect(resolveSpeakerAttribution({
      ...claims,
      speakerAttribution: explicit,
    })).toBe(explicit);
  });
});
