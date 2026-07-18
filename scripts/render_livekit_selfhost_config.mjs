#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLiveKitSelfHostConfig,
  parseEnvFile,
  renderLiveKitSelfHostFiles,
} from "./lib/livekit_selfhost_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const envFile = path.resolve(
  root,
  valueFlag("--env") ?? process.env.LIVEKIT_SELFHOST_ENV_FILE ?? "infra/livekit-selfhost/.env",
);
const outputDir = path.resolve(
  root,
  valueFlag("--output") ?? "infra/livekit-selfhost/generated",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const check = checkLiveKitSelfHostConfig({ root, envFile });
if (check.status !== "ready") {
  print({ status: "not_ready", envFile, outputDir, issues: check.issues });
  process.exit(1);
}

const env = parseEnvFile(readFileSync(envFile, "utf8"));
const files = renderLiveKitSelfHostFiles(env);
mkdirSync(outputDir, { recursive: true, mode: 0o700 });
chmodSync(outputDir, 0o700);
for (const [fileName, content] of Object.entries(files)) {
  const file = path.join(outputDir, fileName);
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

print({
  status: "ready",
  envFile,
  outputDir,
  files: Object.keys(files).map((file) => path.join(outputDir, file)),
});

function print(result) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.status === "ready") {
    console.log(`Rendered LiveKit self-host files to ${result.outputDir}`);
  } else {
    console.error(`LiveKit self-host config not ready: ${result.issues.join("; ")}`);
  }
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
  scripts/render_livekit_selfhost_config.mjs \\
    --env infra/livekit-selfhost/.env \\
    --output infra/livekit-selfhost/generated \\
    --json

Renders docker-compose.yaml, livekit.yaml, Caddyfile, redis.conf, and
release.env.snippet from the private self-host LiveKit env file.`);
}
