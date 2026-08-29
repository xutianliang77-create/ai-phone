interface TextRange {
  start: number;
  end: number;
}

export function isProtectedSpeakerCut(
  text: string,
  characterIndex: number,
  terms: string[],
) {
  return protectedSurfaceSpans(text, terms).some((span) =>
    span.start < characterIndex && characterIndex < span.end
  );
}

function protectedSurfaceSpans(text: string, terms: string[]) {
  const spans: TextRange[] = [];
  for (const pattern of protectedPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || !match[0]) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  const lower = text.toLocaleLowerCase();
  for (const term of terms) {
    const value = term.trim();
    if (!value) continue;
    const needle = value.toLocaleLowerCase();
    let from = 0;
    while (from < lower.length) {
      const start = lower.indexOf(needle, from);
      if (start < 0) break;
      spans.push({ start, end: start + value.length });
      from = start + Math.max(1, value.length);
    }
  }
  return spans;
}

const protectedPatterns = [
  /[A-Za-z0-9][A-Za-z0-9_+./-]*/gu,
  /(?:[$¥￥€£]\s*)?\d+(?:[.,]\d+)*(?:\s*(?:%|％|万|亿|元|美元|人民币|kg|g|ms|s|GB|MB))?/giu,
  /[零〇一二三四五六七八九十百千万亿两]+(?:元|美元|人民币|%|％)?/gu,
];
