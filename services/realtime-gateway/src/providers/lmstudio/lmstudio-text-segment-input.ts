import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { TextSegmentInput } from "../realtime-provider.js";

export function transcriptFromTextSegment(
  segment: TextSegmentInput,
  text: string,
): TranscriptResult {
  return {
    segmentId: segment.segmentId,
    turnId: segment.turnId,
    revision: segment.revision,
    isFinal: segment.isFinal,
    text,
    language: segment.language,
    dominantLanguage: segment.dominantLanguage,
    detectedLanguages: segment.detectedLanguages,
    mixedLanguage: segment.mixedLanguage,
    confidence: segment.confidence,
    speaker: segment.speaker,
    timing: segment.timing,
    tokenTimings: segment.tokenTimings,
    endpointReason: segment.endpointReason,
    vadContext: segment.vadContext,
  };
}
