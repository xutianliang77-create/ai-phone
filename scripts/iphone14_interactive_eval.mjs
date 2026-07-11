import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeResult } from "./iphone14_interactive_eval_analysis.mjs";
import { compactStamp, relativePath as relativePathFromRoot, sleepSeconds, spawnChecked } from "./iphone14_interactive_eval_io.mjs";
import { startControlServer, watchControlEvents } from "./iphone14_interactive_eval_control.mjs";
import { startUsbWatch as startUsbWatchLoop } from "./iphone14_interactive_eval_usb_watch.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(rootDir, "data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl");
const audioDir = join(rootDir, "test-audio/iphone14-small-models");
const outDir = join(rootDir, "data/model-eval/iphone14-small-models/results/device-pulls/single");
const statePath = join(rootDir, "data/model-eval/iphone14-small-models/results/interactive-state.json");
const eventsPath = join(rootDir, "data/model-eval/iphone14-small-models/results/interactive-events.jsonl");
const tmpDir = join(rootDir, "data/model-eval/iphone14-small-models/results/tmp");
const deviceId = process.env.IPHONE14_DEVICE_ID ?? "F7974451-E824-5DC1-AA00-24F1DD004C7A";
const bundleId = process.env.IPHONE14_TEST_BUNDLE_ID ?? "com.translationlab.iphone14ModelTester";
const ffplay = process.env.FFPLAY ?? "/usr/local/bin/ffplay";
const port = Number(process.env.IPHONE14_EVAL_PORT ?? 3188);
const playbackDelaySeconds = Number(process.env.IPHONE14_PLAYBACK_DELAY_SECONDS ?? 2);
const providerId = process.env.IPHONE14_MODEL_PROVIDER ?? "apple_speech";
const modelId = process.env.IPHONE14_MODEL_ID ?? defaultModelId(providerId);
const asrLanguage = process.env.IPHONE14_ASR_LANGUAGE;

const command = process.argv[2] ?? "status";
const sampleArg = process.argv[3];
const samples = readSamples().filter((sample) => sample.priority === "P0");

switch (command) {
  case "status":
    printStatus();
    break;
  case "set":
    requireSampleArg();
    saveState({ ...loadState(), nextSampleId: sampleArg, activeSampleId: null });
    printStatus();
    break;
  case "start":
    startSample(sampleArg ?? loadState().nextSampleId ?? inferNextSampleId());
    break;
  case "stop":
    stopAndPull();
    break;
  case "next":
    saveState({ ...loadState(), nextSampleId: inferNextSampleId(), activeSampleId: null });
    printStatus();
    break;
  case "server":
    startControlServer(controlContext());
    break;
  case "watch":
    watchControlEvents(controlContext());
    break;
  case "usb-watch":
    startUsbWatch();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}

function printStatus() {
  const state = loadState();
  const sample = sampleById(state.nextSampleId ?? inferNextSampleId());
  console.log(JSON.stringify({
    nextSampleId: sample.id,
    providerId,
    modelId,
    localeId: localeForSample(sample),
    text: sample.text,
    audio: relativePath(audioPathForSample(sample)),
    appAction: "在 App 点“开始识别”会自动同步并播放这一条；点“停止”会自动拉取结果。",
  }, null, 2));
}

function startSample(sampleId) {
  const sample = sampleById(sampleId);
  const audioPath = audioPathForSample(sample);
  if (!existsSync(audioPath)) {
    throw new Error(`Missing audio file: ${audioPath}`);
  }
  saveState({
    ...loadState(),
    activeSampleId: sample.id,
    activeStartedAt: new Date().toISOString(),
    providerId,
    modelId,
    nextSampleId: sample.id,
  });
  printStartInstruction(sample, audioPath);
  waitBeforePlayback();
  spawnChecked(ffplay, ["-nodisp", "-autoexit", "-hide_banner", "-loglevel", "error", audioPath]);
  console.log("播放完成。请点 App 的“停止”，结果会自动拉取。");
}

