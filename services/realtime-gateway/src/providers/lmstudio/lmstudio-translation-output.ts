export function providerUsage(input: {
  provider: string;
  model: string;
  latencyMs: number;
  inputText: string;
  outputText: string;
}) {
  const inputTokens = estimateTokens(input.inputText);
  const outputTokens = estimateTokens(input.outputText);
  return {
    provider: input.provider,
    model: input.model,
    latencyMs: input.latencyMs,
    inputCharacters: input.inputText.length,
    outputCharacters: input.outputText.length,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedTotalTokens: inputTokens + outputTokens,
  };
}

export function isUsableTranslation(text: string | null): text is string {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return !refusalTranslationPatterns.some((pattern) => pattern.test(normalized));
}

function estimateTokens(text: string) {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonCjk = text.replace(/[\u3400-\u9fff]/g, "").trim();
  const wordLike = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, cjk + Math.ceil(wordLike * 1.35));
}

const refusalTranslationPatterns = [
  /\bneed more context\b.*\btranslation\b/,
  /\bprovide (?:me with )?(?:the )?text\b.*\b(?:translated|translation)\b/,
  /\bcannot provide (?:a )?translation\b/,
  /\bcan't provide (?:a )?translation\b/,
  /\bunable to provide (?:a )?translation\b/,
  /需要更多上下文.*翻译/,
  /请提供.*需要翻译/,
  /无法提供.*翻译/,
];
