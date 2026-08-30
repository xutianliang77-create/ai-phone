import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";
import { parseRealtimeNodeDiagnostics } from "./realtime-node-diagnostics.js";
import {
  isSpeakerRevisionDiagnostics,
  sanitizedSpeakerRevision,
} from "./realtime-speaker-revision-diagnostics.js";
import {
  isSpeakerTurnDiagnostics,
  sanitizedSpeakerTurns,
} from "./realtime-speaker-turn-diagnostics.js";

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
  if (
    diagnostics.speakerRevision !== undefined &&
    !isSpeakerRevisionDiagnostics(diagnostics.speakerRevision)
  ) return undefined;
  if (diagnostics.vad !== undefined && !isVadDiagnostics(diagnostics.vad)) {
    return undefined;
  }
  const nodes = Array.isArray(diagnostics.nodes)
    ? diagnostics.nodes.map(parseRealtimeNodeDiagnostics)
    : undefined;
  if (diagnostics.nodes !== undefined &&
    (!Array.isArray(diagnostics.nodes) || diagnostics.nodes.length > 16 ||
      nodes?.some((node) => !node) ||
      new Set(nodes?.map((node) => node!.runtimeId)).size !== nodes?.length)) {
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
    ...(diagnostics.speakerRevision
      ? { speakerRevision: sanitizedSpeakerRevision(
          diagnostics.speakerRevision,
        ) }
      : {}),
    ...(diagnostics.vad ? { vad: sanitizedVad(diagnostics.vad) } : {}),
    ...(nodes ? { nodes: nodes as NonNullable<RealtimeSessionDiagnosticsDto["nodes"]> } : {}),
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
    ...(value.probabilityMin != null
      ? { probabilityMin: value.probabilityMin }
      : {}),
    ...(value.probabilityMax != null
      ? { probabilityMax: value.probabilityMax }
      : {}),
    ...(value.probabilityMean != null
      ? { probabilityMean: value.probabilityMean }
      : {}),
    fallbackCount: value.fallbackCount,
    ...(value.fallbackReason ? { fallbackReason: value.fallbackReason } : {}),
    ...(value.modelFingerprint
      ? { modelFingerprint: value.modelFingerprint }
      : {}),
    endpointPolicy: { ...value.endpointPolicy },
    ...(value.stablePartial
      ? { stablePartial: sanitizedStablePartial(value.stablePartial) }
      : {}),
  };
}

function sanitizedStablePartial(
  value: NonNullable<
    NonNullable<RealtimeSessionDiagnosticsDto["vad"]>["stablePartial"]
  >,
) {
  return {
    enabled: value.enabled,
    policy: value.policy,
    eligibleSegmentCount: value.eligibleSegmentCount,
    activeSegment: value.activeSegment,
    decodeCount: value.decodeCount,
    ...(value.decisionCount !== undefined
      ? { decisionCount: value.decisionCount }
      : {}),
    emittedCount: value.emittedCount,
    ...(value.rejectionCounts
      ? { rejectionCounts: { ...value.rejectionCounts } }
      : {}),
    ...(value.languageEvidenceSource
      ? { languageEvidenceSource: value.languageEvidenceSource }
      : {}),
    ...(value.languageEvidenceCounts
      ? { languageEvidenceCounts: { ...value.languageEvidenceCounts } }
      : {}),
    ...(value.languageGateCounts
      ? { languageGateCounts: { ...value.languageGateCounts } }
      : {}),
    ...(value.firstStablePartialLatencyMs != null
      ? { firstStablePartialLatencyMs: value.firstStablePartialLatencyMs }
      : {}),
    ...(value.lastStablePartialLatencyMs != null
      ? { lastStablePartialLatencyMs: value.lastStablePartialLatencyMs }
      : {}),
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
  ].filter((item) => item != null);
  return configuredProviders.has(value.configuredProvider as string) &&
    activeProviders.has(value.activeProvider as string) &&
    [value.analyzedFrameCount, value.speechFrameCount, value.fallbackCount]
      .every(isNonNegativeInteger) &&
    (value.speechFrameCount as number) <= (value.analyzedFrameCount as number) &&
    probabilities.every(isProbability) &&
    (value.fallbackReason == null ||
      fallbackReasons.has(value.fallbackReason as string)) &&
    (value.modelFingerprint === undefined || isFingerprint(value.modelFingerprint)) &&
    isEndpointPolicy(value.endpointPolicy) &&
    (value.stablePartial === undefined ||
      isStablePartialDiagnostics(value.stablePartial));
}

