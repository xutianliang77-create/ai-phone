import type {
  LanguageCode,
  TranslationLanguageCode,
} from "../shared/languages.js";
import type { PersistedRealtimeSessionState } from "../realtime/state-machine.js";
import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
} from "../shared/speaker.js";
import type {
  RealtimeSessionDiagnosticsDto,
  SegmentVadContextDto,
  SpeechPipelineTimingDto,
} from "../realtime/diagnostics.js";
import type { SessionReviewResponse } from "./realtime-review.js";
import type {
  SessionQualityIngestDto,
  SessionQualityModelFingerprintDto,
  SessionQualityRtcDto,
} from "./session-quality.js";

export type {
  SaveTermbaseTermRequest,
  SessionReviewActionItemDto,
  SessionReviewHighlightDto,
  SessionReviewKeyFactDto,
  SessionReviewResponse,
  SessionReviewTermDto,
  TermbaseTermDto,
  TermbaseTermResponse,
  TermbaseTermsResponse,
} from "./realtime-review.js";
export type {
  SessionQualityIngestDto,
  SessionQualityModelFingerprintDto,
  SessionQualityRtcDto,
} from "./session-quality.js";

export interface SessionStatusResponse {
  sessionId: string;
  status: PersistedRealtimeSessionState;
  consumedSeconds: number;
}

export interface FinalizeRealtimeSessionRequest {
  sessionId: string;
  idempotencyKey: string;
  billableSeconds: number;
  segments: SessionSegmentDto[];
}

export interface UpdateRealtimeSessionStateRequest {
  status: Extract<PersistedRealtimeSessionState, "active" | "paused" | "failed">;
}

export interface SessionSegmentDto {
  id: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  pipelineGeneration?: number;
  pipelineTiming?: SpeechPipelineTimingDto;
  sourceText: string;
  rawText?: string;
  optimizedText?: string;
  translatedText: string;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  vadContext?: SegmentVadContextDto;
}

export type SessionSegmentStage =
  | "connection"
  | "asr"
  | "translation"
  | "tts"
  | "worker"
  | "session"
  | "provider";

export interface SessionSegmentProviderUsageDto {
  provider: string;
  model?: string;
  latencyMs?: number;
  inputCharacters?: number;
  outputCharacters?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens?: number;
}

export interface SessionSegmentRefinementDto {
  provider: string;
  model?: string;
  promptVersion: string;
  confidence: number;
  latencyMs: number;
  operations: string[];
  protectedTermsKept: string[];
  warnings: string[];
  fallbackReason?: string;
}

export interface SaveSessionSegmentsRequest {
  segments: SessionSegmentDto[];
}

export interface SaveTypeToSpeakSessionRequest {
  sourceText: string;
  translatedText: string;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
}

export interface SaveTextTranslationSessionRequest {
  sourceText: string;
  translatedText?: string;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  sourceKind?: "type_to_speak" | "scan" | "text";
}

export interface UpsertSessionSegmentRequest {
  sessionId: string;
  segmentId: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  pipelineGeneration?: number;
  pipelineTiming?: SpeechPipelineTimingDto;
  sourceText?: string;
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  vadContext?: SegmentVadContextDto;
}

export interface SessionListItem {
  sessionId: string;
  mode: string;
  status: PersistedRealtimeSessionState;
  kind?: "realtime" | "call" | "scan";
  title?: string;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  speakerCount?: number;
  consumedSeconds: number;
  createdAt: string;
  endedAt?: string;
  segmentCount: number;
}
export type CallPlaybackStatus =
  | "queued"
  | "streaming"
  | "interrupting"
  | "interrupted"
  | "completed"
  | "failed";
export type CallPlaybackInterruptReason =
  | "barge_in"
  | "session_end"
  | "superseded"
  | "failure"
  | "recovery";
