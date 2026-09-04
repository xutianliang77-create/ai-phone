#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDependencySecurity } from "./lib/dependency_security.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const policy = JSON.parse(readFileSync(
  path.join(root, "infra/dependency-security/dependency-policy.json"),
  "utf8",
));
const auditRun = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (!auditRun.stdout.trim()) {
  throw new Error(`npm audit produced no JSON: ${auditRun.stderr.trim()}`);
}
const audit = JSON.parse(auditRun.stdout);
const apiPackage = readJson("services/api-server/package.json");
const translationWorkerPackage = readJson("services/translation-worker/package.json");
const voiceAgentPackage = readJson("services/voice-agent-runtime/package.json");
const telemetrySource = readFileSync(
  path.join(
    root,
    "services/api-server/src/infrastructure/observability/platform-telemetry.ts",
  ),
  "utf8",
);
const result = checkDependencySecurity({
  audit,
  policy,
  apiDependencies: apiPackage.dependencies,
  agentVersions: [
    translationWorkerPackage.dependencies?.["@livekit/agents"],
    voiceAgentPackage.dependencies?.["@livekit/agents"],
  ],
  agentPluginVersion:
    voiceAgentPackage.dependencies?.["@livekit/agents-plugin-openai"],
  telemetrySource,
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== "ready") process.exit(1);

function readJson(value) {
  return JSON.parse(readFileSync(path.join(root, value), "utf8"));
}
