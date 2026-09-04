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

  it("accepts one persisted speaker without a false boundary", () => {
    const detail = {
      status: "ended",
      segments: [segment("a", "turn_1", "speaker_1", "en", 0)],
      diagnostics: {
        audio: { droppedFrameCount: 0 },
        speakerTurns: {
          confirmedBoundaryCount: 0,
          commitHitCount: 0,
          commitMissCount: 0,
          commitErrorCount: 0,
          endpointRaceCount: 0,
        },
      },
    };
    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    }, {
      expectedSpeakerCount: 1,
      requireBoundary: false,
      requiredLanguages: ["en"],
    });

    expect(result.ok).toBe(true);
    expect(result.speakerIds).toEqual(["speaker_1"]);
    expect(result.turnIds).toEqual(["turn_1"]);
  });

  it("rejects a false second speaker in a single-speaker gate", () => {
    const detail = sessionDetail();
    detail.segments[1].dominantLanguage = "en";
    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    }, {
      expectedSpeakerCount: 1,
      requireBoundary: false,
      requiredLanguages: ["en"],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Expected 1 speakers");
    expect(result.errors.join(" ")).toContain("Unexpected speaker boundary");
  });

  it("rejects session end persistence above the latency gate", () => {
    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail: sessionDetail(),
      endDelivery: { historyReady: true, historyLatencyMs: 1501 },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("1501ms");
  });

  it("accepts a commit miss repaired by a boundary revision", () => {
    const detail = sessionDetail();
    detail.diagnostics.speakerTurns.commitMissCount = 1;
    detail.diagnostics.speakerTurns.boundaryRevisionSuccessCount = 1;
    detail.diagnostics.speakerTurns.endpointRaceCount = 1;

    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    });

    expect(result.ok).toBe(true);
    expect(result.unresolvedCommitMissCount).toBe(0);
    expect(result.unresolvedEndpointRaceCount).toBe(0);
  });

  it("accepts a commit miss resolved by the token timing boundary ledger", () => {
    const detail = sessionDetail();
    detail.diagnostics.speakerTurns.confirmedBoundaryCount = 2;
    detail.diagnostics.speakerTurns.commitMissCount = 1;
    detail.diagnostics.speakerTurns.unresolvedCommitMissCount = 0;
    detail.diagnostics.speakerTurns.boundaryOutcomeCounts = {
      commit_hit: 1,
      token_timing_split: 1,
    };

    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    });

    expect(result.ok).toBe(true);
    expect(result.unresolvedCommitMissCount).toBe(0);
  });

  it("rejects commit misses left unresolved after revision", () => {
    const detail = sessionDetail();
    detail.diagnostics.speakerTurns.commitMissCount = 2;
    detail.diagnostics.speakerTurns.boundaryRevisionSuccessCount = 1;

    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    });

    expect(result.ok).toBe(false);
    expect(result.unresolvedCommitMissCount).toBe(1);
  });

  it("rejects endpoint races left unresolved", () => {
    const detail = sessionDetail();
    detail.diagnostics.speakerTurns.endpointRaceCount = 2;

    const result = evaluateRealtimeSpeakerTurnReadiness({
      gatewayHealth: { speakerProvider: "http", sessionEventSink: "api" },
      speakerHealth: { provider: "sortformer", mode: "active" },
      detail,
    });

    expect(result.ok).toBe(false);
    expect(result.unresolvedEndpointRaceCount).toBe(1);
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
