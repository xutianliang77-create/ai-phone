const chineseContinuationSuffixes = [
  "因为", "但是", "不过", "然后", "如果", "所以", "而且", "并且",
  "同时", "之后", "之前", "以后", "的时候", "的话", "就是", "比如",
  "例如", "关于", "对于", "为了", "按照", "通过", "需要", "可以让",
  "会把", "我觉得", "我认为", "我们要", "我们需要", "接下来",
  "下一步", "主要是", "重点是", "包括", "以及", "还有", "或者",
  "不仅", "不但", "虽然", "即使", "只要", "仅仅", "各大", "也都",
  "都", "只", "跟", "和", "把", "给", "从", "在", "到", "对",
  "被", "让", "使", "用", "以", "上", "中", "里", "内", "下",
];

const englishContinuationSuffixes = [
  "because", "but", "and", "or", "so", "then", "if", "when", "while",
  "although", "though", "that", "which", "who", "to", "of", "for",
  "with", "about", "after", "before", "during", "from", "into", "in",
  "on", "at", "under", "over", "between", "through", "by", "as", "is",
  "are", "was", "were", "will", "would", "can", "could", "should",
  "the", "a", "an", "this is", "there is", "there are", "need to",
  "going to", "in order to",
];

export function shouldHoldForNextSegment(text: string, language: string) {
  const trimmed = text.trim();
  if (!trimmed || /[！？!?]$/u.test(trimmed)) return false;
  if (/[,，、;；:：]$/u.test(trimmed)) return true;

  const normalized = trimmed.replace(/[.。]+$/u, "");
  if (/[.。]$/u.test(trimmed)) {
    return language === "zh"
      ? hasChineseContinuationSuffix(normalized)
      : hasEnglishContinuationSuffix(normalized);
  }
  return language === "zh"
    ? hasChineseContinuationSuffix(trimmed)
    : hasEnglishContinuationSuffix(trimmed);
}

function hasChineseContinuationSuffix(text: string) {
  const normalized = text.replace(/[\s,，、;；:：.。!！?？]+$/gu, "");
  return chineseContinuationSuffixes.some((suffix) => normalized.endsWith(suffix));
}

function hasEnglishContinuationSuffix(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z'\s-]+$/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const endings = [words.at(-1), words.slice(-2).join(" "), words.slice(-3).join(" ")];
  return englishContinuationSuffixes.some((suffix) => endings.includes(suffix));
}
