export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeCompactText(value) {
  return normalizeText(value).replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function levenshteinDistance(left, right) {
  const a = Array.from(String(left ?? ""));
  const b = Array.from(String(right ?? ""));
  return sequenceDistance(a, b);
}

export function sequenceDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

export function charErrorRate(expected, actual) {
  const reference = normalizeCompactText(expected);
  const hypothesis = normalizeCompactText(actual);
  if (!reference) return hypothesis ? 1 : 0;
  return roundMetric(levenshteinDistance(reference, hypothesis) / reference.length);
}

export function wordErrorRate(expected, actual) {
  const reference = wordTokens(expected);
  const hypothesis = wordTokens(actual);
  if (reference.length === 0) return hypothesis.length ? 1 : 0;
  return roundMetric(sequenceDistance(reference, hypothesis) / reference.length);
}

export function translationSimilarity(expected, actual) {
  return roundMetric(1 - charErrorRate(expected, actual));
}

function wordTokens(value) {
  return normalizeText(value)
    .split(/[\s,.;:!?，。！？；：、]+/u)
    .filter(Boolean)
    .flatMap((token) => containsCjk(token) ? Array.from(normalizeCompactText(token)) : [token]);
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

function roundMetric(value) {
  return Math.round(value * 10000) / 10000;
}
