#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const samplesPath = join(rootDir, "data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl");
const audioDir = join(rootDir, "test-audio/iphone14-small-models");
const endpoint = process.env.ASR_HTTP_ENDPOINT ?? "http://100.110.127.117:8001/asr/transcribe";
const flushEndpointTemplate = process.env.ASR_HTTP_FLUSH_ENDPOINT ?? "http://100.110.127.117:8001/asr/sessions/:sessionId/flush";
const apiKey = process.env.ASR_SERVICE_API_KEY ?? "";
const providerId = process.env.ASR_EVAL_PROVIDER_ID ?? "http_fireredasr2_aed";
const modelId = process.env.ASR_EVAL_MODEL_ID ?? "FireRedASR2-AED";
const frameMs = Number(process.env.ASR_EVAL_FRAME_MS ?? 320);
const stamp = compactStamp(new Date());
const runDir = join(rootDir, "data/model-eval/asr-model-sweep", providerSlug(providerId), stamp);

const samples = readSamples().filter((sample) => sample.priority === "P0" && sample.group !== "tts_probe");
mkdirSync(runDir, { recursive: true });

const results = [];
for (const sample of samples) {
  const result = await evaluateSample(sample);
  results.push(result);
  console.log(`${result.acceptable ? "PASS" : "FAIL"} ${sample.id} ${result.metric}=${result.score} ${result.finalText || "空"}`);
}

const summary = summarize(results);
writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(runDir, "summary.md"), renderSummary(summary));
console.log(JSON.stringify({
  providerId,
  modelId,
  runDir: relativePath(runDir),
  total: summary.total,
  pass: summary.pass,
  fail: summary.fail,
}, null, 2));
if (summary.total === 0 || summary.pass === 0) process.exitCode = 1;

async function evaluateSample(sample) {
  const sessionId = `${providerSlug(providerId)}-${sample.id}-${Date.now()}`;
  const wav = prepareWav(audioPathForSample(sample));
  const { pcm, sampleRate } = readPcm16MonoWav(wav.path);
  if (wav.temporary) rmSync(wav.path, { force: true });

  const rows = [];
  const responses = [];
  const startedAt = Date.now();
  let sequence = 1;
  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame(sampleRate)) {
    const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + bytesPerFrame(sampleRate)));
    const response = await postJson(endpoint, {
      sessionId,
      sequence,
      timestampMs: Date.now(),
      format: "pcm16",
      sampleRate,
      data: chunk.toString("base64"),
      sourceLanguage: sourceLanguage(sample),
      targetLanguage: targetLanguage(sample),
    });
    rows.push(eventRow(sample, sessionId, "audio.frame", { sequence, status: response.status }));
    if (response.body) {
      responses.push(response.body);
      rows.push(eventRow(sample, sessionId, "speech", { ...response.body, isFinal: true }));
    }
    sequence += 1;
  }

  const flushed = await postJson(flushEndpointTemplate.replace(":sessionId", encodeURIComponent(sessionId)), {
    sourceLanguage: sourceLanguage(sample),
    targetLanguage: targetLanguage(sample),
  });
  rows.push(eventRow(sample, sessionId, "flush", { status: flushed.status }));
  if (flushed.body) {
    responses.push(flushed.body);
    rows.push(eventRow(sample, sessionId, "speech", { ...flushed.body, isFinal: true }));
  }

  const finalText = responses.map((item) => String(item.text ?? "").trim()).filter(Boolean).join(" ");
  const metric = sample.language === "en" ? "wer" : "cer";
  const rawScore = metric === "wer"
    ? wordErrorRate(sample.text, finalText)
    : charErrorRate(sample.text, finalText);
  const score = round(rawScore);
  const outputPath = join(runDir, `${sample.id}-${providerSlug(providerId)}.jsonl`);
  writeFileSync(outputPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

  return {
    sampleId: sample.id,
    group: sample.group,
    language: sample.language,
    providerId,
    modelId,
    expectedText: sample.text,
    finalText,
    metric,
    score,
    acceptable: isAcceptable(sample, finalText, rawScore),
    latencyMs: Date.now() - startedAt,
    events: rows.length,
    resultFile: relativePath(outputPath),
  };
}

