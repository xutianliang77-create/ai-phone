#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  asrEvalCharErrorRate,
  asrEvalLatencySummary,
  asrEvalLexicon,
  asrEvalProviderSlug,
  compactAsrEvalStamp,
  asrEvalTermsMissing,
  asrEvalWordErrorRate,
  deriveFlushEndpoint,
  isAsrEvalAcceptable,
  mergeAsrEvalHotwords,
  parseAsrEvalDomainPacks,
  parseAsrEvalMode,
  parseAsrEvalSampleIds,
  parseAsrEvalSourceLanguage,
  prepareAsrEvalWav,
  readPcm16MonoWav,
  renderAsrEvalSummary,
  requiredAsrEvalEndpoint,
  roundAsrEval,
  upsamplePcm16By2,
} from "./lib/http_asr_batch_eval.mjs";

const rootDir = resolve(
  process.env.ASR_EVAL_ROOT_DIR
    ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
);
const samplesPath = join(rootDir, "data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl");
const audioDir = resolve(
  process.env.ASR_EVAL_AUDIO_DIR
    ?? join(rootDir, "test-audio/iphone14-small-models"),
);
const endpoint = requiredAsrEvalEndpoint(process.env.ASR_HTTP_ENDPOINT);
const flushEndpointTemplate = process.env.ASR_HTTP_FLUSH_ENDPOINT
  ? requiredAsrEvalEndpoint(process.env.ASR_HTTP_FLUSH_ENDPOINT)
  : deriveFlushEndpoint(endpoint);
const apiKey = process.env.ASR_SERVICE_API_KEY ?? "";
const providerId = process.env.ASR_EVAL_PROVIDER_ID ?? "http_fireredasr2_aed";
const modelId = process.env.ASR_EVAL_MODEL_ID ?? "FireRedASR2-AED";
const frameMs = Number(process.env.ASR_EVAL_FRAME_MS ?? 320);
const domainPacks = parseAsrEvalDomainPacks(process.env.ASR_EVAL_DOMAIN_PACKS);
const lexicon = asrEvalLexicon(domainPacks);
const includeSampleTerms = process.env.ASR_EVAL_INCLUDE_SAMPLE_TERMS === "true";
const sourceLanguageOverride = parseAsrEvalSourceLanguage(
  process.env.ASR_EVAL_SOURCE_LANGUAGE,
);
const mode = parseAsrEvalMode(process.env.ASR_EVAL_MODE);
const sampleIds = parseAsrEvalSampleIds(process.env.ASR_EVAL_SAMPLE_IDS);
const realtimePacing = process.env.ASR_EVAL_REALTIME_PACING === "true";
const trailingSilenceMs = Number(
  process.env.ASR_EVAL_TRAILING_SILENCE_MS ?? (realtimePacing ? 1600 : 0),
);
const stamp = compactAsrEvalStamp(new Date());
const outputRoot = resolve(
  process.env.ASR_EVAL_OUTPUT_ROOT
    ?? join(rootDir, "data/model-eval/asr-model-sweep"),
);
const runDir = join(outputRoot, asrEvalProviderSlug(providerId), stamp);

const samples = readSamples().filter((sample) =>
  sample.priority === "P0"
  && sample.group !== "tts_probe"
  && (sampleIds.length === 0 || sampleIds.includes(sample.id))
);
mkdirSync(runDir, { recursive: true });

const results = [];
for (const sample of samples) {
  const result = await evaluateSample(sample);
  results.push(result);
  const missing = result.missingTerms.length > 0
    ? ` missing=${result.missingTerms.join("|")}`
    : "";
  console.log(`${result.acceptable ? "PASS" : "FAIL"} ${sample.id} ${result.metric}=${result.score}${missing} ${result.finalText || "空"}`);
}

