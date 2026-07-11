import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkIosServiceStartupContract } from "./ios_service_startup_contract_check.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkIosServiceStartupContract", () => {
  test("passes when the final service startup path uses LM Studio and LAN URLs", () => {
    tempDir = makeProject();

    expect(checkIosServiceStartupContract(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when services stop using the runtime contract defaults", () => {
    tempDir = makeProject({
      services: 'REALTIME_PROVIDER="${REALTIME_PROVIDER:-mock}"',
    });

    const result = checkIosServiceStartupContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "services default to LM Studio from contract",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-service-startup-"));
  write(root, "scripts/ios_nemotron_start_services.sh", overrides.services ?? `
ios_nemotron_runtime_contract_env.mjs
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
REALTIME_PROVIDER="\${REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER}"
SESSION_EVENT_SINK="\${SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK}"
ASR_PROVIDER="\${ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER}"
LMSTUDIO_BASE_URL="\${LMSTUDIO_BASE_URL:-http://222.128.62.139:1234/v1}"
LMSTUDIO_MODEL="\${LMSTUDIO_MODEL:-qwen/qwen3.5-9b}"
API_BASE_URL_IPHONE="http://$MAC_LAN_IP:$API_PORT"
REALTIME_BASE_URL_IPHONE="http://$MAC_LAN_IP:$REALTIME_PORT"
REALTIME_WS_ENDPOINT="ws://$MAC_LAN_IP:$REALTIME_PORT/realtime"
REALTIME_WS_ENDPOINT="$REALTIME_WS_ENDPOINT"
REALTIME_PROVIDER="$REALTIME_PROVIDER"
SESSION_EVENT_SINK="$SESSION_EVENT_SINK"
API_BASE_URL="$API_BASE_URL_LOCAL"
LMSTUDIO_BASE_URL="$LMSTUDIO_BASE_URL"
LMSTUDIO_MODEL="$LMSTUDIO_MODEL"
ASR_PROVIDER="$ASR_PROVIDER"
assert_api_endpoint
assert_gateway_runtime
health[field] !== value
check_lmstudio_translation_provider.mjs
`);
  write(root, "scripts/ios_nemotron_run_mvp.sh", `
API_BASE_URL="http://$MAC_LAN_IP:$API_PORT"
REALTIME_BASE_URL="http://$MAC_LAN_IP:$REALTIME_PORT"
ios_nemotron_start_services.sh
API_BASE_URL="$API_BASE_URL"
REALTIME_BASE_URL="$REALTIME_BASE_URL"
SESSION_EVENT_SINK="$SESSION_EVENT_SINK"
ios_nemotron_mvp_status.mjs" --strict
ios_nemotron_mvp_smoke.sh
`);
  write(root, "scripts/lib/ios_nemotron_service_status_gate.mjs", `
iosNemotronRequiredRuntimeContract
const expectedProvider = process.env.REALTIME_PROVIDER ?? contract.gatewayProvider;
const expectedAsrProvider = process.env.ASR_PROVIDER ?? contract.gatewayAsrProvider;
const expectedSessionEventSink = process.env.SESSION_EVENT_SINK ?? contract.gatewaySessionEventSink;
gateway.json?.provider !== expectedProvider
gateway.json?.asrProvider !== expectedAsrProvider
gateway.json?.sessionEventSink !== expectedSessionEventSink
expectedProvider
expectedAsrProvider
expectedSessionEventSink
`);
  write(root, "services/realtime-gateway/src/connection/gateway-health.ts", `
provider: env.provider
asrProvider: env.asrProvider
sessionEventSink: env.sessionEventSink
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
