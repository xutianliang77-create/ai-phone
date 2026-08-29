import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";

type SpeakerRevisionDiagnostics = NonNullable<
  RealtimeSessionDiagnosticsDto["speakerRevision"]
>;

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
  const cardinalityMismatchCount = value.cardinalityMismatchCount as number;
  return value.configuredProvider === "http" &&
    (value.mode === "shadow" || value.mode === "apply") &&
    counts.every(isNonNegativeInteger) &&
    completedCount + staleResultCount <= requestCount &&
    errorCount <= requestCount &&
    acceptedCount <= completedCount &&
    splitRejectedCount <= completedCount &&
    cardinalityMismatchCount <= splitRejectedCount &&
    (value.mode !== "shadow" || value.emittedUpdateCount === 0) &&
    (value.lastLatencyMs === undefined || isNonNegativeFinite(value.lastLatencyMs));
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
