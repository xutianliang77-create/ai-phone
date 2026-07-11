#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const skipSlow = takeFlag("--skip-slow");
const help = takeFlag("--help") || takeFlag("-h");
const outputPath = path.resolve(
  valueFlag("--output") ?? ".cache/model-eval/comprehensive-model-readiness.json",
);
const timeoutMs = Number(valueFlag("--timeout-ms") ?? 60000);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const checks = [];
const issues = [];
const actions = [];

runJsonCheck({
  name: "default_model_eval_fixture",
  command: [
    process.execPath,
    "scripts/run_model_eval.mjs",
    "--fixture",
    "model-eval/fixtures/cn-en-smoke.json",
    "--json",
    "--no-save",
  ],
  ok: (body) => body.status === "ready",
  details: (body) => ({
    status: body.status,
    fixture: body.fixture,
    summary: body.summary,
    issues: body.issues,
  }),
  issue: "Default ASR/translation/TTS smoke fixture is not ready.",
});

runJsonCheck({
  name: "comprehensive_real_model_fixture",
  command: [
    process.execPath,
    "scripts/run_model_eval.mjs",
    "--fixture",
    "model-eval/fixtures/cn-en-comprehensive-real.json",
    "--json",
    "--no-save",
  ],
  ok: (body) => body.status === "ready",
  details: (body) => ({
    status: body.status,
    fixture: body.fixture,
    summary: body.summary,
    issues: body.issues,
  }),
  issue: "Comprehensive real model fixture has candidate failures.",
  action: "Inspect model-eval/fixtures/cn-en-comprehensive-real.json and fix failing gray candidates before promoting them to defaults.",
});

runJsonCheck({
  name: "ios_coreml_nemotron_asr_bridge",
  command: [process.execPath, "scripts/check_ios_native_asr_bridge.mjs", "--json"],
  ok: (body) => body.status === "ready",
  details: (body) => ({ status: body.status, failures: body.failures }),
  issue: "iOS CoreML/Nemotron ASR bridge contract is not ready.",
});

runJsonCheck({
  name: "ios_on_device_translation_bridge",
  command: [process.execPath, "scripts/check_ios_on_device_translation.mjs", "--json"],
  ok: (body) => body.status === "ready",
  details: (body) => ({ status: body.status, failures: body.failures }),
  issue: "iOS on-device translation bridge contract is not ready.",
});

runJsonCheck({
  name: "ios_system_tts_bridge",
  command: [process.execPath, "scripts/check_ios_speech_output.mjs", "--json"],
  ok: (body) => body.status === "ready",
  details: (body) => ({ status: body.status, failures: body.failures }),
  issue: "iOS system TTS bridge contract is not ready.",
});

runCommandCheck({
  name: "ios_runtime_permissions",
  command: [process.execPath, "scripts/check_ios_runtime_permissions.mjs"],
  issue: "iOS runtime permission metadata is not ready.",
});

runCommandCheck({
  name: "ios_coreml_runtime_static",
  command: [process.execPath, "scripts/check_ios_coreml_runtime.mjs"],
  issue: "iOS CoreML/Nemotron runtime static checks failed.",
});

runJsonCheck({
  name: "ios_models_resource",
  command: [process.execPath, "scripts/check_ios_models_resource.mjs"],
  ok: (body) =>
    body.project?.hasFileReference === true &&
    body.project?.hasResourceBuildFile === true &&
    body.project?.hasResourcesEntry === true,
  details: (body) => ({
    project: body.project,
    builtApp: body.builtApp,
    model: body.model,
  }),
  issue: "iOS model resources are not wired into the Runner target.",
});

runJsonCheck({
  name: "translation_worker_pstn_audio_sink",
  command: [
    process.execPath,
    "scripts/check_translation_worker_pstn_audio_sink_readiness.mjs",
    "--json",
    "--no-save",
  ],
  ok: (body) => body.status === "ready",
  details: (body) => ({
    status: body.status,
    asrFrameCount: body.asrFrameCount,
    eventBatchCount: body.eventBatchCount,
    playbackCount: body.playbackCount,
    issues: body.issues,
  }),
  issue: "Translation Worker PSTN audio sink loop is not ready.",
});

if (!skipSlow) {
  runJsonCheck({
    name: "pstn_internal_media_loop",
    command: [
      process.execPath,
      "scripts/check_pstn_internal_media_loop_readiness.mjs",
      "--json",
      "--no-save",
      "--timeout-ms",
      String(timeoutMs),
    ],
    ok: (body) => body.status === "ready",
    details: (body) => ({
      status: body.status,
      asrFrameCount: body.asrFrameCount,
      eventBatchCount: body.eventBatchCount,
      upstreamAudioCount: body.upstreamAudioCount,
      mediaWriteCount: body.mediaWriteCount,
      issues: body.issues,
    }),
    issue: "PSTN internal media loop is not ready.",
  });
}

