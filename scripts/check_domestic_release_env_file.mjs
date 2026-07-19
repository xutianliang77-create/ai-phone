#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDomesticReleaseEnvFile } from "./lib/domestic_release_env_file_check.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const file = valueFlag("--file") ?? process.env.DOMESTIC_RELEASE_ENV_FILE;

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = {
  generatedAt: new Date().toISOString(),
  ...checkDomesticReleaseEnvFile({ root, file }),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(
    `Domestic release env file readiness passed (${result.profile}).`,
  );
} else {
  console.error(
    `Domestic release env file readiness failed: ${result.issues.join("; ")}`,
  );
  for (const check of result.checks) {
    console.error(
      `${check.status === "pass" ? "pass" : "fail"}: ${check.name}`,
    );
  }
  for (const action of result.actions) console.error(`action: ${action}`);
}

if (result.status !== "ready") process.exit(1);

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
  if (!value || value.startsWith("-"))
    throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/check_domestic_release_env_file.mjs --json
  scripts/check_domestic_release_env_file.mjs --file release/domestic/release.env --json

Verifies that a domestic production env file contains real external service
configuration before running the full release-ready gate:
- DOMESTIC_RELEASE_CAPABILITY_PROFILE explicitly selects core_translation or
  commercial_full; deferred Provider switches must be off in core_translation
- Apple IAP, WeChat Pay, Alipay, payment callback URL
- LiveKit room provider and public call link URL
- Diagnostics on-call webhook and admin token
- Hy-MT2 OpenAI-compatible translation API settings
- VoxCPM2 TTS HTTP endpoint, provider/model identity and API key
- PSTN Bridge base URL and provider/media callback settings
- release materials and model selection artifact paths
- minimum secret lengths and Apple root certificate SHA-256 hex format`);
}
