import type {
  AudioFrame,
  LanguageCode,
  TranslationLanguageCode,
} from "@translation/contracts";

export interface AsrSession {
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
  asrHotwords?: string[];
  asrCorrections?: Array<{ fromText: string; toText: string }>;
}

export interface TranscriptResult {
  segmentId: string;
  text: string;
  language: TranslationLanguageCode;
  confidence?: number;
}

export interface AsrProvider {
  createSession(session: AsrSession): Promise<void>;
  transcribe(frame: AudioFrame): Promise<TranscriptResult | null>;
  flush(sessionId: string): Promise<TranscriptResult | null>;
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