function isStablePartialDiagnostics(value: unknown) {
  if (!isRecord(value)) return false;
  const counts = [
    value.eligibleSegmentCount,
    value.decodeCount,
    value.decisionCount,
    value.emittedCount,
  ].filter((item) => item !== undefined);
  const latencies = [
    value.firstStablePartialLatencyMs,
    value.lastStablePartialLatencyMs,
  ].filter((item) => item != null);
  const languageEvidenceTotal = countTotal(value.languageEvidenceCounts);
  const languageGateTotal = countTotal(value.languageGateCounts);
  const languageGateRejections = isRecord(value.rejectionCounts)
    ? Number(value.rejectionCounts.language_gate ?? 0)
    : 0;
  const hasLanguageEvidence = value.languageEvidenceSource !== undefined ||
    value.languageEvidenceCounts !== undefined ||
    value.languageGateCounts !== undefined;
  return typeof value.enabled === "boolean" &&
    typeof value.activeSegment === "boolean" &&
    typeof value.policy === "string" && value.policy.length > 0 &&
    value.policy.length <= 80 &&
    counts.every(isNonNegativeInteger) &&
    (value.emittedCount as number) <= (value.decodeCount as number) &&
    (value.decisionCount === undefined ||
      (value.decisionCount as number) <= (value.decodeCount as number) &&
      (value.emittedCount as number) <= (value.decisionCount as number) &&
      rejectionTotal(value.rejectionCounts) + (value.emittedCount as number) ===
        value.decisionCount) &&
    (!hasLanguageEvidence ||
      value.languageEvidenceSource === "qwen_streaming_state_label" &&
      value.decisionCount !== undefined &&
      isStablePartialLanguageCounts(value.languageEvidenceCounts) &&
      languageEvidenceTotal === value.decisionCount &&
      isStablePartialLanguageCounts(value.languageGateCounts) &&
      languageGateTotal === languageGateRejections &&
      languageGateCountsAreEvidence(value.languageGateCounts, value.languageEvidenceCounts)) &&
    latencies.every(isNonNegativeFinite) &&
    (value.rejectionCounts === undefined ||
      isStablePartialRejectionCounts(value.rejectionCounts));
}

function countTotal(value: unknown) {
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>(
    (total, count) => total + (typeof count === "number" ? count : 0),
    0,
  );
}

function rejectionTotal(value: unknown) {
  if (!isRecord(value)) return 0;
  return Object.values(value).reduce<number>(
    (total, count) => total + (typeof count === "number" ? count : 0),
    0,
  );
}

function isStablePartialRejectionCounts(value: unknown) {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "no_text",
    "insufficient_units",
    "duplicate_partial",
    "backtrack",
    "language_gate",
    "context_echo",
  ]);
  return Object.entries(value).every(
    ([key, count]) => allowed.has(key) && isNonNegativeInteger(count),
  );
}

function isStablePartialLanguageCounts(value: unknown) {
  if (!isRecord(value)) return false;
  const allowed = new Set(["empty", "zh", "en", "zh_en", "other"]);
  return Object.entries(value).every(
    ([key, count]) => allowed.has(key) && isNonNegativeInteger(count),
  );
}

function languageGateCountsAreEvidence(gate: unknown, evidence: unknown) {
  if (!isRecord(gate) || !isRecord(evidence)) return false;
  return Object.entries(gate).every(
    ([key, count]) => Number(count) <= Number(evidence[key] ?? 0),
  );
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

function isNonNegativeFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
