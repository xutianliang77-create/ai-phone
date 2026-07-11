#!/usr/bin/env node
import { checkTranslationWorkerPstnAudioSinkReadiness } from "./lib/translation_worker_pstn_audio_sink_readiness.mjs";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const help = takeFlag("--help") || takeFlag("-h");
const timeoutMs = valueFlag("--timeout-ms");

if (help) {
  console.log(`Usage:
  scripts/check_translation_worker_pstn_audio_sink_readiness.mjs [--json] [--no-save] [--timeout-ms 60000]

Starts the real Translation Worker PSTN audio frame sink, local mock ASR,
translation, TTS, event API, and TTS playback services, then verifies one
PSTN PCM16 frame reaches ASR and produces translated captions plus TTS playback.
`);
  process.exit(0);
}

const result = await checkTranslationWorkerPstnAudioSinkReadiness({
  timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.status}: Translation Worker PSTN audio sink readiness`);
  for (const check of result.checks) {
    console.log(`- ${check.status}: ${check.name}`);
  }
  for (const issue of result.issues) console.log(`issue: ${issue}`);
  for (const action of result.actions) console.log(`action: ${action}`);
}

if (!noSave && json) {
  // The JSON output is intentionally stdout-only for easy CI capture.
}

if (result.status !== "ready") process.exitCode = 1;

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
