import { describe, expect, it } from "vitest";
import { evaluateRealtimeSpeakerTurnReadiness } from "./realtime_speaker_turn_readiness.mjs";

describe("realtime speaker turn readiness", () => {
  it("accepts two chronological translated speaker turns", () => {
    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail: sessionDetail(),
    });

    expect(result.ok).toBe(true);
    expect(result.speakerIds).toEqual(["speaker_1", "speaker_2"]);
    expect(result.turnIds).toEqual(["turn_1", "turn_2"]);
  });

  it("rejects shadow mode and a single persisted speaker", () => {
    const detail = sessionDetail();
    detail.segments[1].speaker = detail.segments[0].speaker;
    detail.segments[1].turnId = detail.segments[0].turnId;
    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer_shadow", mode: "shadow" },
      detail,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("sortformer/active");
    expect(result.errors.join(" ")).toContain("Expected 2 speakers");
  });
});

function sessionDetail() {
  return {
    status: "ended",
    segments: [
      segment("a", "turn_1", "speaker_1", "zh", 0),
      segment("b", "turn_2", "speaker_2", "en", 2000),
    ],
    diagnostics: {
      audio: { droppedFrameCount: 0 },
      speakerTurns: {
        confirmedBoundaryCount: 1,
        commitHitCount: 1,
        commitMissCount: 0,
        commitErrorCount: 0,
        endpointRaceCount: 0,
      },
    },
  };
}

function segment(id, turnId, speakerId, dominantLanguage, startMs) {
  return {
    id,
    turnId,
    sourceText: `source ${id}`,
    translatedText: `translation ${id}`,
    dominantLanguage,
    speaker: { speakerId },
    timing: { startMs, endMs: startMs + 1000 },
  };
}
