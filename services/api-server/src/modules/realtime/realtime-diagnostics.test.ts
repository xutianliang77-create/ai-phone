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
      vad: {
        configuredProvider: "marblenet",
        activeProvider: "rms_fallback",
        threshold: 0.5,
        analyzedFrameCount: 10,
        speechFrameCount: 6,
        speechFrameRatio: 0.6,
        fallbackCount: 1,
        fallbackReason: "runtime_failed",
        modelFingerprint: "a".repeat(64),
        endpointPolicy: {
          mode: "listening",
          minAudioMs: 1800,
          endpointSilenceMs: 1400,
          maxAudioMs: 10000,
          prerollMs: 400,
          fingerprint: "b".repeat(64),
        },
        rawProbabilities: [0.1, 0.9],
      },
    });

    expect(diagnostics?.speakerTurns?.commitHitCount).toBe(2);
    expect(diagnostics).not.toHaveProperty("transcript");
    expect(diagnostics?.speakerTurns).not.toHaveProperty("rawAudio");
    expect(diagnostics?.vad?.endpointPolicy.mode).toBe("listening");
    expect(diagnostics?.vad).not.toHaveProperty("rawProbabilities");
  });

  it("rejects invalid VAD ratios and endpoint policies", () => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      vad: {
        configuredProvider: "marblenet",
        activeProvider: "marblenet",
        threshold: 0.5,
        analyzedFrameCount: 1,
        speechFrameCount: 1,
        speechFrameRatio: 1.5,
        fallbackCount: 0,
        endpointPolicy: {
          mode: "unknown",
          minAudioMs: 1,
          endpointSilenceMs: 1,
          maxAudioMs: 1,
          prerollMs: 0,
          fingerprint: "x",
        },
      },
    })).toBeUndefined();
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
