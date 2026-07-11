import type {
  LanguageCode,
  TranslationLanguageCode,
} from "../shared/languages.js";

export interface SessionStatusResponse {
  sessionId: string;
  status: "created" | "active" | "paused" | "ended" | "failed";
  consumedSeconds: number;
}

export interface SessionSegmentDto {
  id: string;
  sourceText: string;
  rawText?: string;
  optimizedText?: string;
  translatedText: string;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
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
  sourceText?: string;
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
}

export interface SessionListItem {
  sessionId: string;
  mode: string;
  status: "created" | "active" | "paused" | "ended" | "failed";
  consumedSeconds: number;
  createdAt: string;
  endedAt?: string;
  segmentCount: number;
}

export interface SessionDetailResponse extends SessionListItem {
  segments: SessionSegmentDto[];
  review?: SessionReviewResponse | null;
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
