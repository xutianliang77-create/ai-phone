import type { TranscriptResult } from "../../asr/asr-provider.js";
import { analyzeTurnLanguage, looksLikeProtectedTerm } from "../../segments/turn-language-profile.js";

export function transcriptVariantsForTranslation(
  transcript: TranscriptResult,
  _autoReverse: boolean,
  allowTextLanguageOverride: boolean,
): TranscriptResult[] {
  const profile = analyzeTurnLanguage(transcript.text, transcript.language);
  // Qwen's automatic source result has already passed its signed language-pair
  // check.  Keep that supplier-confirmed language rather than letting a
  // transcript script heuristic reclassify a mixed utterance and suppress MT.
  const providerConfirmedLanguage = transcript.automaticLanguageStatus === "detected";
  const automaticLanguageStatus = providerConfirmedLanguage
    ? "detected" as const
    : allowTextLanguageOverride
      ? automaticLanguageStatusForText(transcript.text, profile)
      : undefined;
  return [{
    ...transcript,
    ...profile,
    language: !providerConfirmedLanguage && allowTextLanguageOverride && automaticLanguageStatus === "detected"
      ? profile.dominantLanguage
      : transcript.language,
    ...(automaticLanguageStatus ? { automaticLanguageStatus } : {}),
  }];
}

/** This records only a bounded text-language decision. It never invents an
 * acoustic language result; provider/profile qualification owns whether the
 * selected language pair may use this evidence. */
function automaticLanguageStatusForText(
  text: string,
  profile: ReturnType<typeof analyzeTurnLanguage>,
) {
  const hasChinese = /[\u4e00-\u9fff]/u.test(text);
  const latinWords = (text.match(/[A-Za-z][A-Za-z0-9_/-]*/gu) ?? [])
    .filter((word) => !looksLikeProtectedTerm(word));
  const hasEnglish = hasChinese ? latinWords.length >= 2 : latinWords.length > 0;
  if (hasChinese && hasEnglish) return "mixed" as const;
  if ((hasChinese || hasEnglish) && profile.detectedLanguages.length === 1) {
    return "detected" as const;
  }
  return "unknown" as const;
}
