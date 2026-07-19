import {
  asrCorrectionTermsForPacks,
  asrHotwordsForTerminology,
  domainTermPacks,
  domainTerminologyForPacks,
} from "@translation/speech-quality";

export function requiredAsrEvalEndpoint(value) {
  if (!value?.trim()) throw new Error("ASR_HTTP_ENDPOINT is required");
  const endpoint = new URL(value.trim());
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("ASR_HTTP_ENDPOINT must use http or https");
  }
  return endpoint.toString();
}

export function deriveFlushEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (!url.pathname.endsWith("/asr/transcribe")) {
    throw new Error("ASR_HTTP_FLUSH_ENDPOINT is required for a custom ASR route");
  }
  url.pathname = url.pathname.replace(
    /\/asr\/transcribe$/,
    "/asr/sessions/:sessionId/flush",
  );
  return url.toString();
}

export function parseAsrEvalDomainPacks(value) {
  if (!value?.trim()) return [];
  const packs = value.split(",").map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [];
  for (const pack of packs) {
    if (!(pack in domainTermPacks)) {
      throw new Error(`Unknown ASR eval domain pack: ${pack}`);
    }
    if (!unique.includes(pack)) unique.push(pack);
  }
  return unique;
}

export function parseAsrEvalSourceLanguage(value) {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  if (normalized === "auto") return "auto";
  if (["zh", "zh-CN"].includes(normalized)) return "zh";
  if (["en", "en-US"].includes(normalized)) return "en";
  throw new Error(`Unsupported ASR eval source language: ${normalized}`);
}

export function asrEvalLexicon(packs) {
  if (packs.length === 0) return { hotwords: [], corrections: [] };
  const corrections = asrCorrectionTermsForPacks(packs);
  const terminology = domainTerminologyForPacks(packs);
  return {
    hotwords: asrHotwordsForTerminology(terminology, corrections),
    corrections,
  };
}

export function mergeAsrEvalHotwords(base, sampleTerms, limit = 200) {
  const seen = new Set();
  return [...base, ...sampleTerms].map((item) => String(item).trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
}

export function asrEvalTermsMissing(terms, actualText, expectedText) {
  if (!Array.isArray(terms)) return [];
  const actual = normalizeProtectedText(actualText);
  const expected = expectedText === undefined
    ? null
    : normalizeProtectedText(expectedText);
  return terms.filter((term) => {
    const normalized = normalizeProtectedText(term);
    if (expected !== null && !expected.includes(normalized)) return false;
    return !actual.includes(normalized);
  });
}

export function isAsrEvalAcceptable(sample, finalText, score) {
  return score <= 0.05 &&
    asrEvalTermsMissing(sample.terms, finalText, sample.text).length === 0;
}

export function asrEvalWordErrorRate(expected, actual) {
  const reference = words(expected);
  return editDistance(reference, words(actual)) / Math.max(1, reference.length);
}

export function asrEvalCharErrorRate(expected, actual) {
  const reference = chars(expected);
  return editDistance(reference, chars(actual)) / Math.max(1, reference.length);
}

export function roundAsrEval(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeProtectedText(value) {
  return String(value ?? "").toLowerCase()
    .replace(/\b20,?000\s*yuan\b/g, "twenty thousand yuan")
    .replace(/\ba\s*[- ]?\s*120\b/g, "a120")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function words(value) {
  return String(value).toLowerCase()
    .replace(/a\s*[- ]?\s*120/g, "a120")
    .replace(/20,?000/g, "twenty thousand")
    .replace(/[^a-z0-9' ]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function chars(value) {
  return [...String(value)
    .replace(/八十八号/g, "88号")
    .replace(/八十八/g, "88")
    .replace(/三点/g, "3点")
    .replace(/[\s，。,.？！?!：:、-]/g, "")
    .toLowerCase()];
}

function editDistance(a, b) {
  const dp = Array.from(
    { length: a.length + 1 },
    () => Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}
