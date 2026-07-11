#!/usr/bin/env node
import { checkPstnInternalMediaLoopReadiness } from "./lib/pstn_internal_media_loop_readiness.mjs";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const help = takeFlag("--help") || takeFlag("-h");
const timeoutMs = valueFlag("--timeout-ms");

if (help) {
  console.log(`Usage:
  scripts/check_pstn_internal_media_loop_readiness.mjs [--json] [--no-save] [--timeout-ms 60000]

Starts PSTN Bridge, Translation Worker PSTN audio sink, and local mock ASR,
translation, TTS, API events, PSTN upstream, and media writer endpoints. It
then verifies one phone media frame completes the internal media loop.
`);
  process.exit(0);
}

const result = await checkPstnInternalMediaLoopReadiness({
  timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${result.status}: PSTN internal media loop readiness`);
  for (const check of result.checks) console.log(`- ${check.status}: ${check.name}`);
  for (const issue of result.issues) console.log(`issue: ${issue}`);
  for (const action of result.actions) console.log(`action: ${action}`);
}

if (!noSave && json) {
  // Keep stdout as the artifact so CI can decide where to store it.
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