function startSampleFromApp(payload) {
  const sampleId = loadState().nextSampleId ?? payload.sampleId ?? inferNextSampleId();
  const sample = sampleById(sampleId);
  const audioPath = audioPathForSample(sample);
  if (!existsSync(audioPath)) {
    throw new Error(`Missing audio file: ${audioPath}`);
  }
  saveState({
    ...loadState(),
    activeSampleId: sample.id,
    activeStartedAt: new Date().toISOString(),
    appRunId: payload.runId,
    providerId,
    modelId,
    nextSampleId: sample.id,
  });
  printStartInstruction(sample, audioPath);
  emitControlEvent("start", {
    sampleId: sample.id,
    providerId,
    modelId,
    localeId: localeForSample(sample),
    text: sample.text,
    audio: relativePath(audioPath),
  });
  waitBeforePlayback();
  const child = spawn(ffplay, ["-nodisp", "-autoexit", "-hide_banner", "-loglevel", "error", audioPath], {
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`播放完成：${sample.id}，请点 App 的“停止”。`);
    emitControlEvent("playbackComplete", { sampleId: sample.id, exitCode: code });
  });
}

function stopAndPull() {
  const state = loadState();
  const sample = sampleById(state.activeSampleId ?? state.nextSampleId ?? inferNextSampleId());
  mkdirSync(outDir, { recursive: true });
  const stamp = compactStamp(new Date());
  const outputPath = join(outDir, `${sample.id}-${providerSlug(providerId)}-${stamp}.jsonl`);

  spawnChecked("xcrun", [
    "devicectl", "device", "copy", "from",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", "Documents/latest-results.jsonl",
    "--destination", outputPath,
  ]);

  const summary = scoreResult(outputPath, sample);
  const nextSampleId = nextSampleAfter(sample.id)?.id ?? sample.id;
  saveState({
    ...state,
    activeSampleId: null,
    activeStartedAt: null,
    lastResultPath: outputPath,
    lastSummary: summary,
    nextSampleId,
  });
  console.log(JSON.stringify({
    result: relativePath(outputPath),
    summary,
    next: nextSampleId,
  }, null, 2));
  printStopResult(relativePath(outputPath), summary, nextSampleId);
}

function stopAndPullFromApp() {
  const state = loadState();
  const sample = sampleById(state.activeSampleId ?? state.nextSampleId ?? inferNextSampleId());
  // Give SFSpeechRecognizer a moment to emit the final event and let Flutter persist it.
  sleepSeconds(3);
  mkdirSync(outDir, { recursive: true });
  const stamp = compactStamp(new Date());
  const outputPath = join(outDir, `${sample.id}-${providerSlug(providerId)}-${stamp}.jsonl`);
  spawnChecked("xcrun", [
    "devicectl", "device", "copy", "from",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", "Documents/latest-results.jsonl",
    "--destination", outputPath,
  ]);
  const summary = scoreResult(outputPath, sample);
  const nextSampleId = nextSampleAfter(sample.id)?.id ?? sample.id;
  saveState({
    ...state,
    activeSampleId: null,
    activeStartedAt: null,
    lastResultPath: outputPath,
    lastSummary: summary,
    nextSampleId,
  });
  printStopResult(relativePath(outputPath), summary, nextSampleId);
  emitControlEvent("stop", { result: relativePath(outputPath), summary, next: nextSampleId });
  return { result: relativePath(outputPath), summary, next: nextSampleId };
}

function scoreResult(resultPath, sample) {
  return analyzeResult(resultPath, sample, {
    providerId,
    modelId,
    localeId: localeForSample(sample),
  });
}

function controlContext() {
  return {
    port,
    providerId,
    modelId,
    eventsPath,
    loadState,
    inferNextSampleId,
    sampleById,
    localeForSample,
    audioPathForSample,
    relativePath,
    startSampleFromApp,
    stopAndPullFromApp,
    printStatus,
    printStopResult,
  };
}

