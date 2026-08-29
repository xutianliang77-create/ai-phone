import { describe, expect, it } from "vitest";

import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";

describe("speaker boundary revision diagnostics", () => {
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
