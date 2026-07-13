import type { TranslationLanguageCode } from "@translation/contracts";

export interface TurnLanguageProfile {
  dominantLanguage: TranslationLanguageCode;
  detectedLanguages: TranslationLanguageCode[];
  mixedLanguage: boolean;
}

export function turnLanguageEventFields(
  profile: Partial<TurnLanguageProfile>,
) {
  return {
    dominantLanguage: profile.dominantLanguage,
    detectedLanguages: profile.detectedLanguages,
    mixedLanguage: profile.mixedLanguage,
  };
}

export function analyzeTurnLanguage(
  text: string,
  fallbackLanguage: TranslationLanguageCode,
): TurnLanguageProfile {
  if (fallbackLanguage !== "zh" && fallbackLanguage !== "en") {
    return profileForOtherLanguage(text, fallbackLanguage);
  }
  const chineseUnits = chineseCharacterCount(text);
  const latinRuns = text.match(/[A-Za-z][A-Za-z0-9_/-]*/gu) ?? [];
  const englishWords = latinRuns.filter((run) => !looksLikeProtectedTerm(run));
  const hasEnglish = chineseUnits === 0
    ? latinRuns.length > 0
    : englishWords.length >= 2;
  const detectedLanguages: TranslationLanguageCode[] = [
    ...(chineseUnits > 0 ? ["zh" as const] : []),
    ...(hasEnglish ? ["en" as const] : []),
  ];
  if (detectedLanguages.length === 0) detectedLanguages.push(fallbackLanguage);

  const englishUnits = englishWords.length * 2;
  return {
    dominantLanguage: detectedLanguages.length === 1
      ? detectedLanguages[0]
      : englishUnits > chineseUnits ? "en" : "zh",
    detectedLanguages,
    mixedLanguage: detectedLanguages.length > 1,
  };
}

export function looksLikeProtectedTerm(text: string) {
  const compact = text.replace(/\s+/gu, "");
  if (!compact) return false;
  if (/[0-9_/-]/u.test(compact) || /[a-z][A-Z]/u.test(compact)) return true;
  return technicalAcronyms.has(compact.toUpperCase());
}

function profileForOtherLanguage(
  text: string,
  fallbackLanguage: TranslationLanguageCode,
): TurnLanguageProfile {
  const hasChinese = chineseCharacterCount(text) > 0;
  const detectedLanguages = hasChinese
    ? [fallbackLanguage, "zh" as const]
    : [fallbackLanguage];
  return {
    dominantLanguage: fallbackLanguage,
    detectedLanguages,
    mixedLanguage: detectedLanguages.length > 1,
  };
}

function chineseCharacterCount(text: string) {
  return text.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;
}

const technicalAcronyms = new Set([
  "API", "ASR", "CPU", "GPU", "LLM", "OCR", "RTC", "TTS", "VAD",
]);
