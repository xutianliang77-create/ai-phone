import type { TranslationLanguageCode } from "@translation/contracts";
import type { TranscriptResult } from "../../asr/asr-provider.js";

interface TranscriptChunk {
  text: string;
  language: TranslationLanguageCode;
}

export function transcriptVariantsForTranslation(
  transcript: TranscriptResult,
  autoReverse: boolean,
  allowTextLanguageOverride: boolean,
): TranscriptResult[] {
  const language = allowTextLanguageOverride
    ? dominantLanguage(transcript.text) ?? transcript.language
    : transcript.language;
  if (!autoReverse) return [{ ...transcript, language }];

  const chunks = mergeEmbeddedModelNameChunks(splitByScript(transcript.text, language));
  if (!shouldSplit(chunks)) return [{ ...transcript, language }];

  return chunks.map((chunk, index) => ({
    ...transcript,
    segmentId: `${transcript.segmentId}_${index + 1}`,
    text: chunk.text,
    language: chunk.language,
  }));
}

function splitByScript(
  text: string,
  fallbackLanguage: TranslationLanguageCode,
): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let buffer = "";
  let currentLanguage: TranslationLanguageCode | undefined;

  for (const char of text) {
    const language = scriptLanguage(char);
    if (
      language &&
      currentLanguage &&
      language !== currentLanguage &&
      buffer.trim()
    ) {
      chunks.push({ text: buffer.trim(), language: currentLanguage });
      buffer = "";
      currentLanguage = language;
    }
    currentLanguage ??= language;
    buffer += char;
  }

  const tail = buffer.trim();
  if (tail) {
    chunks.push({ text: tail, language: currentLanguage ?? fallbackLanguage });
  }
  return chunks;
}

function shouldSplit(chunks: TranscriptChunk[]) {
  const hasChinese = chunks.some(
    (chunk) => chunk.language === "zh" && chineseCharacterCount(chunk.text) >= 2,
  );
  const hasEnglishPhrase = chunks.some(
    (chunk) =>
      chunk.language === "en" &&
      englishWordCount(chunk.text) >= 2 &&
      !looksLikeCodeOrModelName(chunk.text),
  );
  return hasChinese && hasEnglishPhrase;
}

function mergeEmbeddedModelNameChunks(chunks: TranscriptChunk[]) {
  const merged: TranscriptChunk[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const previous = merged.at(-1);
    const next = chunks[index + 1];
    if (
      chunk.language === "en" &&
      looksLikeCodeOrModelName(chunk.text) &&
      (previous?.language === "zh" || next?.language === "zh")
    ) {
      if (previous?.language === "zh") {
        previous.text = normalizeEmbeddedSpacing(`${previous.text} ${chunk.text}`);
        continue;
      }
      merged.push({ ...chunk, language: "zh" });
      continue;
    }
    if (
      chunk.language === "zh" &&
      previous?.language === "zh" &&
      isConnectorChunk(chunk.text)
    ) {
      previous.text = mergeChineseConnector(previous.text, chunk.text);
      continue;
    }
    merged.push({ ...chunk });
  }
  return merged;
}

function dominantLanguage(text: string): TranslationLanguageCode | null {
  const zhCount = chineseCharacterCount(text);
  const enCount = englishLetterCount(text);
  if (zhCount === 0 && enCount === 0) return null;
  if (zhCount > 0 && enCount === 0) return "zh";
  if (enCount > 0 && zhCount === 0) return "en";
  if (zhCount > 0 && latinRuns(text).every(looksLikeCodeOrModelName)) {
    return "zh";
  }
  if (enCount >= zhCount * 2) return "en";
  if (zhCount * 2 >= enCount) return "zh";
  return null;
}

function scriptLanguage(char: string): TranslationLanguageCode | undefined {
  if (/[\u4e00-\u9fff]/u.test(char)) return "zh";
  if (/[A-Za-z]/u.test(char)) return "en";
  return undefined;
}

function chineseCharacterCount(text: string) {
  return text.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;
}

function englishLetterCount(text: string) {
  return text.match(/[A-Za-z]/gu)?.length ?? 0;
}

function englishWordCount(text: string) {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/gu)?.length ?? 0;
}

function latinRuns(text: string) {
  return text.match(/[A-Za-z][A-Za-z0-9_/-]*/gu) ?? [];
}

function looksLikeCodeOrModelName(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (/[0-9_/-]/u.test(compact)) return true;
  return /[a-z][A-Z]/u.test(compact);
}

function isConnectorChunk(text: string) {
  return /^[\s、，,。.\-和的在线模型链路]+$/u.test(text);
}

function mergeChineseConnector(previous: string, connector: string) {
  if (connector === "和" && /[A-Za-z0-9]$/u.test(previous)) {
    return normalizeEmbeddedSpacing(`${previous} ${connector} `);
  }
  if (connector.startsWith("的") && /[A-Za-z0-9]$/u.test(previous)) {
    return normalizeEmbeddedSpacing(`${previous} ${connector}`);
  }
  return normalizeEmbeddedSpacing(`${previous}${connector}`);
}

function normalizeEmbeddedSpacing(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
