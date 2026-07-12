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
  if (diagnostics.vad !== undefined && !isVadDiagnostics(diagnostics.vad)) {
    return undefined;
  }
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
    ...(diagnostics.vad ? { vad: sanitizedVad(diagnostics.vad) } : {}),
  };
}

function sanitizedVad(
  value: NonNullable<RealtimeSessionDiagnosticsDto["vad"]>,
) {
  return {
    configuredProvider: value.configuredProvider,
    activeProvider: value.activeProvider,
    threshold: value.threshold,
    analyzedFrameCount: value.analyzedFrameCount,
    speechFrameCount: value.speechFrameCount,
    speechFrameRatio: value.speechFrameRatio,
    ...(value.probabilityMin !== undefined
      ? { probabilityMin: value.probabilityMin }
      : {}),
    ...(value.probabilityMax !== undefined
      ? { probabilityMax: value.probabilityMax }
      : {}),
    ...(value.probabilityMean !== undefined
      ? { probabilityMean: value.probabilityMean }
      : {}),
    fallbackCount: value.fallbackCount,
    ...(value.fallbackReason ? { fallbackReason: value.fallbackReason } : {}),
    ...(value.modelFingerprint
      ? { modelFingerprint: value.modelFingerprint }
      : {}),
    endpointPolicy: { ...value.endpointPolicy },
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

function isVadDiagnostics(value: unknown) {
  if (!isRecord(value) || !isRecord(value.endpointPolicy)) return false;
  const configuredProviders = new Set(["marblenet", "rms"]);
  const activeProviders = new Set(["marblenet", "rms", "rms_fallback"]);
  const fallbackReasons = new Set([
    "assets_missing", "load_failed", "runtime_failed",
  ]);
  const probabilities = [
    value.threshold,
    value.speechFrameRatio,
    value.probabilityMin,
    value.probabilityMax,
    value.probabilityMean,
  ].filter((item) => item !== undefined);
  return configuredProviders.has(value.configuredProvider as string) &&
    activeProviders.has(value.activeProvider as string) &&
    [value.analyzedFrameCount, value.speechFrameCount, value.fallbackCount]
      .every(isNonNegativeInteger) &&
    (value.speechFrameCount as number) <= (value.analyzedFrameCount as number) &&
    probabilities.every(isProbability) &&
    (value.fallbackReason === undefined ||
      fallbackReasons.has(value.fallbackReason as string)) &&
    (value.modelFingerprint === undefined || isFingerprint(value.modelFingerprint)) &&
    isEndpointPolicy(value.endpointPolicy);
}

function isEndpointPolicy(value: Record<string, unknown>) {
  const modes = new Set(["conversation", "listening", "call_link", "pstn"]);
  return modes.has(value.mode as string) &&
    [value.minAudioMs, value.endpointSilenceMs, value.maxAudioMs, value.prerollMs]
      .every(isNonNegativeInteger) &&
    (value.minAudioMs as number) <= (value.maxAudioMs as number) &&
    typeof value.maxAudioMs === "number" && value.maxAudioMs > 0 &&
    isFingerprint(value.fingerprint);
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

function isProbability(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= 1;
}

function isFingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
