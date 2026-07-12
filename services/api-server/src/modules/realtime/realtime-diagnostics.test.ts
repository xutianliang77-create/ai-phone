import { describe, expect, it } from "vitest";
import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";

describe("realtime diagnostics", () => {
  it("accepts bounded session counters", () => {
    const diagnostics = parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 12,
        processedBatchCount: 3,
        droppedFrameCount: 1,
      },
      speakerTurns: {
        confirmedBoundaryCount: 2,
        commitHitCount: 2,
        commitMissCount: 0,
        commitErrorCount: 0,
        endpointRaceCount: 1,
        averageConfirmationLatencyMs: 320,
        maxConfirmationLatencyMs: 400,
        committedAudioMs: 2300,
        endpointReasons: { speaker_boundary: 2, flush: 1 },
        rawAudio: "must-not-survive",
      },
      transcript: "must-not-survive",
    });

    expect(diagnostics?.speakerTurns?.commitHitCount).toBe(2);
    expect(diagnostics).not.toHaveProperty("transcript");
    expect(diagnostics?.speakerTurns).not.toHaveProperty("rawAudio");
  });

  it("rejects unknown endpoint reasons and negative counters", () => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: -1,
        processedBatchCount: 0,
        droppedFrameCount: 0,
      },
    })).toBeUndefined();
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerTurns: {
        confirmedBoundaryCount: 0,
        commitHitCount: 0,
        commitMissCount: 0,
        commitErrorCount: 0,
        endpointRaceCount: 0,
        averageConfirmationLatencyMs: 0,
        maxConfirmationLatencyMs: 0,
        committedAudioMs: 0,
        endpointReasons: { unknown: 1 },
      },
    })).toBeUndefined();
  });
});
