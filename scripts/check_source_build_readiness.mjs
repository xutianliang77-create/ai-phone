#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = checkSourceBuildReadiness(root);

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (result.status === "ready") {
  process.stdout.write("Source build readiness passed.\n");
} else {
  process.stderr.write(`Source build readiness failed: ${result.issues.join("; ")}\n`);
}
if (result.status !== "ready") process.exitCode = 1;

export function checkSourceBuildReadiness(
  repositoryRoot,
  run = spawnSync,
) {
  const issues = [];
  const build = run("npm", ["run", "build"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (build.status !== 0) {
    issues.push(`workspace build failed: ${tail(build.stderr || build.stdout)}`);
  }

  const entrypoints = [
    "packages/contracts/dist/index.js",
    "packages/llm/dist/index.js",
    "packages/platform-security/dist/index.js",
    "packages/speech-quality/dist/index.js",
    "services/api-server/dist/main.js",
    "services/realtime-gateway/dist/main.js",
    "services/translation-worker/dist/main.js",
    "services/pstn-bridge/dist/main.js",
    "services/srt-ingress-bridge/dist/main.js",
    "services/voice-agent-runtime/dist/agent-server.js",
  ];
  const missing = entrypoints.filter(
    (file) => !existsSync(path.join(repositoryRoot, file)),
  );
  if (missing.length > 0) issues.push(`missing built entrypoints: ${missing.join(", ")}`);

  const dockerfile = read(
    path.join(repositoryRoot, "infra/ai-phone-server/Dockerfile"),
  );
  for (const workspace of [
    "@translation/contracts",
    "@translation/llm",
    "@translation/platform-security",
    "@translation/speech-quality",
    "@translation/api-server",
    "@translation/realtime-gateway",
    "@translation/translation-worker",
    "@translation/pstn-bridge",
    "@translation/srt-ingress-bridge",
    "@translation/voice-agent-runtime",
  ]) {
    if (!dockerfile.includes(`npm run build -w ${workspace}`)) {
      issues.push(`Dockerfile does not build ${workspace}`);
    }
  }
  if (!dockerfile.includes("npm ci")) {
    issues.push("Dockerfile must install the locked dependency graph with npm ci");
  }
  if (
    !dockerfile.includes("@ffmpeg-installer/linux-x64@4.1.0") ||
    !dockerfile.includes(
      "test -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg",
    )
  ) {
    issues.push("Dockerfile must install and verify the LiveKit Linux ffmpeg runtime");
  }

  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    checks: {
      workspaceBuild: build.status === 0,
      entrypoints: entrypoints.length - missing.length,
      expectedEntrypoints: entrypoints.length,
      dockerBuildFromSource: !issues.some((issue) => issue.startsWith("Dockerfile")),
    },
    issues,
  };
}

function read(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function tail(value) {
  return String(value).trim().split("\n").slice(-3).join(" | ");
}
