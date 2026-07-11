export function shouldPreserveSpelledIdentifier(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  if (!sourceLanguage.toLowerCase().startsWith("en")) return false;
  if (!targetLanguage.toLowerCase().startsWith("zh")) return false;
  const normalized = text.trim();
  if (normalized.length < 2 || normalized.length > 24) return false;
  if (/[\u3400-\u9fff]/u.test(normalized)) return false;
  if (/[.!?]/u.test(normalized)) return false;

  const tokens = normalized.split(/[\s,，、-]+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  const singleLetters = tokens.filter((token) => /^[A-Za-z]$/u.test(token)).length;
  const alphaNumeric = tokens.every((token) => /^[A-Za-z0-9]{1,6}$/u.test(token));
  return alphaNumeric && singleLetters >= Math.min(2, tokens.length);
}
