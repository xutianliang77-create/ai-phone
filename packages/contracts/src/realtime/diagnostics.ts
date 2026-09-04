export type AsrEndpointReason =
  | "silence"
  | "max_duration"
  | "flush"
  | "speaker_boundary";

export interface SegmentVadContextDto {
  endpointReason: AsrEndpointReason;
  vadModelFingerprint?: string;
  endpointPolicyFingerprint: string;
}

export interface SpeechPipelineTimingDto {
  asrStartedAtMs?: number;
  asrFinalAtMs?: number;
  processingQueueEnteredAtMs?: number;
  processingQueueReleasedAtMs?: number;
  turnBufferReleasedAtMs?: number;
  transcriptReadyAtMs?: number;
  translationStartedAtMs?: number;
  translationFirstTokenAtMs?: number;
  translationFinalAtMs?: number;
  ttsStartedAtMs?: number;
  ttsFirstAudioAtMs?: number;
  ttsReadyAtMs?: number;
  eventPublishStartedAtMs?: number;
}

export function isSpeechPipelineTiming(
  value: unknown,
): value is SpeechPipelineTimingDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Object.keys(value).every((field) =>
    pipelineTimingFields.includes(field as typeof pipelineTimingFields[number])
  )) return false;
  if (!pipelineTimingFields.every((field) => {
    const timestamp = (value as Record<string, unknown>)[field];
    return timestamp === undefined ||
      typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0;
  })) return false;
  const timing = value as SpeechPipelineTimingDto;
  return ordered(timing.asrStartedAtMs, timing.asrFinalAtMs) &&
    ordered(timing.processingQueueEnteredAtMs, timing.processingQueueReleasedAtMs) &&
    ordered(timing.translationStartedAtMs, timing.translationFinalAtMs) &&
    ordered(timing.translationStartedAtMs, timing.translationFirstTokenAtMs) &&
    ordered(timing.translationFirstTokenAtMs, timing.translationFinalAtMs) &&
    ordered(timing.ttsStartedAtMs, timing.ttsReadyAtMs) &&
    ordered(timing.ttsStartedAtMs, timing.ttsFirstAudioAtMs) &&
    ordered(timing.ttsFirstAudioAtMs, timing.ttsReadyAtMs);
}

const pipelineTimingFields = [
  "asrStartedAtMs",
  "asrFinalAtMs",
  "processingQueueEnteredAtMs",
  "processingQueueReleasedAtMs",
  "turnBufferReleasedAtMs",
  "transcriptReadyAtMs",
  "translationStartedAtMs",
  "translationFirstTokenAtMs",
  "translationFinalAtMs",
  "ttsStartedAtMs",
  "ttsFirstAudioAtMs",
  "ttsReadyAtMs",
  "eventPublishStartedAtMs",
] as const;

function ordered(first: number | undefined, second: number | undefined) {
  return first === undefined || second === undefined || first <= second;
}

export function isSegmentVadContext(
  value: unknown,
): value is SegmentVadContextDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SegmentVadContextDto>;
  return ["silence", "max_duration", "flush", "speaker_boundary"]
    .includes(candidate.endpointReason ?? "") &&
    isSha256(candidate.endpointPolicyFingerprint) &&
    (candidate.vadModelFingerprint === undefined ||
      isSha256(candidate.vadModelFingerprint));
}

