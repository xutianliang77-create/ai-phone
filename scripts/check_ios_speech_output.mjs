#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help) {
  console.log(`Usage:
  node scripts/check_ios_speech_output.mjs [--json]

Checks the Flutter <-> iOS system TTS bridge contract used by Type-to-Speak and
future local-mode speech output.`);
  process.exit(0);
}

const root = process.cwd();
const checks = [];
const failures = [];

checkFile(
  "apps/mobile/lib/src/platform/speech/speech_output_provider.dart",
  [
    ["Dart MethodChannel name", "translation_mobile/speech_output"],
    ["Dart calls native speak", "invokeMapMethod<String, Object?>("],
    ["Dart sends text", "'text': text"],
    ["Dart sends language", "'language': language"],
    ["Dart reads provider", "result?['provider']"],
    ["Dart reads language", "result?['language']"],
    ["Dart calls native stop", "invokeMethod<void>('stop')"],
  ],
);

checkFile(
  "apps/mobile/ios/Runner/SpeechOutputBridge.swift",
  [
    ["Swift imports AVFoundation", "import AVFoundation"],
    ["Swift MethodChannel name", "translation_mobile/speech_output"],
    ["Swift uses AVSpeechSynthesizer", "AVSpeechSynthesizer()"],
    ["Swift handles speak", 'case "speak"'],
    ["Swift handles stop", 'case "stop"'],
    ["Swift validates text", 'guard let text'],
    ["Swift creates utterance", "AVSpeechUtterance(string: text)"],
    ["Swift selects voice", "AVSpeechSynthesisVoice(language:"],
    ["Swift returns iOS system TTS provider", "ios_system_tts"],
  ],
);

checkFile(
  "apps/mobile/ios/Runner/AppDelegate.swift",
  [
    ["AppDelegate creates speech bridge", "SpeechOutputBridge()"],
    ["AppDelegate registers speech bridge", 'forPlugin: "SpeechOutputBridge"'],
  ],
);

const result = {
  schemaVersion: 1,
  status: failures.length === 0 ? "ready" : "not_ready",
  checks,
  failures,
};

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`iOS speech output ${result.status}`);
  for (const check of checks) console.log(`- ${check.pass ? "pass" : "fail"}: ${check.label}`);
  for (const failure of failures) console.error(`issue: ${failure}`);
}

if (failures.length > 0) process.exitCode = 1;

function checkFile(relativePath, expectations) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    record(relativePath, "file exists", false, "file missing");
    return;
  }
  const content = readFileSync(absolutePath, "utf8");
  for (const [label, pattern] of expectations) {
    record(relativePath, label, content.includes(pattern), `missing ${pattern}`);
  }
}

function record(file, label, pass, issue) {
  checks.push({ file, label, pass, issue: pass ? null : issue });
  if (!pass) failures.push(`${file}: ${label} (${issue})`);
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
