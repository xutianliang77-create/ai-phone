import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = join(rootDir, "data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl");
const outDir = join(rootDir, "data/model-eval/iphone14-small-models/results/device-pulls/tts");
const tmpDir = join(rootDir, "data/model-eval/iphone14-small-models/results/tmp-tts");
const statePath = join(rootDir, "data/model-eval/iphone14-small-models/results/tts-state.json");
const deviceId = process.env.IPHONE14_DEVICE_ID ?? "F7974451-E824-5DC1-AA00-24F1DD004C7A";
const bundleId = process.env.IPHONE14_TEST_BUNDLE_ID ?? "com.translationlab.iphone14ModelTester";
const ttsTerminalTimeoutMs = Number(process.env.IPHONE14_TTS_TIMEOUT_MS ?? 20000);

const command = process.argv[2] ?? "status";
const sampleArg = process.argv[3];
const samples = readSamples();
const ttsSamples = samples.filter((sample) => sample.priority === "P0" && sample.group === "tts_probe");

switch (command) {
  case "status":
    printStatus();
    break;
  case "set":
    requireSampleArg();
    sampleById(sampleArg);
    saveState({ nextSampleId: sampleArg });
    printStatus();
    break;
  case "watch":
    watchTts();
    break;
  default:
    throw new Error(`Unknown command: ${command}`);
}

function printStatus() {
  const sample = currentSample();
  console.log(JSON.stringify({
    nextSampleId: sample.id,
    ttsLanguage: ttsLanguageForSample(sample),
    textToSpeak: sample.expectedTranslation,
    appAction: "在 App 点“读期望译文”，不要点“开始识别”。",
  }, null, 2));
}

function watchTts() {
  const sample = currentSample();
  writeUsbControlFile(sample);
  console.log("TTS USB 监听已启动。");
  console.log(`样本：${sample.id}`);
  console.log(`朗读语言：${ttsLanguageForSample(sample)}`);
  console.log(`朗读文本：${sample.expectedTranslation}`);
  console.log("请在 App 点“读期望译文”。");

  const previousRunId = readLatestRowsFromDevice().at(-1)?.runId ?? null;
  let observedRunId = null;
  let observedAtMs = 0;
  while (true) {
    const pulledPath = pullLatestResultsToTmp();
    if (!pulledPath) {
      sleepSeconds(1);
      continue;
    }
    const rows = readRows(pulledPath);
    const runId = rows.at(-1)?.runId;
    if (!runId || runId === previousRunId) {
      sleepSeconds(1);
      continue;
    }
    const summary = summarizeTts(rows, sample);
    const hasTtsEvent = summary.button || summary.requested || summary.started || summary.finished || summary.cancelled;
    if (!hasTtsEvent) {
      sleepSeconds(1);
      continue;
    }
    if (observedRunId !== runId) {
      observedRunId = runId;
      observedAtMs = Date.now();
    }
    const timedOut = Date.now() - observedAtMs > ttsTerminalTimeoutMs;
    if (!summary.finished && !summary.cancelled && !timedOut) {
      sleepSeconds(1);
      continue;
    }
    summary.timedOut = timedOut && !summary.finished && !summary.cancelled;
    const outputPath = copyPulledResultToOutput(pulledPath, sample);
    printTtsSummary(summary, outputPath);
    break;
  }
}

function summarizeTts(rows, sample) {
  const events = rows.map((row) => row.event ?? {});
  const button = events.find((event) => event.type === "button.tts");
  const voice = events.find((event) => event.type === "tts.voice.selected");
  const requested = events.find((event) => event.type === "tts.requested");
  const started = events.find((event) => event.type === "tts.started");
  const finished = [...events].reverse().find((event) => event.type === "tts.finished");
  const cancelled = [...events].reverse().find((event) => event.type === "tts.cancelled");
  const errors = events.filter((event) => event.type === "error");
  const startBase = requested?.timestampMs ?? button?.timestampMs;
  return {
    sampleId: sample.id,
    language: ttsLanguageForSample(sample),
    text: sample.expectedTranslation,
    voiceName: voice?.voiceName ?? "",
    voiceIdentifier: voice?.voiceIdentifier ?? "",
    voiceLanguage: voice?.voiceLanguage ?? "",
    voiceQuality: voice?.voiceQuality ?? null,
    button: Boolean(button),
    requested: Boolean(requested),
    started: Boolean(started),
    finished: Boolean(finished),
    cancelled: Boolean(cancelled),
    timedOut: false,
    errorEvents: errors.length,
    firstAudioLatencyMs: startBase && started?.timestampMs ? started.timestampMs - startBase : null,
    playbackDurationMs: started?.timestampMs && finished?.timestampMs && finished.timestampMs >= started.timestampMs
      ? finished.timestampMs - started.timestampMs
      : null,
    eventOrderNote: started?.timestampMs && finished?.timestampMs && finished.timestampMs < started.timestampMs
      ? "finish timestamp earlier than start; native async event order needs retest"
      : "",
  };
}

