import { describe, expect, it } from "vitest";

import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";

describe("speaker boundary revision diagnostics", () => {
  it("sanitizes a complete per-boundary outcome ledger", () => {
    const diagnostics = parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerTurns: {
        confirmedBoundaryCount: 2,
        commitHitCount: 1,
        commitMissCount: 1,
        commitErrorCount: 0,
        endpointRaceCount: 0,
        averageConfirmationLatencyMs: 960,
        maxConfirmationLatencyMs: 960,
        committedAudioMs: 480,
        endpointReasons: {},
        unresolvedCommitMissCount: 0,
        boundaryOutcomeCounts: {
          commit_hit: 1,
          token_timing_split: 1,
        },
      },
    });

    expect(diagnostics?.speakerTurns).toMatchObject({
      unresolvedCommitMissCount: 0,
      boundaryOutcomeCounts: {
        commit_hit: 1,
        token_timing_split: 1,
      },
    });
  });

  it.each([
    ["outcome total differs from confirmed boundaries", {
      unresolvedCommitMissCount: 0,
      boundaryOutcomeCounts: { commit_hit: 1 },
    }],
    ["resolved and unresolved misses differ from the raw miss count", {
      unresolvedCommitMissCount: 0,
      boundaryOutcomeCounts: {
        commit_hit: 1,
        token_timing_split: 1,
      },
    }],
    ["an unknown boundary outcome is reported", {
      unresolvedCommitMissCount: 1,
      boundaryOutcomeCounts: {
        commit_hit: 1,
        unsafe_guess: 1,
      },
    }],
  ])("rejects diagnostics when %s", (_label, outcomePatch) => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerTurns: {
        confirmedBoundaryCount: 2,
        commitHitCount: 1,
        commitMissCount: 0,
        commitErrorCount: 0,
        endpointRaceCount: 0,
        averageConfirmationLatencyMs: 960,
        maxConfirmationLatencyMs: 960,
        committedAudioMs: 480,
        endpointReasons: {},
        ...outcomePatch,
      },
    })).toBeUndefined();
  });

  it.each([
    ["outcomes exceed attempts", {
      boundaryRevisionAttemptCount: 1,
      boundaryRevisionSuccessCount: 1,
      boundaryRevisionFailureCount: 1,
      boundaryReassignedCharacterCount: 8,
    }],
    ["a counter is negative", {
      boundaryRevisionAttemptCount: -1,
      boundaryRevisionSuccessCount: 0,
      boundaryRevisionFailureCount: 0,
      boundaryReassignedCharacterCount: 0,
    }],
    ["the counter group is incomplete", {
      boundaryRevisionAttemptCount: 1,
    }],
  ])("rejects diagnostics when %s", (_label, revisionCounts) => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerTurns: {
        confirmedBoundaryCount: 1,
        commitHitCount: 0,
        commitMissCount: 1,
        commitErrorCount: 0,
        endpointRaceCount: 0,
        averageConfirmationLatencyMs: 960,
        maxConfirmationLatencyMs: 960,
        committedAudioMs: 0,
        endpointReasons: {},
        ...revisionCounts,
      },
    })).toBeUndefined();
  });
});

describe("high-context speaker revision diagnostics", () => {
  it("sanitizes bounded counters without retaining source payload", () => {
    const diagnostics = parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 12,
        processedBatchCount: 3,
        droppedFrameCount: 0,
      },
      speakerRevision: {
        configuredProvider: "http",
        mode: "apply",
        requestCount: 2,
        completedCount: 1,
        acceptedCount: 1,
        emittedUpdateCount: 4,
        errorCount: 1,
        staleResultCount: 0,
        splitParentCount: 2,
        splitChildCount: 4,
        splitRejectedCount: 0,
        splitSkippedParentCount: 2,
        splitSkippedReasonCounts: {
          no_safe_token_boundary: 2,
        },
        cardinalityMismatchCount: 0,
        lastLatencyMs: 1810.6,
        rawAudio: "must-not-survive",
      },
    });

    expect(diagnostics?.speakerRevision).toEqual({
      configuredProvider: "http",
      mode: "apply",
      requestCount: 2,
      completedCount: 1,
      acceptedCount: 1,
      emittedUpdateCount: 4,
      errorCount: 1,
      staleResultCount: 0,
      splitParentCount: 2,
      splitChildCount: 4,
      splitRejectedCount: 0,
      splitSkippedParentCount: 2,
      splitSkippedReasonCounts: {
        no_safe_token_boundary: 2,
      },
      cardinalityMismatchCount: 0,
      lastLatencyMs: 1810.6,
    });
  });

  it.each([
    ["current and stale results exceed requests", {
      requestCount: 1,
      completedCount: 1,
      staleResultCount: 1,
    }],
    ["accepted exceeds completed", {
      requestCount: 1,
      completedCount: 0,
      acceptedCount: 1,
    }],
    ["cardinality mismatches exceed split rejections", {
      requestCount: 1,
      completedCount: 1,
      splitRejectedCount: 0,
      cardinalityMismatchCount: 1,
    }],
    ["shadow mode reports emitted updates", {
      mode: "shadow",
      requestCount: 1,
      completedCount: 1,
      acceptedCount: 1,
      emittedUpdateCount: 1,
    }],
    ["a counter is negative", {
      requestCount: -1,
    }],
    ["skipped reason totals do not match", {
      splitSkippedParentCount: 2,
      splitSkippedReasonCounts: { no_safe_token_boundary: 1 },
    }],
    ["an unknown skipped reason is reported", {
      splitSkippedParentCount: 1,
      splitSkippedReasonCounts: { unsafe_guess: 1 },
    }],
  ])("rejects diagnostics when %s", (_label, patch) => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerRevision: {
        configuredProvider: "http",
        mode: "apply",
        requestCount: 1,
        completedCount: 1,
        acceptedCount: 0,
        emittedUpdateCount: 0,
        errorCount: 0,
        staleResultCount: 0,
        splitParentCount: 0,
        splitChildCount: 0,
        splitRejectedCount: 0,
        splitSkippedParentCount: 0,
        splitSkippedReasonCounts: {},
        cardinalityMismatchCount: 0,
        ...patch,
      },
    })).toBeUndefined();
  });
});
