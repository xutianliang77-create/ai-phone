#!/usr/bin/env node
import { checkCoreTranslationCandidateDeploy } from
  "./lib/core_translation_candidate_deploy.mjs";

const args = process.argv.slice(2);
if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const result = checkCoreTranslationCandidateDeploy({
  root: process.cwd(),
  envFile: valueFlag("--env-file") ?? process.env.CANDIDATE_ENV_FILE,
  composeProject:
    valueFlag("--compose-project") ?? process.env.COMPOSE_PROJECT_NAME,
  containerPrefix:
    valueFlag("--container-prefix") ?? process.env.AI_PHONE_CONTAINER_PREFIX,
  remoteRoot: valueFlag("--remote-root") ?? process.env.REMOTE_ROOT,
  apiPort: valueFlag("--api-port") ?? process.env.API_PORT,
  realtimePort: valueFlag("--realtime-port") ?? process.env.REALTIME_PORT,
  translationAgentPort:
    valueFlag("--translation-agent-port") ?? process.env.LIVEKIT_AGENT_PORT,
  reservedPorts: parsePorts(
    valueFlag("--reserved-ports") ?? process.env.CANDIDATE_RESERVED_PORTS,
  ),
});

if (hasFlag("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log(
    `Core translation candidate preflight passed (${result.composeProject}).`,
  );
} else {
  console.error(`Core translation candidate preflight failed:`);
  for (const issue of result.issues) console.error(`- ${issue}`);
}
if (result.status !== "ready") process.exitCode = 1;

function valueFlag(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function parsePorts(value) {
  if (!value) return undefined;
  return value.split(",").map((item) => Number(item.trim()));
}

function usage() {
  console.log(`Usage:
  node scripts/check_core_translation_candidate_deploy.mjs \\
    --env-file release/domestic/release.env \\
    --compose-project ai-phone-core-candidate \\
    --container-prefix ai-phone-core-candidate \\
    --remote-root /data/models/ai-phone-server-candidates/core-translation \\
    --api-port 3320 --realtime-port 3321 --translation-agent-port 8381

The preflight is fail-closed. It requires a regular 0600 production env using
the core_translation capability profile, isolated Compose/container names,
an isolated remote root, and ports that do not overlap reserved services.`);
}
