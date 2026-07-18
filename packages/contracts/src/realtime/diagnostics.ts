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
}

export interface RealtimeAsrEndpointPolicyDto {
  mode: "conversation" | "listening" | "call_link" | "pstn";
  minAudioMs: number;
  endpointSilenceMs: number;
  maxAudioMs: number;
  prerollMs: number;
  fingerprint: string;
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
}

export interface RealtimeAudioLegDiagnosticsDto {
  legId: string;
  speakerRole: "host" | "guest";
  dropPolicy: "drop_oldest";
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
  vad?: RealtimeVadDiagnosticsDto;
  nodes?: RealtimeNodeDiagnosticsDto[];
}