function startUsbWatch() {
  startUsbWatchLoop({
    tmpDir,
    deviceId,
    bundleId,
    ffplay,
    rootDir,
    outDir,
    providerId,
    modelId,
    sampleById,
    inferNextSampleId,
    audioPathForSample,
    localeForSample,
    loadState,
    saveState,
    printStartInstruction,
    waitBeforePlayback,
    printStopResult,
    nextSampleAfter,
    providerSlug,
  });
}

function printStartInstruction(sample, audioPath) {
  console.log("");
  console.log(`开始播放下一项：${sample.id}（${providerId} / ${localeForSample(sample)}）`);
  console.log(`原文：${sample.text}`);
  console.log(`音频：${relativePath(audioPath)}`);
}

function waitBeforePlayback() {
  if (!Number.isFinite(playbackDelaySeconds) || playbackDelaySeconds <= 0) return;
  console.log(`等待 ${playbackDelaySeconds} 秒，让 App/ASR 启动稳定...`);
  sleepSeconds(playbackDelaySeconds);
}

function printStopResult(resultPath, summary, nextSampleId) {
  console.log("");
  console.log(`测试结果：${summary.sampleId}（${summary.acceptable ? "通过" : "未通过"}）`);
  console.log(`期望：${summary.expectedText}`);
  console.log(`识别：${summary.finalText || "空"}`);
  console.log(`指标：${summary.cer == null ? `WER ${summary.wer}` : `CER ${summary.cer}`}，speech=${summary.speechEvents}，final=${summary.finalEvents}，error=${summary.errorEvents}`);
  if (summary.note) console.log(`备注：${summary.note}`);
  console.log(`结果文件：${resultPath}`);
  console.log(`下一项：${nextSampleId}。请在 App 点“开始识别”继续。`);
}

function readSamples() {
  return readFileSync(dataPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sampleById(sampleId) {
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) throw new Error(`Unknown sample id: ${sampleId}`);
  return sample;
}

function nextSampleAfter(sampleId) {
  const index = samples.findIndex((sample) => sample.id === sampleId);
  return index >= 0 ? samples[index + 1] : null;
}

function inferNextSampleId() {
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(outDir);
  const completed = new Set();
  for (const sample of samples) {
    if (files.some((file) => file.startsWith(`${sample.id}-`) && file.endsWith(".jsonl"))) {
      completed.add(sample.id);
    }
  }
  return samples.find((sample) => !completed.has(sample.id))?.id ?? samples[0].id;
}

function audioPathForSample(sample) {
  if (sample.audio?.variant === "phone_8k") return join(audioDir, `${sample.id}-phone8k.wav`);
  if (sample.audio?.variant === "mild_noise") return join(audioDir, `${sample.id}-mild-noise-24k.wav`);
  return join(audioDir, `${sample.id}-24k.wav`);
}

function localeForSample(sample) {
  if (asrLanguage) return asrLanguage;
  if (sample.language === "mixed") return "auto";
  return sample.language === "en" ? "en-US" : "zh-CN";
}

function defaultModelId(id) {
  if (id === "apple_speech") return "ios_sfspeechrecognizer";
  if (id === "coreml_nemotron") return "nemotron_coreml_2240ms";
  if (id === "remote_asr") return "remote_asr_provider";
  return id;
}

function providerSlug(id) {
  return String(id).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function loadState() {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function emitControlEvent(type, payload) {
  const event = { type, createdAt: new Date().toISOString(), ...payload };
  mkdirSync(dirname(eventsPath), { recursive: true });
  writeFileSync(eventsPath, `${JSON.stringify(event)}\n`, { flag: "a" });
  console.log(`[event] ${JSON.stringify(event)}`);
}

function relativePath(path) {
  return relativePathFromRoot(rootDir, path);
}

function requireSampleArg() {
  if (!sampleArg) throw new Error("Missing sample id");
}
