import { applyAsrLocalRules } from "./local-rules.js";

export interface RecentAsrSegment {
  rawText?: string;
  optimizedText?: string;
  translatedText?: string;
}

export interface AsrRefinementPolicyInput {
  rawText: string;
  sourceLanguage: string;
  confidence?: number;
  previousSegments: RecentAsrSegment[];
  protectedTerms: string[];
}

export function shouldUseContextualAsrRefinement(input: AsrRefinementPolicyInput) {
  const text = input.rawText.trim();
  if (text.length < 2) return false;

  if (hasExplicitAsrCorrectionSignal(text, input.protectedTerms)) return true;
  if (hasLowConfidence(input.confidence)) return true;
  if (looksLikeFragmentAfterRecentContext(text, input.previousSegments)) return true;

  return false;
}

export function hasExplicitAsrCorrectionSignal(
  text: string,
  protectedTerms: string[],
) {
  const local = applyAsrLocalRules(text, protectedTerms);
  return local.operations.includes("term_correction") ||
    local.operations.includes("identifier_correction") ||
    hasKnownAsrConfusion(text) ||
    hasSuspiciousRepetition(text) ||
    hasSuspiciousNumericRange(text);
}

function hasLowConfidence(confidence: number | undefined) {
  return confidence !== undefined && confidence < 0.68;
}

function hasKnownAsrConfusion(text: string) {
  return knownConfusions.some((pattern) => pattern.test(text));
}

function hasSuspiciousRepetition(text: string) {
  return (
    /([\u4e00-\u9fff]{2,5})\1{1,}/.test(text) ||
    /\b([A-Za-z]{2,})\s+\1\b/i.test(text) ||
    /([我你他她它])\1{2,}(?=[\u4e00-\u9fff])/.test(text)
  );
}

function hasSuspiciousNumericRange(text: string) {
  return /[零〇一二两三四五六七八九十百千万亿\d]+(?:到|至)[零〇一二两三四五六七八九十百千万亿\d]+位(?:之间)?/.test(
    text,
  );
}

function looksLikeFragmentAfterRecentContext(
  text: string,
  previousSegments: RecentAsrSegment[],
) {
  const previous = previousSegments.at(-1)?.optimizedText ??
    previousSegments.at(-1)?.rawText ??
    "";
  if (!previous) return false;
  const previousTail = previous.replace(/[，,。.!！？?；;：:\s]+$/g, "").slice(-8);
  if (previousTail.length < 3) return false;
  return text.startsWith(previousTail) || previous.endsWith(text.slice(0, 6));
}

const knownConfusions = [
  /端局/g,
  /端测/g,
  /同船/g,
  /同生传义/g,
  /会议既要/g,
  /语义[足主]句/g,
  /语意组句/g,
  /自动识别语音/g,
  /\bTwin\s*3\s*ASR\b/gi,
  /\bQuin+n?\s*3\s*ASR\b/gi,
  /\bHi\s*M\s*T\s*2\b/gi,
  /\bBox\s*C\s*P\s*M\s*2\b/gi,
  /\bVoice\s*CPM2\b/gi,
];
