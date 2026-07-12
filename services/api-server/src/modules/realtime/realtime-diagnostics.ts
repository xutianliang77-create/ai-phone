import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";

export function parseRealtimeDiagnostics(
  value: unknown,
): RealtimeSessionDiagnosticsDto | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const diagnostics = value as Partial<RealtimeSessionDiagnosticsDto>;
  if (diagnostics.version !== 1 || !isAudioDiagnostics(diagnostics.audio)) {
    return undefined;
  }
  if (
    diagnostics.speakerTurns !== undefined &&
    !isSpeakerTurnDiagnostics(diagnostics.speakerTurns)
  ) return undefined;
  const audio = diagnostics.audio!;
  return {
    version: 1,
    audio: {
      receivedFrameCount: audio.receivedFrameCount,
      processedBatchCount: audio.processedBatchCount,
      droppedFrameCount: audio.droppedFrameCount,
    },
    ...(diagnostics.speakerTurns
      ? { speakerTurns: sanitizedSpeakerTurns(diagnostics.speakerTurns) }
      : {}),
  };
}

function sanitizedSpeakerTurns(
  value: NonNullable<RealtimeSessionDiagnosticsDto["speakerTurns"]>,
) {
  return {
    confirmedBoundaryCount: value.confirmedBoundaryCount,
    commitHitCount: value.commitHitCount,
    commitMissCount: value.commitMissCount,
    commitErrorCount: value.commitErrorCount,
    endpointRaceCount: value.endpointRaceCount,
    averageConfirmationLatencyMs: value.averageConfirmationLatencyMs,
    maxConfirmationLatencyMs: value.maxConfirmationLatencyMs,
    committedAudioMs: value.committedAudioMs,
    endpointReasons: { ...value.endpointReasons },
  };
}

function isAudioDiagnostics(value: unknown) {
  if (!isRecord(value)) return false;
  return [
    value.receivedFrameCount,
    value.processedBatchCount,
    value.droppedFrameCount,
  ].every(isNonNegativeInteger);
}

function isSpeakerTurnDiagnostics(value: unknown) {
  if (!isRecord(value)) return false;
  const counts = [
    value.confirmedBoundaryCount,
    value.commitHitCount,
    value.commitMissCount,
    value.commitErrorCount,
    value.endpointRaceCount,
    value.averageConfirmationLatencyMs,
    value.maxConfirmationLatencyMs,
    value.committedAudioMs,
  ];
  return counts.every(isNonNegativeInteger) &&
    isEndpointReasonCounts(value.endpointReasons);
}

function isEndpointReasonCounts(value: unknown) {
  if (!isRecord(value)) return false;
  const allowed = new Set(["silence", "max_duration", "flush", "speaker_boundary"]);
  return Object.entries(value).every(
    ([key, count]) => allowed.has(key) && isNonNegativeInteger(count),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
