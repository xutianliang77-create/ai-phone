import { readFileSync } from "node:fs";
import {
  charErrorRate,
  translationSimilarity,
  wordErrorRate,
} from "./model_eval_metrics.mjs";

const DEFAULT_THRESHOLDS = {
  asrCharErrorRate: 0.18,
  asrWordErrorRate: 0.28,
  asrLatencyMs: 2500,
  asrLanguageConfidence: 0.65,
  translationSimilarity: 0.72,
  translationLatencyMs: 2000,
  ttsFirstAudioMs: 1200,
  ttsPhoneBandScore: 3.5,
};

export function loadModelEvalFixture(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function evaluateModelFixture(fixture, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...fixture.thresholds, ...options.thresholds };
  const requirements = { ...fixture.requirements, ...options.requirements };
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
  const results = cases.map((item) => evaluateCase(item, thresholds, requirements));
  const coverage = evaluateCoverage(fixture.requiredGroups, results);
  const failed = results.filter((item) => item.status !== "pass");
  const issues = [
    ...coverage.issues,
    ...failed.map((item) => `${item.id}: ${item.reason}`),
  ];
  return {
    status: issues.length === 0 && results.length > 0 ? "ready" : "not_ready",
    thresholds,
    requirements,
    coverage,
    summary: summarize(results),
    results,
    issues,
  };
}

function evaluateCase(item, thresholds, requirements) {
  if (item.type === "asr") return evaluateAsrCase(item, thresholds, requirements);
  if (item.type === "translation") return evaluateTranslationCase(item, thresholds);
  if (item.type === "tts") return evaluateTtsCase(item, thresholds);
  return fail(item, `unsupported case type ${item.type}`);
}

function evaluateAsrCase(item, thresholds, requirements) {
  const languageConfidence = numberOrNull(item.languageConfidence);
  const latencyMs = numberOrNull(item.latencyMs);
  const metrics = {
    charErrorRate: charErrorRate(item.expectedText, item.actualText),
    wordErrorRate: wordErrorRate(item.expectedText, item.actualText),
    latencyMs,
    languageOk: !item.expectedLanguage || item.expectedLanguage === item.actualLanguage,
    languageConfidence,
  };
  const reasons = [
    metrics.charErrorRate <= thresholds.asrCharErrorRate ? "" : "asr CER too high",
    metrics.wordErrorRate <= thresholds.asrWordErrorRate ? "" : "asr WER too high",
    metrics.languageOk ? "" : "asr language mismatch",
    latencyMs === null || latencyMs <= thresholds.asrLatencyMs ? "" : "asr latency too high",
    languageConfidence !== null || !requirements.languageConfidence
      ? ""
      : "asr language confidence missing",
    languageConfidence === null || languageConfidence >= thresholds.asrLanguageConfidence
      ? ""
      : "asr language confidence too low",
  ].filter(Boolean);
  return withMetrics(item, metrics, reasons);
}

function evaluateTranslationCase(item, thresholds) {
  const latencyMs = numberOrNull(item.latencyMs);
  const missingProtectedTerms = protectedTermsMissing(item.protectedTerms, item.actualText);
  const metrics = {
    similarity: translationSimilarity(item.expectedText, item.actualText),
    latencyMs,
    missingProtectedTerms,
  };
  const reasons = [
    metrics.similarity >= thresholds.translationSimilarity
      ? ""
      : "translation similarity too low",
    latencyMs === null || latencyMs <= thresholds.translationLatencyMs
      ? ""
      : "translation latency too high",
    missingProtectedTerms.length === 0
      ? ""
      : `translation missing protected terms: ${missingProtectedTerms.join(", ")}`,
  ].filter(Boolean);
  return withMetrics(item, metrics, reasons);
}

function evaluateTtsCase(item, thresholds) {
  const firstAudioMs = numberOrNull(item.firstAudioMs);
  const phoneBandScore = numberOrNull(item.phoneBandScore);
  const metrics = {
    firstAudioMs,
    audioDurationMs: numberOrNull(item.audioDurationMs),
    producedAudio: Boolean(item.producedAudio),
    phoneBandScore,
  };
  const reasons = [
    metrics.producedAudio ? "" : "tts produced no audio",
    firstAudioMs === null || firstAudioMs <= thresholds.ttsFirstAudioMs
      ? ""
      : "tts first audio too slow",
    phoneBandScore === null || phoneBandScore >= thresholds.ttsPhoneBandScore
      ? ""
      : "tts phone-band intelligibility too low",
  ].filter(Boolean);
  return withMetrics(item, metrics, reasons);
}

function withMetrics(item, metrics, reasons) {
  return {
    id: item.id,
    type: item.type,
    group: item.group,
    provider: item.provider,
    model: item.model,
    status: reasons.length === 0 ? "pass" : "fail",
    reason: reasons.join("; "),
    metrics,
  };
}

function fail(item, reason) {
  return {
    id: item.id ?? "unknown",
    type: item.type ?? "unknown",
    group: item.group,
    provider: item.provider,
    model: item.model,
    status: "fail",
    reason,
    metrics: {},
  };
}

function summarize(results) {
  const byProvider = new Map();
  for (const result of results) {
    const key = [result.provider ?? "unknown", result.model ?? "unknown"].join("/");
    const current = byProvider.get(key) ?? { providerModel: key, total: 0, pass: 0, fail: 0 };
    current.total += 1;
    if (result.status === "pass") current.pass += 1;
    else current.fail += 1;
    byProvider.set(key, current);
  }
  return Array.from(byProvider.values());
}

function evaluateCoverage(requiredGroups, results) {
  const required = Array.isArray(requiredGroups) ? requiredGroups : [];
  const present = new Set(results.map((item) => item.group).filter(Boolean));
  const missing = required.filter((group) => !present.has(group));
  return {
    required,
    present: Array.from(present).sort(),
    missing,
    issues: missing.map((group) => `missing required model eval group: ${group}`),
  };
}

function protectedTermsMissing(terms, actualText) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  const normalizedActual = String(actualText ?? "").toLowerCase();
  return terms.filter((term) => !normalizedActual.includes(String(term).toLowerCase()));
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