function printTtsSummary(summary, outputPath) {
  console.log("");
  console.log(`TTS 结果：${summary.sampleId}`);
  console.log(`语言：${summary.language}`);
  console.log(`文本：${summary.text}`);
  if (summary.voiceName || summary.voiceIdentifier) {
    console.log(`声线：${summary.voiceName || "未知"} / ${summary.voiceIdentifier || "未知"} / ${summary.voiceLanguage || "未知"} / quality=${summary.voiceQuality ?? "未知"}`);
  }
  console.log(`状态：button=${summary.button}，requested=${summary.requested}，started=${summary.started}，finished=${summary.finished}，cancelled=${summary.cancelled}，timeout=${summary.timedOut}，errors=${summary.errorEvents}`);
  console.log(`首音近似延迟：${summary.firstAudioLatencyMs ?? "未知"} ms`);
  console.log(`播放时长：${summary.playbackDurationMs ?? "未知"} ms`);
  if (summary.eventOrderNote) console.log(`备注：${summary.eventOrderNote}`);
  console.log(`结果文件：${relativePath(outputPath)}`);
}

function writeUsbControlFile(sample) {
  mkdirSync(tmpDir, { recursive: true });
  const localPath = join(tmpDir, "control-next.json");
  writeFileSync(localPath, `${JSON.stringify({
    sampleId: sample.id,
    localeId: sample.language === "en" ? "en-US" : "zh-CN",
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  spawnChecked("xcrun", [
    "devicectl", "device", "copy", "to",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", localPath,
    "--destination", "Documents/control-next.json",
  ]);
}

function pullLatestResultsToTmp() {
  mkdirSync(tmpDir, { recursive: true });
  const pulledPath = join(tmpDir, "latest-results.jsonl");
  const result = spawnSync("xcrun", [
    "devicectl", "device", "copy", "from",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", "Documents/latest-results.jsonl",
    "--destination", pulledPath,
  ], { stdio: "pipe" });
  return result.status === 0 && existsSync(pulledPath) ? pulledPath : null;
}

function copyPulledResultToOutput(pulledPath, sample) {
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${sample.id}-apple-tts-${compactStamp(new Date())}.jsonl`);
  writeFileSync(outputPath, readFileSync(pulledPath, "utf8"));
  return outputPath;
}

function readLatestRowsFromDevice() {
  const path = pullLatestResultsToTmp();
  return path ? readRows(path) : [];
}

function readRows(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSamples() {
  return readFileSync(dataPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function currentSample() {
  return sampleById(loadState().nextSampleId ?? ttsSamples[0]?.id);
}

function sampleById(sampleId) {
  const sample = samples.find((item) => item.id === sampleId);
  if (!sample) throw new Error(`Unknown sample id: ${sampleId}`);
  return sample;
}

function ttsLanguageForSample(sample) {
  return sample.targetLanguage === "zh" ? "zh-CN" : "en-US";
}

function loadState() {
  if (!existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function compactStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function relativePath(path) {
  return path.replace(`${rootDir}/`, "");
}

function sleepSeconds(seconds) {
  spawnSync("sleep", [String(seconds)]);
}

function spawnChecked(commandName, args) {
  const result = spawnSync(commandName, args, { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`${commandName} failed with status ${result.status}`);
  }
}

function requireSampleArg() {
  if (!sampleArg) throw new Error("Missing sample id");
}