checkBeelinkSummary();

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: issues.length === 0 ? "ready" : "not_ready",
  modeCoverage: {
    localOnDevice: [
      "ios_coreml_nemotron_asr_bridge",
      "ios_on_device_translation_bridge",
      "ios_system_tts_bridge",
      "ios_runtime_permissions",
      "ios_coreml_runtime_static",
      "ios_models_resource",
    ],
    crossPlatformCall: [
      "default_model_eval_fixture",
      "comprehensive_real_model_fixture",
      "translation_worker_pstn_audio_sink",
      ...(skipSlow ? [] : ["pstn_internal_media_loop"]),
      "beelink_model_artifacts",
      "beelink_real_model_outputs",
    ],
  },
  checks,
  issues,
  actions: [...new Set(actions)],
};

if (!noSave) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Comprehensive model readiness ${result.status}`);
  for (const check of checks) console.log(`- ${check.status}: ${check.name}`);
  for (const issue of issues) console.error(`issue: ${issue}`);
  for (const action of result.actions) console.log(`action: ${action}`);
}

if (result.status !== "ready") process.exitCode = 1;

function runJsonCheck(config) {
  const execution = run(config.command);
  const body = parseJsonOutput(execution.stdout);
  if (!body) {
    record(config.name, false, {
      exitCode: execution.status,
      stdout: execution.stdout.slice(0, 1000),
      stderr: execution.stderr.slice(0, 1000),
    });
    issues.push(execution.ok ? `${config.name} did not return JSON output.` : config.issue);
    if (config.action) actions.push(config.action);
    return;
  }
  const ok = execution.ok && config.ok(body);
  record(config.name, ok, {
    exitCode: execution.status,
    ...(config.details ? config.details(body) : body),
  });
  if (!ok) {
    issues.push(config.issue);
    if (config.action) actions.push(config.action);
  }
}

function runCommandCheck(config) {
  const execution = run(config.command);
  record(config.name, execution.ok, {
    exitCode: execution.status,
    stdout: execution.stdout.trim().slice(0, 1000),
    stderr: execution.stderr.trim().slice(0, 1000),
  });
  if (!execution.ok) issues.push(config.issue);
}

function checkBeelinkSummary() {
  const filePath = ".cache/model-eval/beelink-model-eval-summary.json";
  if (!existsSync(filePath)) {
    record("beelink_model_artifacts", false, { filePath });
    issues.push("Beelink model evaluation summary cache is missing.");
    actions.push("Copy /data/models/translation-model-eval/outputs/beelink-model-eval-summary.json from Beelink.");
    return;
  }

  const summary = JSON.parse(readFileSync(filePath, "utf8"));
  const models = summary.downloadIntegrity?.models ?? [];
  const completeModels = models.filter((model) => model.status === "complete");
  record("beelink_model_artifacts", completeModels.length >= 5, {
    generatedAt: summary.generatedAt,
    completeModels: completeModels.map((model) => model.name),
    totalBytes: completeModels.reduce((total, model) => total + Number(model.bytes ?? 0), 0),
  });
  if (completeModels.length < 5) issues.push("Not all Beelink candidate models were downloaded completely.");

  const hasOutputs = Boolean(
    summary.translation?.results?.length >= 5 &&
      summary.asr?.qwen3_asr?.results?.length >= 1 &&
      summary.asr?.fireredasr2_aed?.results?.length >= 1 &&
      summary.tts?.qwen3_tts?.output,
  );
  record("beelink_real_model_outputs", hasOutputs, {
    translationCases: summary.translation?.results?.length ?? 0,
    qwen3AsrText: summary.asr?.qwen3_asr?.results?.[0]?.text ?? null,
    fireRedAsrText: summary.asr?.fireredasr2_aed?.results?.[0]?.text ?? null,
    qwen3Tts: summary.tts?.qwen3_tts ?? null,
    cosyVoice2: summary.tts?.cosyvoice2 ?? null,
  });
  if (!hasOutputs) issues.push("Beelink real model outputs are incomplete.");

  const cosyVoiceReady = summary.tts?.cosyvoice2?.status !== "downloaded_not_evaluated";
  record("beelink_cosyvoice2_runtime", cosyVoiceReady, {
    status: summary.tts?.cosyvoice2?.status ?? "unknown",
    reason: summary.tts?.cosyvoice2?.reason ?? null,
  });
  if (!cosyVoiceReady) {
    issues.push("CosyVoice2 is downloaded but not evaluated.");
    actions.push("Install or vendor the official CosyVoice2 runtime, then rerun TTS inference.");
  }
}

function run(command) {
  const [binary, ...commandArgs] = command;
  const execution = spawnSync(binary, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return {
    ok: execution.status === 0,
    status: execution.status,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
  };
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function record(name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  node scripts/check_comprehensive_model_readiness.mjs [--json] [--skip-slow]
  node scripts/check_comprehensive_model_readiness.mjs --output .cache/model-eval/comprehensive-model-readiness.json

Runs local on-device and cross-platform/call model gates for ASR, translation
and TTS. The comprehensive real fixture may be not_ready while gray candidate
gaps remain; that is expected after MVP default model selection.`);
}
