#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { charErrorRate } from "./lib/model_eval_metrics.mjs";
import { nextTurnPrompt } from "./lib/nemotron_language_routing.mjs";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
const root = process.cwd();
const cli = path.resolve(
  takeOption("--cli") ?? process.env.FLUIDAUDIO_CLI ?? findDefaultCli(),
);
const modelDir = path.resolve(
  takeOption("--model-dir") ??
    "apps/mobile/ios/Runner/Models/multilingual/2240ms",
);
const output = path.resolve(
  takeOption("--output") ??
    `outputs/asr-language-ab-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const turnPolicy = takeOption("--turn-policy") ?? "alternate";
const noSave = takeFlag("--no-save");
if (args.length > 0) {
  usage();
  process.exit(1);
}
if (!existsSync(cli)) throw new Error(`FluidAudio CLI not found: ${cli}`);
if (!existsSync(modelDir)) throw new Error(`Nemotron model not found: ${modelDir}`);

const samples = [
  {
    id: "zh_short_002",
    input: "test-audio/iphone14-small-models/zh_short_002-24k.wav",
    expected: "今天下午三点我们开产品会议。",
  },
  {
    id: "en_short_001",
    input: "test-audio/iphone14-small-models/en_short_001-24k.wav",
    expected: "What is your name?",
  },
  {
    id: "mixed_003",
    input: "test-audio/iphone14-small-models/mixed_003-24k.wav",
    expected:
      "我们要测试 FireRedASR2，Hy-MT2 和 VoxCPM2 的在线模型链路。",
  },
  {
    id: "rt_p0_numbers_001",
    input:
      "test-audio/realtime-online-eval-v1/clean-24k-wav/rt_p0_numbers_001.wav",
    expected: "收货地址是北京市朝阳区建国路八十八号，订单号是 A-120。",
  },
].map((sample) => ({ ...sample, input: path.resolve(root, sample.input) }));

for (const sample of samples) {
  if (!existsSync(sample.input)) {
    throw new Error(`Audio sample not found: ${sample.input}`);
  }
}

const rows = [];
for (const mode of ["auto", "zh-CN", "en-US", "turn"]) {
  let prompt = mode === "turn" ? "auto" : mode;
  for (const sample of samples) {
    const result = transcribe(sample.input, prompt);
    rows.push({
      mode,
      prompt,
      sampleId: sample.id,
      expected: sample.expected,
      transcript: result.transcript,
      detectedLanguage: result.detectedLanguage,
      cer: charErrorRate(sample.expected, result.transcript),
    });
    if (mode === "turn") {
      prompt = nextTurnPrompt(result.transcript, turnPolicy);
    }
  }
}

const summary = Object.fromEntries(
  ["auto", "zh-CN", "en-US", "turn"].map((mode) => {
    const values = rows.filter((row) => row.mode === mode);
    const average =
      values.reduce((sum, row) => sum + row.cer, 0) / values.length;
    return [mode, { averageCer: Math.round(average * 10000) / 10000 }];
  }),
);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  cli,
  modelDir,
  turnPolicy,
  summary,
  rows,
};
if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ output: noSave ? null : output, summary }, null, 2));

function transcribe(input, language) {
  const result = spawnSync(
    cli,
    [
      "nemotron-multilingual-transcribe",
      "--model-dir",
      modelDir,
      "--language",
      language,
      "--input",
      input,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const outputText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `FluidAudio CLI failed for ${path.basename(input)} (${language}):\n${outputText}`,
    );
  }
  const transcript = lastMatch(outputText, /Transcript:[ \t]*(.*)$/gm);
  if (transcript === null) {
    throw new Error(
      `Transcript was missing for ${path.basename(input)} (${language})`,
    );
  }
  return {
    transcript: transcript.trim(),
    detectedLanguage:
      lastMatch(outputText, /Detected:\s+(.+)$/gm)?.trim() ?? null,
  };
}

function lastMatch(value, pattern) {
  return Array.from(value.matchAll(pattern)).at(-1)?.[1] ?? null;
}

function findDefaultCli() {
  const derivedData = path.join(
    os.homedir(),
    "Library/Developer/Xcode/DerivedData",
  );
  if (existsSync(derivedData)) {
    for (const name of readdirSync(derivedData)) {
      if (!name.startsWith("Runner-")) continue;
      for (const variant of ["debug", "release"]) {
        const candidate = path.join(
          derivedData,
          name,
          "SourcePackages/checkouts/FluidAudio/.build/arm64-apple-macosx",
          variant,
          "fluidaudiocli",
        );
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "fluidaudiocli";
}

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/run_nemotron_language_ab.mjs [--cli PATH] [--turn-policy alternate]

Runs the same fixed corpus with auto, zh-CN, en-US and turn-level routing.
Use a debug FluidAudio CLI build because release unified logging redacts text.`);
}
