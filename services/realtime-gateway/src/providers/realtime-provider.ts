import type {
  AudioFrame,
  AsrEndpointMode,
  LanguageCode,
  TranslationLanguageCode,
  ServerRealtimeEvent,
  TermbaseTermDto,
  SpeakerAttributionOptionsDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";

export interface RealtimeProviderSession {
  sessionId: string;
  asrEndpointMode?: AsrEndpointMode;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  autoReverseTargetLanguage?: boolean;
  voiceOutput: boolean;
  terminology?: TermbaseTermDto[];
  asrHotwords?: string[];
  asrCorrections?: Array<{ fromText: string; toText: string }>;
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface TextSegmentInput {
  sessionId: string;
  segmentId: string;
  text: string;
  language: TranslationLanguageCode;
  isFinal: boolean;
  confidence?: number;
}

export interface RealtimeProvider {
  name: string;
  createSession(session: RealtimeProviderSession): Promise<void>;
  sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent>;
  sendText?(segment: TextSegmentInput): AsyncGenerator<ServerRealtimeEvent>;
  flushSession?(sessionId: string): AsyncGenerator<ServerRealtimeEvent>;
  diagnostics?(
    sessionId: string,
  ): Promise<Partial<RealtimeSessionDiagnosticsDto>>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
