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
  closeSession(sessionId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export function asrResults(result: AsrProviderResult): TranscriptResult[] {
  return result ? (Array.isArray(result) ? result : [result]) : [];
}
