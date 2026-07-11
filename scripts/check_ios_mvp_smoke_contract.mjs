#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkIosMvpSmokeContract } from "./lib/ios_mvp_smoke_contract_check.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = checkIosMvpSmokeContract(root);
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("iOS MVP smoke contract is ready.");
} else {
  console.error(
    result.failures.map((failure) => failure.issue).filter(Boolean).join("\n"),
  );
}

if (result.status !== "ready") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function usage() {
  console.log(`Usage:
  scripts/check_ios_mvp_smoke_contract.mjs [--json]

Checks that the final iPhone MVP smoke path runs diagnostics, real microphone
ASR, Gateway translation, history persistence, and report markers.`);
}