async function postJson(url, payload) {
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (response.status === 204) return { status: response.status, body: null };
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed ${response.status}: ${text}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function prepareWav(path) {
  const header = readPcm16MonoWav(path, { headerOnly: true });
  if (header.sampleRate === 16000 || header.sampleRate === 24000) {
    return { path, temporary: false };
  }
  const outPath = join(runDir, `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
  const result = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", path, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", outPath,
  ], { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${path}: ${result.stderr.toString()}`);
  }
  return { path: outPath, temporary: true };
}

function readPcm16MonoWav(path, options = {}) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
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
  if (!fmt || fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`Unsupported wav format: ${path}`);
  }
  if (options.headerOnly) return { sampleRate: fmt.sampleRate };
  if (!data) throw new Error(`Missing wav data chunk: ${path}`);
  return { sampleRate: fmt.sampleRate, pcm: data };
}

function eventRow(sample, sessionId, type, event) {
  return {
    runId: `${providerSlug(providerId)}-${stamp}`,
    createdAt: new Date().toISOString(),
    sampleId: sample.id,
    sampleGroup: sample.group,
    sampleLanguage: sample.language,
    targetLanguage: sample.targetLanguage,
    providerId,
    modelId,
    sessionId,
    expectedText: sample.text,
    event: { type, ...event },
  };
}

function summarize(items) {
  const groups = {};
  for (const item of items) {
    groups[item.group] ??= { total: 0, pass: 0, fail: 0 };
    groups[item.group].total += 1;
    if (item.acceptable) groups[item.group].pass += 1;
    else groups[item.group].fail += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    providerId,
    modelId,
    endpoint,
    total: items.length,
    pass: items.filter((item) => item.acceptable).length,
    fail: items.filter((item) => !item.acceptable).length,
    groups,
    results: items,
  };
}

function renderSummary(summary) {
  const lines = [
    `# ${summary.modelId} ASR Eval`,
    "",
    `- Provider: \`${summary.providerId}\``,
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
  lines.push("", "| Sample | Result | Metric | Text |", "| --- | --- | --- | --- |");
  for (const item of summary.results) {
    lines.push(`| \`${item.sampleId}\` | ${item.acceptable ? "pass" : "fail"} | ${item.metric} ${item.score} | ${escapeCell(item.finalText || "空")} |`);
  }
  return `${lines.join("\n")}\n`;
}

function readSamples() {
  return readFileSync(samplesPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function audioPathForSample(sample) {
  if (sample.audio?.variant === "phone_8k") return join(audioDir, `${sample.id}-phone8k.wav`);
  if (sample.audio?.variant === "mild_noise") return join(audioDir, `${sample.id}-mild-noise-24k.wav`);
  return join(audioDir, `${sample.id}-24k.wav`);
}

function bytesPerFrame(sampleRate) {
  return Math.max(2, Math.floor(sampleRate * frameMs / 1000) * 2);
}

function sourceLanguage(sample) {
  if (sample.language === "zh" || sample.language === "en") return sample.language;
  return "auto";
}

function targetLanguage(sample) {
  if (sample.targetLanguage === "zh" || sample.targetLanguage === "en") return sample.targetLanguage;
  return "auto";
}

function isAcceptable(sample, finalText, score) {
  if (sample.id === "en_short_004") {
    return /a\s*[- ]?\s*120/i.test(finalText) && /20,?000|twenty thousand/i.test(finalText);
  }
  return score <= 0.05;
}

function wordErrorRate(expected, actual) {
  return editDistance(words(expected), words(actual)) / Math.max(1, words(expected).length);
}

function charErrorRate(expected, actual) {
  return editDistance(chars(expected), chars(actual)) / Math.max(1, chars(expected).length);
}

function words(value) {
  return String(value)
    .toLowerCase()
    .replace(/a\s*[- ]?\s*120/g, "a120")
    .replace(/20,?000/g, "twenty thousand")
    .replace(/[^a-z0-9' ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
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

function providerSlug(id) {
  return String(id).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function compactStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function relativePath(path) {
  return path.replace(`${rootDir}/`, "");
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
