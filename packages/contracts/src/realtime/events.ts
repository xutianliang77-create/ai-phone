import type { AudioFrame, AudioOutput } from "./audio.js";
import type { SessionSegmentProviderUsageDto } from "../api/realtime.js";
import type { SessionSegmentRefinementDto } from "../api/realtime.js";
import type { RealtimeError, RealtimeErrorStage } from "./errors.js";
import type { TranslationLanguageCode } from "../shared/languages.js";

export interface SessionStartedEvent {
  type: "session.started";
  sessionId: string;
}

export interface TranscriptEvent {
  type: "transcript.partial" | "transcript.final";
  sessionId: string;
  segmentId: string;
  text: string;
  rawText?: string;
  optimizedText?: string;
  language: TranslationLanguageCode;
  confidence?: number;
  refinement?: SessionSegmentRefinementDto;
}

export interface TranslationEvent {
  type: "translation.delta" | "translation.final";
  sessionId: string;
  segmentId: string;
  text: string;
  language: TranslationLanguageCode;
  termHits?: string[];
  providerUsage?: SessionSegmentProviderUsageDto;
}

export interface TranslationFailedEvent {
  type: "translation.failed";
  sessionId: string;
  segmentId: string;
  message: string;
  language: TranslationLanguageCode;
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
}

export interface SessionEndedEvent {
  type: "session.ended";
  sessionId: string;
  reason?: SessionEndReason;
  billableSeconds?: number;
  remainingSeconds?: number;
  flush?: RealtimeFlushSummary;
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
  | TranslationFailedEvent
  | AudioOutput
  | UsageTickEvent
  | SessionPausedEvent
  | SessionResumedEvent
  | SessionEndedEvent
  | RealtimeError;
