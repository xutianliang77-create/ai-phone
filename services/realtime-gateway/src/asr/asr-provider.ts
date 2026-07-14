import type {
  AsrEndpointReason,
  AsrEndpointMode,
  AudioFrame,
  LanguageCode,
  TranslationLanguageCode,
  SegmentTimingDto,
  SpeakerAttributionDto,
  SpeakerAttributionOptionsDto,
  RealtimeSessionDiagnosticsDto,
  SegmentVadContextDto,
} from "@translation/contracts";

export interface AsrSession {
  sessionId: string;
  userId?: string;
  asrEndpointMode?: AsrEndpointMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  asrHotwords?: string[];
  asrCorrections?: Array<{ fromText: string; toText: string }>;
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface TranscriptResult {
  segmentId: string;
  turnId?: string;
  revision?: number;
  text: string;
  language: TranslationLanguageCode;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  confidence?: number;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  endpointReason?: AsrEndpointReason;
  vadContext?: SegmentVadContextDto;
}

export interface AsrSpeakerTurnDiagnostics {
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

export interface AsrTurnBoundary {
  sessionId: string;
  boundaryMs: number;
}

export type AsrProviderResult = TranscriptResult | TranscriptResult[] | null;

export interface AsrProvider {
  createSession(session: AsrSession): Promise<void>;
  transcribe(frame: AudioFrame): Promise<AsrProviderResult>;
  flush(sessionId: string): Promise<AsrProviderResult>;
  commitBoundary?(boundary: AsrTurnBoundary): Promise<AsrProviderResult>;
  diagnostics?(
    sessionId: string,
  ): Promise<Partial<RealtimeSessionDiagnosticsDto>>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export function asrResults(result: AsrProviderResult): TranscriptResult[] {
  return result ? (Array.isArray(result) ? result : [result]) : [];
}
