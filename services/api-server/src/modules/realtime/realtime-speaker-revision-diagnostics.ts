import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";

type SpeakerRevisionDiagnostics = NonNullable<
  RealtimeSessionDiagnosticsDto["speakerRevision"]
>;

const TOKEN_SPLIT_REJECTION_REASONS = new Set([
  "not_final",
  "missing_timing",
  "missing_token_timing",
  "invalid_token_timing",
  "explicit_overlap",
  "unconfirmed_boundary",
  "turn_lineage_mismatch",
  "protected_surface",
  "no_safe_token_boundary",
  "sortformer_evidence_mismatch",
  "text_conservation_failed",
]);

export function sanitizedSpeakerRevision(value: SpeakerRevisionDiagnostics) {
  return {
    configuredProvider: value.configuredProvider,
    mode: value.mode,
    requestCount: value.requestCount,
    completedCount: value.completedCount,
    acceptedCount: value.acceptedCount,
    emittedUpdateCount: value.emittedUpdateCount,
    errorCount: value.errorCount,
    staleResultCount: value.staleResultCount,
    splitParentCount: value.splitParentCount,
    splitChildCount: value.splitChildCount,
    splitRejectedCount: value.splitRejectedCount,
    splitSkippedParentCount: value.splitSkippedParentCount ?? 0,
    splitSkippedReasonCounts: value.splitSkippedReasonCounts ?? {},
    cardinalityMismatchCount: value.cardinalityMismatchCount,
    ...(value.lastLatencyMs !== undefined
      ? { lastLatencyMs: value.lastLatencyMs }
      : {}),
  };
}

export function isSpeakerRevisionDiagnostics(
  value: unknown,
): value is SpeakerRevisionDiagnostics {
  if (!isRecord(value)) return false;
  const counts = [
    value.requestCount,
    value.completedCount,
    value.acceptedCount,
    value.emittedUpdateCount,
    value.errorCount,
    value.staleResultCount,
    value.splitParentCount,
    value.splitChildCount,
    value.splitRejectedCount,
    value.cardinalityMismatchCount,
  ];
  const requestCount = value.requestCount as number;
  const completedCount = value.completedCount as number;
  const acceptedCount = value.acceptedCount as number;
  const errorCount = value.errorCount as number;
  const staleResultCount = value.staleResultCount as number;
  const splitRejectedCount = value.splitRejectedCount as number;
  const splitSkippedParentCount = value.splitSkippedParentCount ?? 0;
  const cardinalityMismatchCount = value.cardinalityMismatchCount as number;
  return value.configuredProvider === "http" &&
    (value.mode === "shadow" || value.mode === "apply") &&
    counts.every(isNonNegativeInteger) &&
    completedCount + staleResultCount <= requestCount &&
    errorCount <= requestCount &&
    acceptedCount <= completedCount &&
    splitRejectedCount <= completedCount &&
    isNonNegativeInteger(splitSkippedParentCount) &&
    validSkippedReasonCounts(
      value.splitSkippedReasonCounts,
      Number(splitSkippedParentCount),
    ) &&
    cardinalityMismatchCount <= splitRejectedCount &&
    (value.mode !== "shadow" || value.emittedUpdateCount === 0) &&
    (value.lastLatencyMs === undefined || isNonNegativeFinite(value.lastLatencyMs));
}

function validSkippedReasonCounts(value: unknown, expectedTotal: number) {
  if (value === undefined) return expectedTotal === 0;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.every(([reason, count]) =>
    isSpeakerTokenSplitRejectionReason(reason) && isNonNegativeInteger(count)
  ) && entries.reduce((total, [, count]) => total + Number(count), 0) ===
    expectedTotal;
}

export function isSpeakerTokenSplitRejectionReason(reason: string) {
  return TOKEN_SPLIT_REJECTION_REASONS.has(reason);
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
