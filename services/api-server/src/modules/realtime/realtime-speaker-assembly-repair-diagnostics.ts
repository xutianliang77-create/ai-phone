import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";
import { isSpeakerTokenSplitRejectionReason } from
  "./realtime-speaker-revision-diagnostics.js";

type SpeakerAssemblyRepairDiagnostics = NonNullable<
  RealtimeSessionDiagnosticsDto["speakerAssemblyRepair"]
>;

export function sanitizedSpeakerAssemblyRepair(
  value: SpeakerAssemblyRepairDiagnostics,
) {
  return {
    enabled: value.enabled,
    cachedParentCount: value.cachedParentCount,
    boundaryEvidenceArrivalCount: value.boundaryEvidenceArrivalCount,
    repairAttemptCount: value.repairAttemptCount,
    repairAcceptedCount: value.repairAcceptedCount,
    delayedRepairAcceptedCount: value.delayedRepairAcceptedCount,
    repairRejectedCount: value.repairRejectedCount,
    revisionEmittedCount: value.revisionEmittedCount,
    expiredParentCount: value.expiredParentCount,
    pendingParentCount: value.pendingParentCount,
    rejectionReasonCounts: { ...value.rejectionReasonCounts },
    averageWaitMs: value.averageWaitMs,
    maxWaitMs: value.maxWaitMs,
  };
}

export function isSpeakerAssemblyRepairDiagnostics(
  value: unknown,
): value is SpeakerAssemblyRepairDiagnostics {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return false;
  const counts = [
    value.cachedParentCount,
    value.boundaryEvidenceArrivalCount,
    value.repairAttemptCount,
    value.repairAcceptedCount,
    value.delayedRepairAcceptedCount,
    value.repairRejectedCount,
    value.revisionEmittedCount,
    value.expiredParentCount,
    value.pendingParentCount,
  ];
  if (!counts.every(isNonNegativeInteger) ||
      !isNonNegativeFinite(value.averageWaitMs) ||
      !isNonNegativeFinite(value.maxWaitMs) ||
      !validRejectionReasons(
        value.rejectionReasonCounts,
        Number(value.repairRejectedCount),
      )) return false;
  const cached = Number(value.cachedParentCount);
  const attempts = Number(value.repairAttemptCount);
  const accepted = Number(value.repairAcceptedCount);
  const delayed = Number(value.delayedRepairAcceptedCount);
  const rejected = Number(value.repairRejectedCount);
  const revisions = Number(value.revisionEmittedCount);
  const expired = Number(value.expiredParentCount);
  const pending = Number(value.pendingParentCount);
  const averageWaitMs = Number(value.averageWaitMs);
  const maxWaitMs = Number(value.maxWaitMs);
  const disabledIsEmpty = value.enabled || [
    ...counts,
    averageWaitMs,
    maxWaitMs,
  ].every((count) => Number(count) === 0);
  return delayed <= accepted &&
    accepted + rejected <= attempts &&
    revisions >= delayed * 2 &&
    expired <= cached && pending <= cached && pending <= 12 &&
    averageWaitMs <= maxWaitMs &&
    (delayed > 0 || averageWaitMs === 0 && maxWaitMs === 0) &&
    disabledIsEmpty;
}

function validRejectionReasons(value: unknown, expectedTotal: number) {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.every(([reason, count]) =>
    isSpeakerTokenSplitRejectionReason(reason) &&
    isNonNegativeInteger(count)
  ) && entries.reduce((total, [, count]) => total + Number(count), 0) ===
    expectedTotal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
