import { describe, expect, it } from "vitest";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import { SpeechTurnCoordinator } from "./speech-turn-coordinator.js";

describe("speech turn coordinator", () => {
  it("establishes the first speaker without emitting a boundary", () => {
    const coordinator = new SpeechTurnCoordinator();

    expect(coordinator.observe("sess_1", [span("speaker_1", 0, 240)])).toBeNull();
    expect(coordinator.observe("sess_1", [span("speaker_1", 0, 480)])).toBeNull();
    expect(coordinator.currentSpeaker("sess_1")).toBe("speaker_1");
  });

  it("emits one boundary after a new speaker is stable for two windows", () => {
    const coordinator = establishedCoordinator();

    expect(coordinator.observe("sess_1", [span("speaker_2", 480, 720)])).toBeNull();
    expect(coordinator.observe("sess_1", [span("speaker_2", 480, 960)])).toEqual({
      previousSpeakerId: "speaker_1",
      nextSpeakerId: "speaker_2",
      boundaryMs: 480,
      confirmedAtMs: 960,
      confidence: 0.9,
      dominanceRatio: 1,
    });
    expect(coordinator.observe("sess_1", [span("speaker_2", 480, 1200)])).toBeNull();
  });

  it("rejects a one-window speaker label change", () => {
    const coordinator = establishedCoordinator();

    expect(coordinator.observe("sess_1", [span("speaker_2", 480, 720)])).toBeNull();
    expect(coordinator.observe("sess_1", [span("speaker_1", 720, 1040)])).toBeNull();
    expect(coordinator.currentSpeaker("sess_1")).toBe("speaker_1");
  });

  it("does not switch speakers from overlap-only evidence", () => {
    const coordinator = establishedCoordinator();

    expect(coordinator.observe("sess_1", [
      span("speaker_2", 480, 800, { overlap: true }),
    ])).toBeNull();
    expect(coordinator.observe("sess_1", [
      span("speaker_2", 480, 1120, { overlap: true }),
    ])).toBeNull();
    expect(coordinator.currentSpeaker("sess_1")).toBe("speaker_1");
  });

  it("requires the configured speaker confidence", () => {
    const coordinator = establishedCoordinator();

    expect(coordinator.observe("sess_1", [
      span("speaker_2", 480, 800, { confidence: 0.59 }),
    ])).toBeNull();
    expect(coordinator.observe("sess_1", [
      span("speaker_2", 480, 1120, { confidence: 0.59 }),
    ])).toBeNull();
    expect(coordinator.currentSpeaker("sess_1")).toBe("speaker_1");
  });
});

function establishedCoordinator() {
  const coordinator = new SpeechTurnCoordinator();
  coordinator.observe("sess_1", [span("speaker_1", 0, 240)]);
  coordinator.observe("sess_1", [span("speaker_1", 0, 480)]);
  return coordinator;
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
