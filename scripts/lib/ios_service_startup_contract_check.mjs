import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkIosServiceStartupContract(root) {
  const checks = [];
  requireContains(checks, root, "scripts/ios_nemotron_start_services.sh", [
    ["ios_nemotron_runtime_contract_env.mjs", "services load required runtime contract"],
    [
      "RUNTIME_CONTRACT_ENV=\"$(node \"$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs\")\"",
      "services fail if runtime contract export fails",
    ],
    ["eval \"$RUNTIME_CONTRACT_ENV\"", "services apply runtime contract env"],
    [
      "REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER",
      "services default to LM Studio from contract",
    ],
    [
      "SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK",
      "services default to API history sink from contract",
    ],
    [
      "ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER",
      "services default Gateway ASR from contract",
    ],
    ['LMSTUDIO_BASE_URL="${LMSTUDIO_BASE_URL:-http://222.128.62.139:1234/v1}"', "services default to configured LM Studio base URL"],
    ['LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-qwen/qwen3.5-9b}"', "services default to configured LM Studio model"],
    ['API_BASE_URL_IPHONE="http://$MAC_LAN_IP:$API_PORT"', "services expose API on Mac LAN IP"],
    ['REALTIME_BASE_URL_IPHONE="http://$MAC_LAN_IP:$REALTIME_PORT"', "services expose Gateway on Mac LAN IP"],
    ['REALTIME_WS_ENDPOINT="ws://$MAC_LAN_IP:$REALTIME_PORT/realtime"', "services publish LAN websocket endpoint"],
    ['REALTIME_WS_ENDPOINT="$REALTIME_WS_ENDPOINT"', "API receives realtime websocket endpoint"],
    ['REALTIME_PROVIDER="$REALTIME_PROVIDER"', "Gateway receives realtime provider"],
    ['SESSION_EVENT_SINK="$SESSION_EVENT_SINK"', "Gateway receives history sink"],
    ['API_BASE_URL="$API_BASE_URL_LOCAL"', "Gateway writes history to local API"],
    ['LMSTUDIO_BASE_URL="$LMSTUDIO_BASE_URL"', "Gateway receives LM Studio base URL"],
    ['LMSTUDIO_MODEL="$LMSTUDIO_MODEL"', "Gateway receives LM Studio model"],
    ['ASR_PROVIDER="$ASR_PROVIDER"', "Gateway receives ASR provider"],
    ["assert_api_endpoint", "services assert API health websocket endpoint"],
    ["assert_gateway_runtime", "services assert Gateway runtime routing"],
    ["health[field] !== value", "Gateway runtime assertion validates health fields"],
    ["check_lmstudio_translation_provider.mjs", "services checks LM Studio translation provider"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_run_mvp.sh", [
    ['API_BASE_URL="http://$MAC_LAN_IP:$API_PORT"', "run uses Mac LAN API URL"],
    ['REALTIME_BASE_URL="http://$MAC_LAN_IP:$REALTIME_PORT"', "run uses Mac LAN Gateway URL"],
    ["ios_nemotron_start_services.sh", "run starts API/Gateway services"],
    ['API_BASE_URL="$API_BASE_URL"', "run passes API URL to status and smoke"],
    ['REALTIME_BASE_URL="$REALTIME_BASE_URL"', "run passes Gateway URL to status and smoke"],
    ['SESSION_EVENT_SINK="$SESSION_EVENT_SINK"', "run passes history sink to status and smoke"],
    ['ios_nemotron_mvp_status.mjs" --strict', "run enforces strict status before smoke"],
    ["ios_nemotron_mvp_smoke.sh", "run invokes final smoke"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_service_status_gate.mjs", [
    ["iosNemotronRequiredRuntimeContract", "status uses required runtime contract"],
    ["contract.gatewayProvider", "status expects runtime-contract Gateway provider by default"],
    ["contract.gatewayAsrProvider", "status expects runtime-contract Gateway ASR provider by default"],
    ["process.env.SESSION_EVENT_SINK", "status honors configured history sink"],
    ["contract.gatewaySessionEventSink", "status defaults to runtime-contract history sink"],
    ["gateway.json?.provider !== expectedProvider", "status validates Gateway provider"],
    ["gateway.json?.asrProvider !== expectedAsrProvider", "status validates Gateway ASR provider"],
    ["gateway.json?.sessionEventSink !== expectedSessionEventSink", "status validates server-owned history sink"],
    ["expectedProvider", "status details include expected provider"],
    ["expectedAsrProvider", "status details include expected ASR provider"],
    ["expectedSessionEventSink", "status details include expected history sink"],
  ]);
  requireContains(checks, root, "services/realtime-gateway/src/connection/gateway-health.ts", [
    ["provider: env.provider", "Gateway health exposes realtime provider"],
    ["asrProvider: env.asrProvider", "Gateway health exposes ASR provider"],
    ["sessionEventSink: env.sessionEventSink", "Gateway health exposes history sink"],
  ]);

  const failures = checks.filter((check) => !check.pass);
  return {
    schemaVersion: 1,
    status: failures.length === 0 ? "ready" : "not_ready",
    checks,
    failures,
  };
}

function requireContains(checks, root, relativePath, definitions) {
  const file = path.join(root, relativePath);
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!content) {
    checks.push({
      file: relativePath,
      label: "file exists",
      pass: false,
      issue: `${relativePath} is missing or empty`,
    });
    return;
  }
  for (const [needle, label] of definitions) {
    const pass = content.includes(needle);
    checks.push({
      file: relativePath,
      label,
      pass,
      issue: pass ? null : `${relativePath} missing ${needle}`,
    });
  }
}
