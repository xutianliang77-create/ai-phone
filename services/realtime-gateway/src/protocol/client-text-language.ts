import {
  isTranslationLanguage,
  type TranslationLanguageCode,
} from "@translation/contracts";

export function normalizeClientTextLanguage(
  rawLanguage: unknown,
  targetLanguage: TranslationLanguageCode,
): TranslationLanguageCode {
  if (typeof rawLanguage === "string") {
    const raw = rawLanguage.trim();
    if (isTranslationLanguage(raw)) return raw;
    const language = raw.toLowerCase();
    if (language === "zh-hant") return "zh-Hant";
    if (isTranslationLanguage(language)) return language;
    const baseLanguage = language.split("-")[0];
    if (isTranslationLanguage(baseLanguage)) return baseLanguage;
    if (
      language === "zh" ||
      language.startsWith("zh-") ||
      language === "cmn" ||
      language.startsWith("cmn-")
    ) {
      return "zh";
    }
    if (language === "en" || language.startsWith("en-")) {
      return "en";
    }
  }
  return targetLanguage === "zh" ? "en" : "zh";
}
