import {
  isTranslationLanguage,
  type UpsertSessionSegmentRequest,
} from "@translation/contracts";

export function isValidTurnLanguageProfile(
  body: Partial<UpsertSessionSegmentRequest>,
) {
  return isOptionalTranslationLanguage(body.dominantLanguage) &&
    isOptionalTranslationLanguages(body.detectedLanguages) &&
    (body.mixedLanguage === undefined || typeof body.mixedLanguage === "boolean");
}

function isOptionalTranslationLanguage(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && isTranslationLanguage(value));
}

function isOptionalTranslationLanguages(value: unknown) {
  return value === undefined ||
    (Array.isArray(value) && value.length > 0 &&
      value.every((item) =>
        typeof item === "string" && isTranslationLanguage(item)));
}
