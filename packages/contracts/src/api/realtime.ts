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
} from "../realtime/diagnostics.js";

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
  turnId?: string;
  revision?: number;
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

export interface SessionReviewHighlightDto {
  type: "time" | "money" | "todo" | "location" | "number" | "custom";
  text: string;
}
export interface SessionReviewTermDto {
  sourceText: string;
  translatedText: string;
}

export interface SessionReviewActionItemDto {
  text: string;
  completed?: boolean;
  owner?: string;
  dueDate?: string;
  evidenceSegmentIds: string[];
}
export interface SessionReviewKeyFactDto {
  type: "time" | "money" | "location" | "number" | "custom";
  text: string;
  evidenceSegmentIds: string[];
}

export interface TermbaseTermDto {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: TranslationLanguageCode;
  targetLanguage: TranslationLanguageCode;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
}

export interface SaveTermbaseTermRequest {
  sourceText: string;
  translatedText: string;
  sourceLanguage?: TranslationLanguageCode;
  targetLanguage?: TranslationLanguageCode;
  termbaseId?: string;
  sessionId?: string;
}

export interface TermbaseTermsResponse {
  terms: TermbaseTermDto[];
}

export interface TermbaseTermResponse {
  term: TermbaseTermDto;
}

export interface SessionReviewResponse {
  provider: "local" | "openai_compatible";
  model?: string;
  promptVersion?: string;
  generatedAt: string;
  title?: string;
  summary: string;
  decisions?: string[];
  actionItems?: SessionReviewActionItemDto[];
  keyFacts?: SessionReviewKeyFactDto[];
  risks?: string[];
  openQuestions?: string[];
  highlights: SessionReviewHighlightDto[];
  terms: SessionReviewTermDto[];
  evidenceSegmentIds?: string[];
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
  turnId?: string;
  revision?: number;
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
