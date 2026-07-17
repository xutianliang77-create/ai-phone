import type {
  AsrEndpointReason,
  SegmentTimingDto,
  SegmentVadContextDto,
  SpeechPipelineTimingDto,
  SpeakerAttributionDto,
  TranslationLanguageCode,
} from "@translation/contracts";

export interface SpeechTranscript {
  segmentId: string;
  speechId?: string;
  turnId?: string;
  revision?: number;
  pipelineTiming?: SpeechPipelineTimingDto;
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
