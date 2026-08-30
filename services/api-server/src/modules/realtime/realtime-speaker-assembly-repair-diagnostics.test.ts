import { describe, expect, it } from "vitest";
import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";

describe("speaker assembly repair diagnostics", () => {
  it("sanitizes bounded counters without retaining source payload", () => {
    const diagnostics = parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 10,
        processedBatchCount: 2,
        droppedFrameCount: 0,
      },
      speakerAssemblyRepair: {
        enabled: true,
        cachedParentCount: 3,
        boundaryEvidenceArrivalCount: 1,
        repairAttemptCount: 2,
        repairAcceptedCount: 1,
        delayedRepairAcceptedCount: 1,
        repairRejectedCount: 1,
        revisionEmittedCount: 2,
        expiredParentCount: 0,
        pendingParentCount: 1,
        rejectionReasonCounts: { no_safe_token_boundary: 1 },
        averageWaitMs: 2200,
        maxWaitMs: 2200,
        rawText: "must-not-survive",
      },
    });

    expect(diagnostics?.speakerAssemblyRepair).toEqual({
      enabled: true,
      cachedParentCount: 3,
      boundaryEvidenceArrivalCount: 1,
      repairAttemptCount: 2,
      repairAcceptedCount: 1,
      delayedRepairAcceptedCount: 1,
      repairRejectedCount: 1,
      revisionEmittedCount: 2,
      expiredParentCount: 0,
      pendingParentCount: 1,
      rejectionReasonCounts: { no_safe_token_boundary: 1 },
      averageWaitMs: 2200,
      maxWaitMs: 2200,
    });
  });

  it.each([
    ["delayed accepts exceed accepts", {
      repairAcceptedCount: 0,
      delayedRepairAcceptedCount: 1,
    }],
    ["accepted and rejected outcomes exceed attempts", {
      repairAttemptCount: 1,
      repairAcceptedCount: 1,
      repairRejectedCount: 1,
    }],
    ["rejection reasons do not match rejected count", {
      repairRejectedCount: 1,
      rejectionReasonCounts: {},
    }],
    ["an unknown rejection reason is reported", {
      repairRejectedCount: 1,
      rejectionReasonCounts: { unsafe_guess: 1 },
    }],
    ["pending parents exceed the bounded cache", {
      pendingParentCount: 13,
    }],
    ["wait average exceeds maximum", {
      delayedRepairAcceptedCount: 1,
      repairAcceptedCount: 1,
      repairAttemptCount: 1,
      averageWaitMs: 1001,
      maxWaitMs: 1000,
    }],
  ])("rejects diagnostics when %s", (_label, patch) => {
    expect(parseRealtimeDiagnostics({
      version: 1,
      audio: {
        receivedFrameCount: 1,
        processedBatchCount: 1,
        droppedFrameCount: 0,
      },
      speakerAssemblyRepair: {
        enabled: true,
        cachedParentCount: 1,
        boundaryEvidenceArrivalCount: 1,
        repairAttemptCount: 1,
        repairAcceptedCount: 0,
        delayedRepairAcceptedCount: 0,
        repairRejectedCount: 0,
        revisionEmittedCount: 0,
        expiredParentCount: 0,
        pendingParentCount: 0,
        rejectionReasonCounts: {},
        averageWaitMs: 0,
        maxWaitMs: 0,
        ...patch,
      },
    })).toBeUndefined();
  });
});
