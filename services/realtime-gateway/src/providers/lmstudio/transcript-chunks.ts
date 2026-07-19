import type { TranscriptResult } from "../../asr/asr-provider.js";
import { analyzeTurnLanguage } from "../../segments/turn-language-profile.js";

export function transcriptVariantsForTranslation(
  transcript: TranscriptResult,
  _autoReverse: boolean,
  allowTextLanguageOverride: boolean,
): TranscriptResult[] {
  const profile = analyzeTurnLanguage(transcript.text, transcript.language);
  return [{
    ...transcript,
    ...profile,
    language: allowTextLanguageOverride
      ? profile.dominantLanguage
      : transcript.language,
  }];
}
