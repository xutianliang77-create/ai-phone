import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeResult,
  readResultRows,
} from "./iphone14_interactive_eval_analysis.mjs";
import {
  compactStamp,
  relativePath,
  sleepSeconds,
  spawnChecked,
  spawnQuiet,
} from "./iphone14_interactive_eval_io.mjs";

export function startUsbWatch(context) {
  const {
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
  } = context;

  const relative = (path) => relativePath(rootDir, path);
  const scoreResult = (path, sample) => analyzeResult(path, sample, {
    providerId,
    modelId,
    localeId: localeForSample(sample),
  });

  mkdirSync(tmpDir, { recursive: true });
  let preparedSample = sampleById(loadState().nextSampleId ?? inferNextSampleId());
  writeUsbControlFile({ ...context, sample: preparedSample });
  console.log("USB 监听已启动。");
  console.log(`下一项：${preparedSample.id}（${localeForSample(preparedSample)}）`);
  console.log(`原文：${preparedSample.text}`);
  console.log("请在 App 点“开始识别”。");

  let lastRunId = readLatestRunIdFromDevice(context);
  let activeRunId = null;
  let activeSampleId = null;
  let handledStoppedRunId = null;

  while (true) {
    const pulledPath = pullLatestResultsToTmp(context);
    if (!pulledPath) {
      sleepSeconds(1);
      continue;
    }
    const rows = readResultRows(pulledPath);
    const runId = rows.at(-1)?.runId;
    const events = rows.map((row) => row.event ?? {});
    const nativeStarted = events.some((event) => event.type === "started");
    const buttonStarted = events.some((event) => event.type === "button.start");
    const started = providerId === "coreml_nemotron"
      ? nativeStarted
      : nativeStarted || buttonStarted;
    const stopped = events.some((event) =>
      event.type === "stopped" || event.type === "button.stop"
    );

    if (
      providerId === "coreml_nemotron" &&
      runId &&
      runId !== lastRunId &&
      buttonStarted &&
      !nativeStarted &&
      activeRunId !== runId
    ) {
      console.log("已检测到开始按钮，等待 Nemotron native started 后再播放...");
      activeRunId = runId;
      handledStoppedRunId = null;
    }

    if (runId && runId !== lastRunId && started && activeRunId !== `${runId}:played`) {
      const state = loadState();
      const sample = sampleById(state.nextSampleId ?? preparedSample.id);
      activeRunId = `${runId}:played`;
      activeSampleId = sample.id;
      handledStoppedRunId = null;
      saveState({
        ...state,
        activeSampleId: sample.id,
        activeStartedAt: new Date().toISOString(),
        appRunId: runId,
        providerId,
        modelId,
        nextSampleId: sample.id,
      });
      printStartInstruction(sample, audioPathForSample(sample));
      waitBeforePlayback();
      spawnChecked(ffplay, [
        "-nodisp",
        "-autoexit",
        "-hide_banner",
        "-loglevel",
        "error",
        audioPathForSample(sample),
      ]);
      console.log("播放完成。请点 App 的“停止”。");
    }

    if (activeRunId && activeRunId.startsWith(runId) && stopped &&
        handledStoppedRunId !== runId) {
      handledStoppedRunId = runId;
      const sample = sampleById(activeSampleId ??
        loadState().activeSampleId ??
        preparedSample.id);
      const outputPath = copyPulledResultToOutput({
        pulledPath,
        sample,
        outDir,
        providerId,
        providerSlug,
      });
      const summary = scoreResult(outputPath, sample);
      const nextSampleId = nextSampleAfter(sample.id)?.id ?? sample.id;
      const state = loadState();
      saveState({
        ...state,
        activeSampleId: null,
        activeStartedAt: null,
        lastResultPath: outputPath,
        lastSummary: summary,
        nextSampleId,
      });
      printStopResult(relative(outputPath), summary, nextSampleId);
      lastRunId = runId;
      activeRunId = null;
      activeSampleId = null;
      preparedSample = sampleById(nextSampleId);
      writeUsbControlFile({ ...context, sample: preparedSample });
    }

    sleepSeconds(1);
  }
}

function writeUsbControlFile(context) {
  const {
    tmpDir,
    deviceId,
    bundleId,
    rootDir,
    providerId,
    modelId,
    sample,
    audioPathForSample,
    localeForSample,
  } = context;
  mkdirSync(tmpDir, { recursive: true });
  const localPath = join(tmpDir, "control-next.json");
  writeFileSync(localPath, `${JSON.stringify({
    sampleId: sample.id,
    providerId,
    modelId,
    localeId: localeForSample(sample),
    text: sample.text,
    audio: relativePath(rootDir, audioPathForSample(sample)),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  spawnQuiet("xcrun", [
    "devicectl", "device", "copy", "to",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", localPath,
    "--destination", "Documents/control-next.json",
  ]);
}

function readLatestRunIdFromDevice(context) {
  const pulledPath = pullLatestResultsToTmp(context);
  if (!pulledPath) return null;
  return readResultRows(pulledPath).at(-1)?.runId ?? null;
}

function pullLatestResultsToTmp(context) {
  const { tmpDir, deviceId, bundleId } = context;
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

function copyPulledResultToOutput(input) {
  mkdirSync(input.outDir, { recursive: true });
  const stamp = compactStamp(new Date());
  const outputPath = join(
    input.outDir,
    `${input.sample.id}-${input.providerSlug(input.providerId)}-${stamp}.jsonl`,
  );
  writeFileSync(outputPath, readFileSync(input.pulledPath, "utf8"));
  return outputPath;
}
