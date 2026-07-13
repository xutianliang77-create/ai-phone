import type {
  AsrEndpointReason,
  SegmentTimingDto,
  SegmentVadContextDto,
  SpeakerAttributionDto,
  TranslationLanguageCode,
} from "@translation/contracts";

export interface SpeechTranscript {
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
