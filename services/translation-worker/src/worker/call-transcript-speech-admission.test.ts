import { describe, expect, it } from "vitest";
import { CallTranscriptSpeechAdmission } from
  "./call-transcript-speech-admission.js";
import type { CallVadDecision } from "./types.js";

describe("CallTranscriptSpeechAdmission", () => {
  it("rejects a transcript backed only by explicit silence decisions", () => {
    const admission = new CallTranscriptSpeechAdmission();
    admission.observe(decision({ sequence: 1, voiced: false }));
    admission.observe(decision({ sequence: 2, voiced: false }));

    expect(admission.consume("call-1", "guest"))
      .toBe("rejected_explicit_silence");
  });

  it("admits a transcript when any current-segment frame is voiced", () => {
    const admission = new CallTranscriptSpeechAdmission();
    admission.observe(decision({ sequence: 1, voiced: true }));
    admission.observe(decision({ sequence: 2, voiced: false }));

    expect(admission.consume("call-1", "guest")).toBe("admitted_voiced");
  });

  it("keeps providers without VAD evidence backward compatible", () => {
    const admission = new CallTranscriptSpeechAdmission();
    expect(admission.consume("call-1", "guest"))
      .toBe("admitted_unverified");
  });

  it("consumes evidence once and ignores stale decisions", () => {
    const admission = new CallTranscriptSpeechAdmission();
    admission.observe(decision({ sequence: 4, voiced: false }));
    admission.observe(decision({ sequence: 4, voiced: true }));
    admission.observe(decision({ sequence: 3, voiced: true }));
    expect(admission.consume("call-1", "guest"))
      .toBe("rejected_explicit_silence");
    expect(admission.consume("call-1", "guest"))
      .toBe("admitted_unverified");
  });
});

function decision(
  value: Pick<CallVadDecision, "sequence" | "voiced">,
): CallVadDecision {
  return {
    callId: "call-1",
    speakerRole: "guest",
    timestampMs: value.sequence * 20,
    durationMs: 20,
    provider: "test-vad",
    fallback: false,
    preRollMs: 0,
    ...value,
  };
}
