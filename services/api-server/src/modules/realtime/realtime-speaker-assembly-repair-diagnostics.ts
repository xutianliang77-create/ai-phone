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
    ...(value.noopEvaluationCount !== undefined
      ? { noopEvaluationCount: value.noopEvaluationCount }
      : {}),
    ...(value.noopAcceptedCount !== undefined
      ? { noopAcceptedCount: value.noopAcceptedCount }
      : {}),
    ...(value.noopRejectionReasonCounts
      ? { noopRejectionReasonCounts: {
          ...value.noopRejectionReasonCounts,
        } }
      : {}),
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
      ) || !validNoopDiagnostics(value)) return false;
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
    value.noopEvaluationCount ?? 0,
    value.noopAcceptedCount ?? 0,
  ].every((count) => Number(count) === 0);
  return delayed <= accepted &&
    accepted + rejected <= attempts &&
    revisions >= delayed * 2 &&
    expired <= cached && pending <= cached && pending <= 12 &&
    averageWaitMs <= maxWaitMs &&
    (delayed > 0 || averageWaitMs === 0 && maxWaitMs === 0) &&
    disabledIsEmpty;
}

function validNoopDiagnostics(value: Record<string, unknown>) {
  const evaluations = value.noopEvaluationCount;
  const accepted = value.noopAcceptedCount;
  const reasons = value.noopRejectionReasonCounts;
  if (
    evaluations === undefined && accepted === undefined &&
    reasons === undefined
  ) return true;
  if (
    !isNonNegativeInteger(evaluations) ||
    !isNonNegativeInteger(accepted) || !isRecord(reasons) ||
    Number(accepted) > Number(evaluations)
  ) return false;
  const allowed = new Set([
    "crossing_parent",
    "missing_previous_final",
    "missing_next_final",
    "previous_gap_exceeded",
    "next_gap_exceeded",
    "unknown_or_overlap",
  ]);
  const entries = Object.entries(reasons);
  return entries.every(([reason, count]) =>
    allowed.has(reason) && isNonNegativeInteger(count)
  ) && entries.reduce((sum, [, count]) => sum + Number(count), 0) ===
    Number(evaluations) - Number(accepted);
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
