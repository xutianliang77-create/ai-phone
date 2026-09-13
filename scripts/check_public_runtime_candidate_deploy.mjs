#!/usr/bin/env node
import { checkPublicRuntimeCandidateDeploy } from "./lib/public_runtime_candidate_deploy.mjs";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`Usage:
  node scripts/check_public_runtime_candidate_deploy.mjs \\
    --api-env-file /isolated/public-api.env \\
    --gateway-env-file /isolated/public-gateway.env \\
    --compose-project wujie-v11-public-candidate \\
    --container-prefix wujie-v11-public-candidate \\
    --remote-root /data/models/ai-phone-server-candidates/wujie-v11-public \\
    --api-port 13110 --gateway-port 13111 --internal-tls-port 13112

This is offline-only. A passing result means the candidate surface is ready
for runtime validation; it does not start containers, load credentials, call
providers, or claim Gateway readiness.`);
  process.exit(0);
}

const result = checkPublicRuntimeCandidateDeploy({
  root: process.cwd(),
  apiEnvFile: value("--api-env-file") ?? process.env.PUBLIC_API_ENV_FILE,
  gatewayEnvFile: value("--gateway-env-file") ?? process.env.PUBLIC_GATEWAY_ENV_FILE,
  composeProject: value("--compose-project") ?? process.env.COMPOSE_PROJECT_NAME,
  containerPrefix: value("--container-prefix") ?? process.env.AI_PHONE_CONTAINER_PREFIX,
  remoteRoot: value("--remote-root") ?? process.env.REMOTE_ROOT,
  apiPort: value("--api-port") ?? process.env.API_PORT,
  gatewayPort: value("--gateway-port") ?? process.env.REALTIME_PORT,
  internalTlsPort: value("--internal-tls-port") ?? process.env.INTERNAL_TLS_PORT,
});

if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready_for_runtime_validation") {
  console.log("Public candidate preflight passed; runtime validation is still required.");
} else {
  console.error("Public candidate preflight failed:");
  for (const issue of result.issues) console.error(`- ${issue}`);
}
if (result.status !== "ready_for_runtime_validation") process.exitCode = 1;

function value(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
