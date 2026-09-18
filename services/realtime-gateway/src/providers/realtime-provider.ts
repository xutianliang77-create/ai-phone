import type {
  AsrEndpointReason,
  AsrTokenTimingDto,
  AudioFrame,
  AsrEndpointMode,
  LanguageCode,
  SegmentTimingDto,
  SegmentVadContextDto,
  SpeakerAttributionDto,
  TranslationLanguageCode,
  ServerRealtimeEvent,
  TermbaseTermDto,
  SpeakerAttributionOptionsDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";

export interface RealtimeProviderSession {
  sessionId: string;
  userId?: string;
  asrEndpointMode?: AsrEndpointMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  /** Exact automatic pair from the versioned processing contract. Optional
   * only for legacy/private sessions that retain their existing fallback. */
  languagePair?: readonly [TranslationLanguageCode, TranslationLanguageCode];
  voiceOutput: boolean;
  terminology?: TermbaseTermDto[];
  asrHotwords?: string[];
  asrCorrections?: Array<{ fromText: string; toText: string }>;
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface TextSegmentInput {
  sessionId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  text: string;
  language: TranslationLanguageCode;
  dominantLanguage?: TranslationLanguageCode;
  detectedLanguages?: TranslationLanguageCode[];
  mixedLanguage?: boolean;
  isFinal: boolean;
  confidence?: number;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
  tokenTimings?: AsrTokenTimingDto[];
  endpointReason?: AsrEndpointReason;
  vadContext?: SegmentVadContextDto;
  finalizeImmediately?: boolean;
}

export interface RealtimeProvider {
  setEventListener?(sessionId:string,listener:(event:ServerRealtimeEvent)=>void):()=>void;
  name: string;
  /** Supplier transport batch limit. This does not change the phone capture
   * frame or any local/on-device VAD behavior. */
  maxInputBatchAudioMs?: number;
  createSession(session: RealtimeProviderSession): Promise<void>;
  sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent>;
  sendText?(segment: TextSegmentInput): AsyncGenerator<ServerRealtimeEvent>;
  flushSession?(
    sessionId: string,
    options?: { finishSession?: boolean },
  ): AsyncGenerator<ServerRealtimeEvent>;
  diagnostics?(
    sessionId: string,
  ): Promise<Partial<RealtimeSessionDiagnosticsDto>>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
