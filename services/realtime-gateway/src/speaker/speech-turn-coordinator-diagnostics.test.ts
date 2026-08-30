import { describe, expect, it } from "vitest";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import { SpeechTurnCoordinator } from "./speech-turn-coordinator.js";

describe("speech turn coordinator diagnostics", () => {
  it("distinguishes bounded evidence rejection reasons", () => {
    expect(reasonAfter([])).toEqual({ no_span: 1 });
    expect(reasonAfter([
      span("speaker_1", 0, 240, { overlap: true }),
    ])).toEqual({ overlap_only: 1 });
    expect(reasonAfter([
      span("speaker_1", 0, 240, { confidence: undefined }),
    ])).toEqual({ missing_confidence: 1 });
    expect(reasonAfter([span("speaker_1", 0, 239)])).toEqual({
      evidence_too_short: 1,
    });
    expect(reasonAfter([
      span("speaker_1", 0, 240),
      span("speaker_2", 0, 240, { confidence: 0.8 }),
    ])).toEqual({ dominance_too_low: 1 });

    const novel = establishedCoordinator();
    novel.observe("sess_1", [
      span("speaker_2", 240, 480, { confidence: 0.69 }),
    ]);
    expect(counts(novel)).toMatchObject({ novel_confidence_too_low: 1 });

    const known = establishedCoordinator();
    known.observe("sess_1", [span("speaker_2", 240, 480)]);
    known.observe("sess_1", [span("speaker_2", 240, 720)]);
    known.observe("sess_1", [
      span("speaker_1", 720, 960, { confidence: 0.59 }),
    ]);
    expect(counts(known)).toMatchObject({ known_confidence_too_low: 1 });
  });

  it("distinguishes candidate resets, pending windows, and confirmations", () => {
    const confirmed = new SpeechTurnCoordinator();
    confirmed.observe("sess_1", [span("speaker_1", 0, 240)]);
    confirmed.observe("sess_1", [span("speaker_1", 0, 480)]);
    confirmed.observe("sess_1", [span("speaker_2", 480, 720)]);
    confirmed.observe("sess_1", [span("speaker_2", 480, 960)]);
    expect(confirmed.diagnostics("sess_1")).toEqual({
      coordinatorDecisionCounts: {
        initial_speaker_confirmed: 1,
        current_speaker: 1,
        stable_window_pending: 1,
        boundary_confirmed: 1,
      },
      confirmedSpeakerCount: 2,
    });

    const labelReset = establishedCoordinator();
    labelReset.observe("sess_1", [span("speaker_2", 480, 720)]);
    labelReset.observe("sess_1", [span("speaker_3", 720, 960)]);
    expect(counts(labelReset)).toMatchObject({ candidate_reset_label: 1 });

    const driftReset = establishedCoordinator();
    driftReset.observe("sess_1", [span("speaker_2", 480, 720)]);
    driftReset.observe("sess_1", [span("speaker_2", 720, 1040)]);
    expect(counts(driftReset)).toMatchObject({
      candidate_reset_start_drift: 1,
    });
  });

  it("counts a provider no-span observation without resetting a candidate", () => {
    const coordinator = establishedCoordinator();
    coordinator.observe("sess_1", [span("speaker_2", 480, 720)]);
    coordinator.recordNoSpanObservation("sess_1");

    expect(coordinator.observe(
      "sess_1",
      [span("speaker_2", 480, 960)],
    )?.nextSpeakerId).toBe("speaker_2");
    expect(counts(coordinator)).toMatchObject({
      no_span: 1,
      boundary_confirmed: 1,
    });
  });
});

function reasonAfter(spans: SpeakerSpan[]) {
  const coordinator = new SpeechTurnCoordinator();
  coordinator.observe("sess_1", spans);
  return counts(coordinator);
}

function establishedCoordinator() {
  const coordinator = new SpeechTurnCoordinator();
  coordinator.observe("sess_1", [span("speaker_1", 0, 240)]);
  return coordinator;
}

function counts(coordinator: SpeechTurnCoordinator) {
  return coordinator.diagnostics("sess_1")?.coordinatorDecisionCounts;
}

function span(
  speakerId: string,
  startMs: number,
  endMs: number,
  overrides: Partial<SpeakerSpan> = {},
): SpeakerSpan {
  return {
    speakerId,
    startMs,
    endMs,
    confidence: 0.9,
    final: false,
    ...overrides,
  };
}