const summary = summarize(results);
writeFileSync(join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(runDir, "summary.md"), renderAsrEvalSummary(summary));
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
  const sessionId = `${asrEvalProviderSlug(providerId)}-${sample.id}-${Date.now()}`;
  const wav = prepareAsrEvalWav(audioPathForSample(sample), runDir);
  let { pcm, sampleRate } = readPcm16MonoWav(wav.path);
  if (wav.temporary) rmSync(wav.path, { force: true });
  if (sampleRate === 8000) {
    pcm = upsamplePcm16By2(pcm);
    sampleRate = 16000;
  }

  const rows = [];
  const responses = [];
  const hotwords = includeSampleTerms
    ? mergeAsrEvalHotwords(lexicon.hotwords, sample.terms ?? [])
    : lexicon.hotwords;
  const startedAt = Date.now();
  const pacingStartedAt = performance.now();
  let sequence = 1;
  let firstFinalAt = null;
  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame(sampleRate)) {
    if (realtimePacing) {
      await delayUntil(pacingStartedAt + (sequence - 1) * frameMs);
    }
    const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + bytesPerFrame(sampleRate)));
    const response = await postJson(endpoint, {
      sessionId,
      sequence,
      timestampMs: Date.now(),
      mode,
      format: "pcm16",
      sampleRate,
      data: chunk.toString("base64"),
      sourceLanguage: sourceLanguage(sample),
      targetLanguage: targetLanguage(sample),
      hotwords,
      corrections: lexicon.corrections,
    });
    rows.push(eventRow(sample, sessionId, "audio.frame", { sequence, status: response.status }));
    if (response.body) {
      firstFinalAt ??= performance.now();
      responses.push(response.body);
      rows.push(eventRow(sample, sessionId, "speech", { ...response.body, isFinal: true }));
    }
    sequence += 1;
  }

  const speechEndAt = performance.now();
  let finalAfterSpeechEndAt = null;
  const silenceFrames = Math.max(0, Math.ceil(trailingSilenceMs / frameMs));
  for (let index = 0; index < silenceFrames && finalAfterSpeechEndAt === null; index += 1) {
    if (realtimePacing) await delay(frameMs);
    const response = await postJson(endpoint, {
      sessionId,
      sequence,
      timestampMs: Date.now(),
      mode,
      format: "pcm16",
      sampleRate,
      data: Buffer.alloc(bytesPerFrame(sampleRate)).toString("base64"),
      sourceLanguage: sourceLanguage(sample),
      targetLanguage: targetLanguage(sample),
      hotwords,
      corrections: lexicon.corrections,
    });
    rows.push(eventRow(sample, sessionId, "silence.frame", {
      sequence,
      status: response.status,
    }));
    if (response.body) {
      firstFinalAt ??= performance.now();
      finalAfterSpeechEndAt = performance.now();
      responses.push(response.body);
      rows.push(eventRow(sample, sessionId, "speech", {
        ...response.body,
        isFinal: true,
      }));
    }
    sequence += 1;
  }

  if (finalAfterSpeechEndAt === null) {
    const flushed = await postJson(
      flushEndpointTemplate.replace(":sessionId", encodeURIComponent(sessionId)),
      {
        sourceLanguage: sourceLanguage(sample),
        targetLanguage: targetLanguage(sample),
        hotwords,
        corrections: lexicon.corrections,
      },
    );
    rows.push(eventRow(sample, sessionId, "flush", { status: flushed.status }));
    if (flushed.body) {
      firstFinalAt ??= performance.now();
      finalAfterSpeechEndAt = performance.now();
      responses.push(flushed.body);
      rows.push(eventRow(sample, sessionId, "speech", {
        ...flushed.body,
        isFinal: true,
      }));
    }
  }

  const finalText = responses.map((item) => String(item.text ?? "").trim()).filter(Boolean).join(" ");
  const metric = sample.language === "en" ? "wer" : "cer";
  const rawScore = metric === "wer"
    ? asrEvalWordErrorRate(sample.text, finalText)
    : asrEvalCharErrorRate(sample.text, finalText);
  const score = roundAsrEval(rawScore);
  const missingTerms = asrEvalTermsMissing(sample.terms, finalText, sample.text);
  const outputPath = join(runDir, `${sample.id}-${asrEvalProviderSlug(providerId)}.jsonl`);
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
    acceptable: isAsrEvalAcceptable(sample, finalText, rawScore),
    missingTerms,
    hotwordCount: hotwords.length,
    correctionCount: lexicon.corrections.length,
    latencyMs: Date.now() - startedAt,
    endpointFinalLatencyMs: finalAfterSpeechEndAt === null
      ? null
      : Math.max(0, Math.round(finalAfterSpeechEndAt - speechEndAt)),
    firstFinalLatencyMs: firstFinalAt === null
      ? null
      : Math.max(0, Math.round(firstFinalAt - pacingStartedAt)),
    finalSegmentCount: responses.length,
    endpointTriggered: rows.some((row) =>
      row.event.type === "silence.frame" && row.event.status === 200
    ),
    endpointReason: responses[0]?.endpointReason ?? null,
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

function eventRow(sample, sessionId, type, event) {
  return {
    runId: `${asrEvalProviderSlug(providerId)}-${stamp}`,
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
    domainPacks,
    includeSampleTerms,
    sourceLanguageOverride,
    mode,
    realtimePacing,
    frameMs,
    trailingSilenceMs,
    hotwordCount: lexicon.hotwords.length,
    correctionCount: lexicon.corrections.length,
    total: items.length,
    pass: items.filter((item) => item.acceptable).length,
    fail: items.filter((item) => !item.acceptable).length,
    endpointFinalLatencyMs: asrEvalLatencySummary(
      items.map((item) => item.endpointFinalLatencyMs)
        .filter((value) => Number.isFinite(value)),
    ),
    groups,
    results: items,
  };
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

async function delayUntil(target) {
  const remaining = Math.round(target - performance.now());
  if (remaining > 0) await delay(remaining);
}

function sourceLanguage(sample) {
  if (sourceLanguageOverride) return sourceLanguageOverride;
  if (sample.language === "zh" || sample.language === "en") return sample.language;
  return "auto";
}

function targetLanguage(sample) {
  if (sample.targetLanguage === "zh" || sample.targetLanguage === "en") return sample.targetLanguage;
  return "auto";
}

function relativePath(path) {
  return path.replace(`${rootDir}/`, "");
}
