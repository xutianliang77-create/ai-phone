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
        stablePartial: {
          enabled: true,
          policy: "qwen17_adjacent_prefix_zh_v1",
          eligibleSegmentCount: 4,
          activeSegment: false,
          decodeCount: 9,
          decisionCount: 9,
          emittedCount: 1,
          firstStablePartialLatencyMs: 852.288,
          lastStablePartialLatencyMs: 852.288,
          rejectionCounts: {
            insufficient_units: 6,
            language_gate: 2,
          },
          languageEvidenceSource: "qwen_streaming_state_label",
          languageEvidenceCounts: {
            empty: 1,
            zh: 3,
            en: 2,
            zh_en: 2,
            other: 1,
          },
          languageGateCounts: { en: 1, zh_en: 1 },
          latestText: "must-not-survive",
        },
        rawProbabilities: [0.1, 0.9],
      },
    });

    expect(diagnostics?.speakerTurns?.commitHitCount).toBe(2);
    expect(diagnostics).not.toHaveProperty("transcript");
    expect(diagnostics?.speakerTurns).not.toHaveProperty("rawAudio");
    expect(diagnostics?.vad?.endpointPolicy.mode).toBe("listening");
    expect(diagnostics?.vad?.stablePartial?.rejectionCounts).toEqual({
      insufficient_units: 6,
      language_gate: 2,
    });
    expect(diagnostics?.vad?.stablePartial?.languageEvidenceCounts).toEqual({
      empty: 1,
      zh: 3,
      en: 2,
      zh_en: 2,
      other: 1,
    });
    expect(diagnostics?.vad?.stablePartial?.languageGateCounts).toEqual({
      en: 1,
      zh_en: 1,
    });
    expect(diagnostics?.vad?.stablePartial).not.toHaveProperty("latestText");
    expect(diagnostics?.vad).not.toHaveProperty("rawProbabilities");
  });

  it("normalizes a null VAD fallback reason from the ASR service", () => {
    const diagnostics = parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 12,
        processedBatchCount: 6,
        droppedFrameCount: 0,
      },
      vad: {
        configuredProvider: "marblenet",
        activeProvider: "marblenet",
        threshold: 0.5,
        analyzedFrameCount: 6,
        speechFrameCount: 4,
        speechFrameRatio: 2 / 3,
        probabilityMin: null,
        probabilityMax: null,
        probabilityMean: null,
        fallbackCount: 0,
        fallbackReason: null,
        modelFingerprint: "a".repeat(64),
        endpointPolicy: {
          mode: "listening",
          minAudioMs: 1800,
          endpointSilenceMs: 1400,
          maxAudioMs: 10000,
          prerollMs: 400,
          fingerprint: "b".repeat(64),
        },
        stablePartial: {
          enabled: true,
          policy: "qwen17_adjacent_prefix_zh_v1",
          eligibleSegmentCount: 0,
          activeSegment: false,
          decodeCount: 0,
          decisionCount: 0,
          emittedCount: 0,
          rejectionCounts: {},
          firstStablePartialLatencyMs: null,
          lastStablePartialLatencyMs: null,
        },
      },
    });

    expect(diagnostics?.vad?.fallbackCount).toBe(0);
    expect(diagnostics?.vad).not.toHaveProperty("fallbackReason");
    expect(diagnostics?.vad).not.toHaveProperty("probabilityMin");
    expect(diagnostics?.vad).not.toHaveProperty("probabilityMax");
    expect(diagnostics?.vad).not.toHaveProperty("probabilityMean");
    expect(diagnostics?.vad?.stablePartial).not.toHaveProperty(
      "firstStablePartialLatencyMs",
    );
    expect(diagnostics?.vad?.stablePartial).not.toHaveProperty(
      "lastStablePartialLatencyMs",
    );
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

  it("rejects unknown or negative stable partial rejection counters", () => {
    const stablePartial = {
      enabled: true,
      policy: "qwen17_adjacent_prefix_zh_v1",
      eligibleSegmentCount: 1,
      activeSegment: false,
      decodeCount: 2,
      decisionCount: 2,
      emittedCount: 0,
    };
    const diagnostics = {
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
        speechFrameRatio: 1,
        fallbackCount: 0,
        endpointPolicy: {
          mode: "listening",
          minAudioMs: 500,
          endpointSilenceMs: 1400,
          maxAudioMs: 10000,
          prerollMs: 400,
          fingerprint: "b".repeat(64),
        },
      },
    };

    expect(parseRealtimeDiagnostics({
      ...diagnostics,
      vad: {
        ...diagnostics.vad,
        stablePartial: {
          ...stablePartial,
          rejectionCounts: { unknown_reason: 1 },
        },
      },
    })).toBeUndefined();
    expect(parseRealtimeDiagnostics({
      ...diagnostics,
      vad: {
        ...diagnostics.vad,
        stablePartial: {
          ...stablePartial,
          rejectionCounts: { no_text: -1 },
        },
      },
    })).toBeUndefined();
  });

  it("rejects invalid or inconsistent stable partial language evidence", () => {
    const stablePartial = {
      enabled: true,
      policy: "qwen17_adjacent_prefix_zh_v1",
      eligibleSegmentCount: 1,
      activeSegment: false,
      decodeCount: 2,
      decisionCount: 2,
      emittedCount: 0,
      rejectionCounts: { language_gate: 2 },
      languageEvidenceSource: "qwen_streaming_state_label",
    };
    const diagnostics = {
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
        speechFrameRatio: 1,
        fallbackCount: 0,
        endpointPolicy: {
          mode: "listening",
          minAudioMs: 500,
          endpointSilenceMs: 1400,
          maxAudioMs: 10000,
          prerollMs: 400,
          fingerprint: "b".repeat(64),
        },
      },
    };

    expect(parseRealtimeDiagnostics({
      ...diagnostics,
      vad: {
        ...diagnostics.vad,
        stablePartial: {
          ...stablePartial,
          languageEvidenceCounts: { unknown: 2 },
          languageGateCounts: { other: 2 },
        },
      },
    })).toBeUndefined();
    expect(parseRealtimeDiagnostics({
      ...diagnostics,
      vad: {
        ...diagnostics.vad,
        stablePartial: {
          ...stablePartial,
          languageEvidenceCounts: { en: 1 },
          languageGateCounts: { en: 2 },
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
