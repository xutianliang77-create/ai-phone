import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

export function parseAsrEvalMode(value) {
  const normalized = value?.trim() || "conversation";
  if (["conversation", "listening", "call_link", "pstn"].includes(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported ASR eval mode: ${normalized}`);
}

export function parseAsrEvalSampleIds(value) {
  if (!value?.trim()) return [];
  return [...new Set(
    value.split(",").map((item) => item.trim()).filter(Boolean),
  )];
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

export function prepareAsrEvalWav(path, runDir) {
  const header = readPcm16MonoWav(path, { headerOnly: true });
  if ([8000, 16000, 24000].includes(header.sampleRate)) {
    return { path, temporary: false };
  }
  const outPath = join(
    runDir,
    `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );
  const result = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", path, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", outPath,
  ], { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = result.error?.message
      ?? result.stderr?.toString()
      ?? "unknown error";
    throw new Error(`ffmpeg failed for ${path}: ${detail}`);
  }
  return { path: outPath, temporary: true };
}

export function readPcm16MonoWav(path, options = {}) {
  const buffer = readFileSync(path);
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`Not a wav file: ${path}`);
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (
    !fmt
    || fmt.audioFormat !== 1
    || fmt.channels !== 1
    || fmt.bitsPerSample !== 16
  ) {
    throw new Error(`Unsupported wav format: ${path}`);
  }
  if (options.headerOnly) return { sampleRate: fmt.sampleRate };
  if (!data) throw new Error(`Missing wav data chunk: ${path}`);
  return { sampleRate: fmt.sampleRate, pcm: data };
}

export function upsamplePcm16By2(pcm) {
  const samples = pcm.length / 2;
  const output = Buffer.alloc(samples * 4);
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2);
    output.writeInt16LE(value, index * 4);
    output.writeInt16LE(value, index * 4 + 2);
  }
  return output;
}

export function asrEvalLatencySummary(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return {
    min: ordered[0],
    p50: ordered[Math.floor((ordered.length - 1) * 0.5)],
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
    max: ordered.at(-1),
  };
}

export function renderAsrEvalSummary(summary) {
  const lines = [
    `# ${summary.modelId} ASR Eval`,
    "",
    `- Provider: \`${summary.providerId}\``,
    `- Domain packs: ${renderPacks(summary.domainPacks)}`,
    `- Sample terms as hotwords: ${summary.includeSampleTerms}`,
    `- Source language override: ${summary.sourceLanguageOverride ?? "per-sample"}`,
    `- Mode: \`${summary.mode}\``,
    `- Realtime pacing: ${summary.realtimePacing}`,
    `- Endpoint final latency: ${JSON.stringify(summary.endpointFinalLatencyMs)}`,
    `- Total: ${summary.total}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    "",
    "| Group | Pass/Total |",
    "| --- | ---: |",
  ];
  for (const [group, item] of Object.entries(summary.groups)) {
    lines.push(`| \`${group}\` | ${item.pass}/${item.total} |`);
  }
  lines.push(
    "",
    "| Sample | Result | Metric | Text |",
    "| --- | --- | --- | --- |",
  );
  for (const item of summary.results) {
    const missing = item.missingTerms.length > 0
      ? `; missing ${item.missingTerms.join(", ")}`
      : "";
    lines.push(
      `| \`${item.sampleId}\` | ${item.acceptable ? "pass" : "fail"} | `
      + `${item.metric} ${item.score}${missing} | `
      + `${escapeAsrEvalCell(item.finalText || "空")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function asrEvalProviderSlug(id) {
  return String(id).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function compactAsrEvalStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function renderPacks(packs) {
  return packs.length > 0
    ? packs.map((item) => `\`${item}\``).join(", ")
    : "none";
}

function escapeAsrEvalCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
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
