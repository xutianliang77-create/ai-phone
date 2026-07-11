export const TRANSLATION_LANGUAGES = [
  "zh",
  "en",
  "fr",
  "pt",
  "es",
  "ja",
  "tr",
  "ru",
  "ar",
  "ko",
  "th",
  "it",
  "de",
  "vi",
  "ms",
  "id",
  "tl",
  "hi",
  "zh-Hant",
  "pl",
  "cs",
  "nl",
  "km",
  "my",
  "fa",
  "gu",
  "ur",
  "te",
  "mr",
  "he",
  "bn",
  "ta",
  "uk",
  "bo",
  "kk",
  "mn",
  "ug",
  "yue",
] as const;

export const SUPPORTED_LANGUAGES = [
  "auto",
  ...TRANSLATION_LANGUAGES,
] as const;

export type TranslationLanguageCode = typeof TRANSLATION_LANGUAGES[number];
export type LanguageCode = typeof SUPPORTED_LANGUAGES[number];

const supportedLanguageSet = new Set<string>(SUPPORTED_LANGUAGES);
const translationLanguageSet = new Set<string>(TRANSLATION_LANGUAGES);

export function isSupportedLanguage(value: string): value is LanguageCode {
  return supportedLanguageSet.has(value);
}

export function isTranslationLanguage(
  value: string,
): value is TranslationLanguageCode {
  return translationLanguageSet.has(value);
}
