import type { CallRoomTranslationLanguage } from "@translation/contracts";

export function detectCallLanguage(text: string): CallRoomTranslationLanguage {
  const chineseChars = Array.from(text.matchAll(/[\u4e00-\u9fff]/g)).length;
  const latinChars = Array.from(text.matchAll(/[A-Za-z]/g)).length;
  return chineseChars >= latinChars ? "zh" : "en";
}

export function oppositeCallLanguage(
  sourceLanguage: CallRoomTranslationLanguage,
): CallRoomTranslationLanguage {
  return sourceLanguage === "zh" ? "en" : "zh";
}
