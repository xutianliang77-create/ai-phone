import type {
  AudioFrame,
  LanguageCode,
  TranslationLanguageCode,
  SegmentTimingDto,
  SpeakerAttributionDto,
  SpeakerAttributionOptionsDto,
} from "@translation/contracts";

export interface AsrSession {
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  asrHotwords?: string[];
  asrCorrections?: Array<{ fromText: string; toText: string }>;
  speakerAttribution?: SpeakerAttributionOptionsDto;
}

export interface TranscriptResult {
  segmentId: string;
  text: string;
  language: TranslationLanguageCode;
  confidence?: number;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
}

export interface AsrProvider {
  createSession(session: AsrSession): Promise<void>;
  transcribe(frame: AudioFrame): Promise<TranscriptResult | null>;
  flush(sessionId: string): Promise<TranscriptResult | null>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
