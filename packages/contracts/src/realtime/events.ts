import type { AudioFrame, AudioOutput } from "./audio.js";
import type {
  RealtimeSessionDiagnosticsDto,
  SegmentVadContextDto,
} from "./diagnostics.js";
import type { SessionSegmentProviderUsageDto } from "../api/realtime.js";
import type { SessionSegmentRefinementDto } from "../api/realtime.js";
import type { RealtimeError, RealtimeErrorStage } from "./errors.js";
import type { TranslationLanguageCode } from "../shared/languages.js";
import type { AsrTokenTimingDto } from "../shared/asr-timing.js";
import type {
  SegmentTimingDto,
  SpeakerAttributionDto,
} from "../shared/speaker.js";

export interface SessionStartedEvent {
  type: "session.started";
  sessionId: string;
}

export interface TranscriptEvent {
  type: "transcript.partial" | "transcript.final";
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  text: string;
  rawText?: string;
  optimizedText?: string;
  language: TranslationLanguageCode;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  confidence?: number;
  refinement?: SessionSegmentRefinementDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  tokenTimings?: AsrTokenTimingDto[];
  /** Token offsets bound only to rawText, never to optimized text. */
  rawTokenTimings?: AsrTokenTimingDto[];
  vadContext?: SegmentVadContextDto;
}

export interface TranslationEvent {
  type: "translation.delta" | "translation.final";
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  text: string;
  language: TranslationLanguageCode;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  termHits?: string[];
  providerUsage?: SessionSegmentProviderUsageDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  vadContext?: SegmentVadContextDto;
}

export interface SpeakerUpdatedEvent {
  type: "speaker.updated";
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  speakerRevision?: number;
  speaker: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
}

export interface TranslationFailedEvent {
  type: "translation.failed";
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  message: string;
  language: TranslationLanguageCode;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  stage?: RealtimeErrorStage;
  provider?: string;
  retryable?: boolean;
}

export interface UsageTickEvent {
  type: "usage.tick";
  sessionId: string;
  billableSeconds: number;
  remainingSeconds: number;
  lowBalance?: boolean;
}

export type SessionEndReason =
  | "client_request"
  | "quota_exhausted"
  | "time_limit"
  | "connection_closed"
  | "connection_error";

export type RealtimeFlushStatus = "completed" | "empty" | "degraded";

export interface RealtimeFlushSummary {
  status: RealtimeFlushStatus;
  transcriptFinalCount: number;
  translationFinalCount: number;
  translationFailedCount: number;
  unresolvedSegmentCount: number;
  pipelineErrorCount: number;
  audioFlushed: boolean;
  providerFlushed: boolean;
}

export interface ClientTextSegmentEvent {
  type: "client.text.segment";
  sessionId: string;
  segmentId: string;
  text: string;
  language: TranslationLanguageCode;
  isFinal?: boolean;
  confidence?: number;
  timing?: SegmentTimingDto;
  tokenTimings?: AsrTokenTimingDto[];
}

export interface SessionEndedEvent {
  type: "session.ended";
  sessionId: string;
  reason?: SessionEndReason;
  billableSeconds?: number;
  remainingSeconds?: number;
  flush?: RealtimeFlushSummary;
  diagnostics?: RealtimeSessionDiagnosticsDto;
}

export interface SessionPausedEvent {
  type: "session.paused";
  sessionId: string;
}

export interface SessionResumedEvent {
  type: "session.resumed";
  sessionId: string;
}

export type ClientRealtimeEvent =
  | AudioFrame
  | ClientTextSegmentEvent
  | { type: "session.pause"; sessionId: string }
  | { type: "session.resume"; sessionId: string }
  | { type: "session.end"; sessionId: string };

export type ServerRealtimeEvent =
  | SessionStartedEvent
  | TranscriptEvent
  | TranslationEvent
  | SpeakerUpdatedEvent
  | TranslationFailedEvent
  | AudioOutput
  | UsageTickEvent
  | SessionPausedEvent
  | SessionResumedEvent
  | SessionEndedEvent
  | RealtimeError;