function isSha256(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export interface RealtimeAudioDiagnosticsDto {
  receivedFrameCount: number;
  processedBatchCount: number;
  droppedFrameCount: number;
}

export interface RealtimeSpeakerTurnDiagnosticsDto {
  confirmedBoundaryCount: number;
  commitHitCount: number;
  commitMissCount: number;
  commitErrorCount: number;
  endpointRaceCount: number;
  averageConfirmationLatencyMs: number;
  maxConfirmationLatencyMs: number;
  committedAudioMs: number;
  endpointReasons: Partial<Record<AsrEndpointReason, number>>;
  boundaryRevisionAttemptCount?: number;
  boundaryRevisionSuccessCount?: number;
  boundaryRevisionFailureCount?: number;
  boundaryReassignedCharacterCount?: number;
  unresolvedCommitMissCount?: number;
  boundaryOutcomeCounts?: Partial<Record<SpeakerBoundaryOutcome, number>>;
  coordinatorDecisionCounts?: Partial<Record<
    SpeakerTurnCoordinatorDecisionReason,
    number
  >>;
  confirmedSpeakerCount?: number;
}

export type SpeakerBoundaryOutcome =
  | "commit_hit"
  | "commit_error"
  | "witness_reassignment"
  | "token_timing_split"
  | "noop_after_endpoint"
  | "unresolved";

export type SpeakerTurnCoordinatorDecisionReason =
  | "no_span"
  | "overlap_only"
  | "missing_confidence"
  | "evidence_too_short"
  | "dominance_too_low"
  | "novel_confidence_too_low"
  | "known_confidence_too_low"
  | "current_speaker"
  | "candidate_reset_label"
  | "candidate_reset_start_drift"
  | "stable_window_pending"
  | "initial_speaker_confirmed"
  | "boundary_confirmed";

export interface RealtimeSpeakerRevisionDiagnosticsDto {
  configuredProvider: "http";
  mode: "shadow" | "apply";
  requestCount: number;
  completedCount: number;
  acceptedCount: number;
  emittedUpdateCount: number;
  errorCount: number;
  staleResultCount: number;
  splitParentCount: number;
  splitChildCount: number;
  splitRejectedCount: number;
  splitSkippedParentCount?: number;
  splitSkippedReasonCounts?: Partial<Record<
    SpeakerTokenSplitRejectionReason,
    number
  >>;
  cardinalityMismatchCount: number;
  lastLatencyMs?: number;
}

export interface RealtimeSpeakerAssemblyRepairDiagnosticsDto {
  enabled: boolean;
  cachedParentCount: number;
  boundaryEvidenceArrivalCount: number;
  repairAttemptCount: number;
  repairAcceptedCount: number;
  delayedRepairAcceptedCount: number;
  repairRejectedCount: number;
  revisionEmittedCount: number;
  expiredParentCount: number;
  pendingParentCount: number;
  rejectionReasonCounts: Partial<Record<
    SpeakerTokenSplitRejectionReason,
    number
  >>;
  averageWaitMs: number;
  maxWaitMs: number;
  noopEvaluationCount?: number;
  noopAcceptedCount?: number;
  noopRejectionReasonCounts?: Partial<Record<
    SpeakerEndpointNoopRejectionReason,
    number
  >>;
}

export type SpeakerEndpointNoopRejectionReason =
  | "crossing_parent"
  | "missing_previous_final"
  | "missing_next_final"
  | "previous_gap_exceeded"
  | "next_gap_exceeded"
  | "unknown_or_overlap";

export type SpeakerTokenSplitRejectionReason =
  | "not_final"
  | "missing_timing"
  | "missing_token_timing"
  | "invalid_token_timing"
  | "explicit_overlap"
  | "unconfirmed_boundary"
  | "turn_lineage_mismatch"
  | "protected_surface"
  | "no_safe_token_boundary"
  | "sortformer_evidence_mismatch"
  | "text_conservation_failed";

export interface RealtimeAsrEndpointPolicyDto {
  mode: "conversation" | "listening" | "call_link" | "pstn";
  minAudioMs: number;
  endpointSilenceMs: number;
  maxAudioMs: number;
  prerollMs: number;
  fingerprint: string;
}

export type StablePartialRejectionReason =
  | "no_text"
  | "insufficient_units"
  | "duplicate_partial"
  | "backtrack"
  | "language_gate"
  | "context_echo"
  | "extension_pending"
  | "final_fallback";

export type StablePartialLanguageEvidence =
  | "empty"
  | "zh"
  | "en"
  | "zh_en"
  | "other";

export interface RealtimeStablePartialDiagnosticsDto {
  enabled: boolean;
  policy: string;
  minimumPushAudioMs?: number;
  eligibleSegmentCount: number;
  activeSegment: boolean;
  decodeCount: number;
  decisionCount?: number;
  emittedCount: number;
  rejectionCounts?: Partial<Record<StablePartialRejectionReason, number>>;
  languageEvidenceSource?: "qwen_streaming_state_label";
  languageEvidenceCounts?: Partial<
    Record<StablePartialLanguageEvidence, number>
  >;
  languageGateCounts?: Partial<Record<StablePartialLanguageEvidence, number>>;
  scheduledPushCount?: number;
  completedPushCount?: number;
  coalescedObservationCount?: number;
  invalidatedPushCount?: number;
  inFlight?: boolean;
  resultReady?: boolean;
  pendingAudioMs?: number;
  maxPendingAudioMs?: number;
  averagePushLatencyMs?: number;
  maxPushLatencyMs?: number;
  firstStablePartialLatencyMs?: number;
  lastStablePartialLatencyMs?: number;
}

export interface RealtimeVadDiagnosticsDto {
  configuredProvider: "marblenet" | "rms";
  activeProvider: "marblenet" | "rms" | "rms_fallback";
  threshold: number;
  analyzedFrameCount: number;
  speechFrameCount: number;
  speechFrameRatio: number;
  probabilityMin?: number;
  probabilityMax?: number;
  probabilityMean?: number;
  fallbackCount: number;
  fallbackReason?: "assets_missing" | "load_failed" | "runtime_failed";
  modelFingerprint?: string;
  endpointPolicy: RealtimeAsrEndpointPolicyDto;
  stablePartial?: RealtimeStablePartialDiagnosticsDto;
}

export interface RealtimeAudioLegDiagnosticsDto {
  legId: string;
  speakerRole: "host" | "guest";
  dropPolicy: "drop_oldest" | "reject_newest";
  capacityFrames: number;
  receivedFrames: number;
  dequeuedFrames: number;
  processedFrames: number;
  failedFrames: number;
  inFlightFrames: number;
  droppedFrames: number;
  overflowDroppedFrames: number;
  shutdownDiscardedFrames: number;
  sequenceGapFrames: number;
  queueDepthFrames: number;
  highWatermarkFrames: number;
  backpressureEvents: number;
  firstReceivedSequence?: number;
  lastReceivedSequence?: number;
  lastProcessedSequence?: number;
}

export interface RealtimeRtcSampleDto {
  observedAtMs: number;
  rttMs?: number;
  jitterMs?: number;
  packetsReceived?: number;
  packetsLost?: number;
}

export interface RealtimeRtcDiagnosticsDto {
  attemptedSampleCount: number;
  unavailableSampleCount: number;
  discardedSampleCount: number;
  samples: RealtimeRtcSampleDto[];
}

export interface RealtimeModelFingerprintDto {
  stage: "pipeline" | "asr" | "translation" | "tts";
  provider: string;
  model?: string;
  profile?: string;
  fingerprint: string;
}

export interface RealtimeNodeDiagnosticsDto {
  nodeId: string;
  runtimeId: string;
  generation?: number;
  startedAtMs: number;
  endedAtMs: number;
  audioLegs: RealtimeAudioLegDiagnosticsDto[];
  rtc?: RealtimeRtcDiagnosticsDto;
  modelFingerprints: RealtimeModelFingerprintDto[];
}

export interface RealtimeSessionDiagnosticsDto {
  version: 1;
  audio: RealtimeAudioDiagnosticsDto;
  speakerTurns?: RealtimeSpeakerTurnDiagnosticsDto;
  speakerRevision?: RealtimeSpeakerRevisionDiagnosticsDto;
  speakerAssemblyRepair?: RealtimeSpeakerAssemblyRepairDiagnosticsDto;
  vad?: RealtimeVadDiagnosticsDto;
  nodes?: RealtimeNodeDiagnosticsDto[];
}
