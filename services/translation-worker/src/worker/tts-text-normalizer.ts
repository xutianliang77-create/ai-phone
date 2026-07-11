import type { CallRoomTranslationLanguage } from "@translation/contracts";

const zhDigitNames: Record<string, string> = {
  "0": "零",
  "1": "幺",
  "2": "二",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "七",
  "8": "八",
  "9": "九",
};

const enDigitNames: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

export function normalizeTtsText(
  text: string,
  language: CallRoomTranslationLanguage,
) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return collapsed;
  const digitNames = language === "zh" ? zhDigitNames : enDigitNames;
  return normalizeAlphaNumericCodes(
    normalizePhoneNumbers(
      normalizeCurrency(collapsed, language),
      digitNames,
    ),
    digitNames,
  );
}

function normalizeCurrency(text: string, language: CallRoomTranslationLanguage) {
  if (language === "zh") {
    return text
      .replace(/[$＄]\s*([0-9]+(?:\.[0-9]+)?)/g, "$1美元")
      .replace(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/g, "$1元")
      .replace(/\bUSD\s*([0-9]+(?:\.[0-9]+)?)/gi, "$1美元")
      .replace(/\bRMB\s*([0-9]+(?:\.[0-9]+)?)/gi, "$1元");
  }
  return text
    .replace(/[$＄]\s*([0-9]+(?:\.[0-9]+)?)/g, "$1 dollars")
    .replace(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/g, "$1 yuan")
    .replace(/\bUSD\s*([0-9]+(?:\.[0-9]+)?)/gi, "$1 dollars")
    .replace(/\bRMB\s*([0-9]+(?:\.[0-9]+)?)/gi, "$1 yuan");
}

function normalizePhoneNumbers(
  text: string,
  digitNames: Record<string, string>,
) {
  return text.replace(/\+?\d[\d\s().-]{5,}\d/g, (match) => {
    if (looksLikeDate(match)) return match;
    const digits = match.replace(/\D/g, "");
    const hasPhoneSeparator = /[+\s().-]/.test(match);
    const isLongBareNumber = digits.length >= 10 && match === digits;
    if (digits.length < 7 || (!hasPhoneSeparator && !isLongBareNumber)) {
      return match;
    }
    return spellDigitsByGroups(match, digitNames);
  });
}

function normalizeAlphaNumericCodes(
  text: string,
  digitNames: Record<string, string>,
) {
  return text.replace(/\b([A-Za-z]{1,6})(?:[-_]|(?=[0-9]))([0-9][A-Za-z0-9-]{1,})\b/g,
    (_match, letters: string, tail: string) => {
      return `${letters} ${spellCodeTail(tail, digitNames)}`;
    });
}

function spellDigitsByGroups(
  value: string,
  digitNames: Record<string, string>,
) {
  const groups = value.match(/\d+/g) ?? [];
  return groups
    .map((group) => group.split("")
      .map((digit) => digitNames[digit])
      .join(digitNames["0"] === "zero" ? " " : ""))
    .join(" ");
}

function spellCodeTail(tail: string, digitNames: Record<string, string>) {
  return tail
    .replace(/-/g, " ")
    .split("")
    .map((char) => digitNames[char] ?? char)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDate(value: string) {
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value.trim());
}
