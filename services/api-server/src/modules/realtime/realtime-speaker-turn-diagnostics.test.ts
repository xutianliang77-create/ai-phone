import { describe, expect, it } from "vitest";
import {
  isSpeakerTurnDiagnostics,
  sanitizedSpeakerTurns,
} from "./realtime-speaker-turn-diagnostics.js";

describe("realtime speaker turn coordinator diagnostics", () => {
  it("accepts and sanitizes bounded coordinator decision counters", () => {
    const value = {
      ...baseDiagnostics(),
      confirmedBoundaryCount: 2,
      coordinatorDecisionCounts: {
        no_span: 3,
        overlap_only: 2,
        missing_confidence: 1,
        evidence_too_short: 4,
        dominance_too_low: 5,
        novel_confidence_too_low: 6,
        known_confidence_too_low: 7,
        current_speaker: 8,
        candidate_reset_label: 9,
        candidate_reset_start_drift: 10,
        stable_window_pending: 11,
        initial_speaker_confirmed: 1,
        boundary_confirmed: 2,
      },
      confirmedSpeakerCount: 2,
      rawSpans: [{ speakerId: "must-not-survive" }],
      transcript: "must-not-survive",
    };

    expect(isSpeakerTurnDiagnostics(value)).toBe(true);
    const sanitized = sanitizedSpeakerTurns(value);
    expect(sanitized.coordinatorDecisionCounts).toEqual(
      value.coordinatorDecisionCounts,
    );
    expect(sanitized.confirmedSpeakerCount).toBe(2);
    expect(sanitized).not.toHaveProperty("rawSpans");
    expect(sanitized).not.toHaveProperty("transcript");
  });

  it("keeps legacy payloads valid when coordinator counters are absent", () => {
    expect(isSpeakerTurnDiagnostics(baseDiagnostics())).toBe(true);
  });

  it("rejects unknown, negative, fractional, and non-object counters", () => {
    for (const coordinatorDecisionCounts of [
      { unknown_reason: 1 },
      { no_span: -1 },
      { no_span: 1.5 },
      [],
      "no_span=1",
    ]) {
      expect(isSpeakerTurnDiagnostics({
        ...baseDiagnostics(),
        coordinatorDecisionCounts,
        confirmedSpeakerCount: 0,
      })).toBe(false);
    }
    expect(isSpeakerTurnDiagnostics({
      ...baseDiagnostics(),
      confirmedSpeakerCount: -1,
    })).toBe(false);
  });

  it("rejects inconsistent or out-of-range coordinator summaries", () => {
    expect(isSpeakerTurnDiagnostics({
      ...baseDiagnostics(),
      coordinatorDecisionCounts: { no_span: 3 },
      confirmedSpeakerCount: 0,
    })).toBe(true);
    const valid = {
      ...baseDiagnostics(),
      confirmedBoundaryCount: 1,
      coordinatorDecisionCounts: {
        initial_speaker_confirmed: 1,
        boundary_confirmed: 1,
      },
      confirmedSpeakerCount: 2,
    };
    expect(isSpeakerTurnDiagnostics(valid)).toBe(true);

    for (const invalid of [
      { ...valid, confirmedSpeakerCount: 5 },
      {
        ...valid,
        coordinatorDecisionCounts: {
          ...valid.coordinatorDecisionCounts,
          boundary_confirmed: 0,
        },
      },
      {
        ...valid,
        coordinatorDecisionCounts: {
          ...valid.coordinatorDecisionCounts,
          initial_speaker_confirmed: 2,
        },
      },
      { ...valid, confirmedSpeakerCount: 0 },
      {
        ...valid,
        coordinatorDecisionCounts: { boundary_confirmed: 1 },
      },
      { ...valid, confirmedSpeakerCount: undefined },
    ]) {
      expect(isSpeakerTurnDiagnostics(invalid)).toBe(false);
    }
  });
});

function baseDiagnostics() {
  return {
    confirmedBoundaryCount: 0,
    commitHitCount: 0,
    commitMissCount: 0,
    commitErrorCount: 0,
    endpointRaceCount: 0,
    averageConfirmationLatencyMs: 0,
    maxConfirmationLatencyMs: 0,
    committedAudioMs: 0,
    endpointReasons: {},
  };
}