export interface CallPlaybackBargeInDto {
  detectedAt?: string;
  confirmedAt?: string;
  stopLatencyMs?: number;
  speechDurationMs?: number;
  vadProvider?: string;
  vadProbability?: number;
  preRollMs?: number;
}
export interface CallPlaybackDto {
  id: string;
  segmentId: string;
  sourceLegId: string;
  targetLegId: string;
  generation: number;
  status: CallPlaybackStatus;
  provider?: string;
  model?: string;
  audioDurationMs?: number;
  interruptReason?: CallPlaybackInterruptReason;
  bargeIn?: CallPlaybackBargeInDto;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface SessionDetailResponse extends SessionListItem {
  segments: SessionSegmentDto[];
  playbacks?: CallPlaybackDto[];
  review?: SessionReviewResponse | null;
  diagnostics?: RealtimeSessionDiagnosticsDto;
}

export interface SessionQualityProviderDto {
  stage: string;
  provider: string;
  model?: string;
  segmentCount: number;
}

export interface SessionQualityLatencyDistributionDto {
  sampleCount: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface SessionQualityPipelineDto {
  asrFinal?: SessionQualityLatencyDistributionDto;
  processingQueueWait?: SessionQualityLatencyDistributionDto;
  turnBufferWait?: SessionQualityLatencyDistributionDto;
  translationFirstToken?: SessionQualityLatencyDistributionDto;
  translationFinal?: SessionQualityLatencyDistributionDto;
  ttsFirstAudio?: SessionQualityLatencyDistributionDto;
  ttsFinal?: SessionQualityLatencyDistributionDto;
  captionEndToEnd?: SessionQualityLatencyDistributionDto;
  audioReadyEndToEnd?: SessionQualityLatencyDistributionDto;
  playbackStartEndToEnd?: SessionQualityLatencyDistributionDto;
}

export interface SessionQualityReportResponse {
  version: 1;
  sessionId: string;
  generatedAt: string;
  status: PersistedRealtimeSessionState;
  consumedSeconds: number;
  segments: {
    total: number;
    translated: number;
    sourceOnly: number;
    translationCoverage: number;
    mixedLanguage: number;
  };
  latency: {
    sampleCount: number;
    averageMs: number;
    p95Ms: number;
    maxMs: number;
  };
  pipeline?: SessionQualityPipelineDto;
  ingest?: SessionQualityIngestDto;
  rtc?: SessionQualityRtcDto;
  modelFingerprints?: SessionQualityModelFingerprintDto[];
  audio?: {
    receivedFrames: number;
    droppedFrames: number;
    dropRate: number;
  };
  vad?: {
    configuredProvider: string;
    activeProvider: string;
    fallbackCount: number;
    fallbackReason?: string;
    speechFrameRatio: number;
    modelFingerprint?: string;
    endpointPolicyFingerprint: string;
  };
  endpoints: Partial<Record<import("../realtime/diagnostics.js").AsrEndpointReason, number>>;
  speakers: {
    identified: number;
    unknownSegments: number;
    overlapSegments: number;
  };
  providers: SessionQualityProviderDto[];
  playback?: {
    total: number;
    completed: number;
    interrupted: number;
    failed: number;
    bargeInInterruptions: number;
  };
  bargeIn?: {
    sampleCount: number;
    averageStopLatencyMs: number;
    p95StopLatencyMs: number;
    maxStopLatencyMs: number;
  };
  flags: string[];
}
export interface SessionSpeakerDto {
  speaker: SpeakerAttributionDto;
  segmentCount: number;
  totalDurationMs: number;
}

export interface SessionSpeakersResponse {
  sessionId: string;
  speakers: SessionSpeakerDto[];
}

export interface RenameSessionSpeakerRequest {
  displayName: string;
}

export interface SessionExportResponse {
  sessionId: string;
  filename: string;
  mimeType: "text/plain" | "text/markdown" | "application/json" | "text/csv";
  content: string;
}

export interface UsageBalanceResponse {
  userId: string;
  remainingSeconds: number;
}
