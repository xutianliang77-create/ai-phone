import { describe, expect, it } from "vitest";
import {
  encodeTranslationCallControl,
  parseTranslationCallControl,
  type TranslationCallControlCommand,
} from "./translation-call-controls.js";

describe("translation call controls", () => {
  it("round trips a generation-bound type-to-speak command", () => {
    const command: TranslationCallControlCommand = {
      ...binding(),
      type: "translation.type_to_speak",
      text: "请稍等。",
      sourceLanguage: "zh",
      targetLanguage: "en",
    };

    expect(parseTranslationCallControl(
      encodeTranslationCallControl(command),
    )).toEqual(command);
  });

  it("rejects stale-shaped, oversized, and same-language commands", () => {
    expect(parseTranslationCallControl(new TextEncoder().encode(JSON.stringify({
      ...binding(),
      type: "translation.type_to_speak",
      text: "x".repeat(801),
      sourceLanguage: "zh",
      targetLanguage: "zh",
    })))).toBeNull();
    expect(parseTranslationCallControl(new TextEncoder().encode(JSON.stringify({
      ...binding(),
      type: "translation.uplink_pause",
      controlGeneration: 0,
      paused: true,
    })))).toBeNull();
  });
});

function binding() {
  return {
    version: 1 as const,
    callId: "call-1",
    dialOperationId: "dial-1",
    controlOperationId: "control-1",
    dispatchGeneration: 3,
    controlGeneration: 4,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T08:00:30.000Z",
  };
}
