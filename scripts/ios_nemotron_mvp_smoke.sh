#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
DEVICE_ID="${DEVICE_ID:-}"
API_BASE_URL="${API_BASE_URL:-}"
REALTIME_BASE_URL="${REALTIME_BASE_URL:-}"
REALTIME_PORT="${REALTIME_PORT:-3201}"
IOS_MVP_SMOKE_STEPS="${IOS_MVP_SMOKE_STEPS:-diagnostics,selftest,local_mvp}"
DEVICE_ASR_AUTO_DOWNLOAD_MODEL="${DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL}"
DEVICE_ASR_MODEL_CHUNK_MS="${DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS}"
DEVICE_ASR_CHUNK_DURATION_MS="${DEVICE_ASR_CHUNK_DURATION_MS:-320}"
DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS="${DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS:-600}"
DEVICE_ASR_ENDPOINT_SILENCE_MS="${DEVICE_ASR_ENDPOINT_SILENCE_MS:-900}"
DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS="${DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS:-0.006}"
SOURCE_LANGUAGE="${SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE}"
TARGET_LANGUAGE="${TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE}"
USE_LOCAL_SESSIONS="${USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS}"
USE_ON_DEVICE_TRANSLATION="${USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION}"
ON_DEVICE_TRANSLATION_PROVIDER="${ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER}"
ON_DEVICE_TRANSLATION_REQUIRED="${ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED}"
DEVICE_ASR_PREPARE_MODEL="${DEVICE_ASR_PREPARE_MODEL:-true}"
DEVICE_ASR_SELF_TEST_SECONDS="${DEVICE_ASR_SELF_TEST_SECONDS:-20}"
DEVICE_ASR_E2E_SECONDS="${DEVICE_ASR_E2E_SECONDS:-45}"
SERVER_OWNED_HISTORY="${SERVER_OWNED_HISTORY:-true}"
REALTIME_PROVIDER="${REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER}"
ASR_PROVIDER="${ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER}"
SESSION_EVENT_SINK="${SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK}"
EXPECTED_GATEWAY_PROVIDER="${EXPECTED_GATEWAY_PROVIDER:-$REALTIME_PROVIDER}"
EXPECTED_GATEWAY_ASR_PROVIDER="${EXPECTED_GATEWAY_ASR_PROVIDER:-$ASR_PROVIDER}"
EXPECTED_GATEWAY_SESSION_EVENT_SINK="${EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$SESSION_EVENT_SINK}"
export DEVICE_ASR_CHUNK_DURATION_MS DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS
export DEVICE_ASR_ENDPOINT_SILENCE_MS DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS

usage() {
  cat <<'USAGE'
Usage:
  DEVICE_ID="Wha的iPhone" \
  API_BASE_URL=http://MAC_LAN_IP:3100 \
  REALTIME_BASE_URL=http://MAC_LAN_IP:3201 \
  scripts/ios_nemotron_mvp_smoke.sh

Environment:
  DEVICE_ID                       Required physical iPhone name/id.
  API_BASE_URL                    API server URL. Required for e2e unless a LAN IP is detected.
  REALTIME_BASE_URL               Gateway HTTP URL. Defaults to API host + REALTIME_PORT.
  REALTIME_PORT                   3201 by default when deriving REALTIME_BASE_URL.
  MAC_LAN_INTERFACE               Optional interface preference for LAN IP detection.
  IOS_MVP_SMOKE_STEPS             diagnostics,selftest,local_mvp by default.
                                  The default sequence runs in one Flutter test
                                  install via IOS_SMOKE_MODE=mvp.
  DEVICE_ASR_AUTO_DOWNLOAD_MODEL  false by default; use staged bundle.
  DEVICE_ASR_MODEL_CHUNK_MS       2240 by default; matches staged Nemotron tier.
  DEVICE_ASR_* endpoint tuning    chunk size, min speech, silence, RMS threshold.
  SOURCE_LANGUAGE                 auto by default.
  TARGET_LANGUAGE                 zh by default.
  USE_LOCAL_SESSIONS              true by default for local app session history.
  USE_ON_DEVICE_TRANSLATION       true by default for the on-device MVP path.
  ON_DEVICE_TRANSLATION_PROVIDER  ios_system by default.
  ON_DEVICE_TRANSLATION_REQUIRED  true by default for local MVP.
  DEVICE_ASR_PREPARE_MODEL        true by default for diagnostics.
  DEVICE_ASR_SELF_TEST_SECONDS    20 by default.
  DEVICE_ASR_E2E_SECONDS          45 by default.

The script fails before Flutter if the physical iPhone is not ready.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "DEVICE_ID is required for the physical iPhone MVP smoke." >&2
  exit 2
fi

validate_steps() {
  IFS=',' read -ra entries <<<"$IOS_MVP_SMOKE_STEPS"
  for raw_entry in "${entries[@]}"; do
    entry="$(echo "$raw_entry" | xargs)"
    case "$entry" in
      diagnostics | selftest | local_mvp | e2e | "")
        ;;
      *)
        echo "Unknown IOS_MVP_SMOKE_STEPS entry: $entry" >&2
        exit 2
        ;;
    esac
  done
}

run_step() {
  local step="$1"
  case "$step" in
    diagnostics)
      echo "== iOS Nemotron MVP smoke: diagnostics =="
      DEVICE_ID="$DEVICE_ID" \
      IOS_SMOKE_MODE=diagnostics \
      DEVICE_ASR_PREPARE_MODEL="$DEVICE_ASR_PREPARE_MODEL" \
      DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" \
      DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS" \
      EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER" \
      EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER" \
      EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK" \
        "$ROOT_DIR/scripts/ios_nemotron_device_smoke.sh"
      ;;
    selftest)
      echo "== iOS Nemotron MVP smoke: selftest =="
      DEVICE_ID="$DEVICE_ID" \
      IOS_SMOKE_MODE=selftest \
      DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" \
      DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS" \
      SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
      TARGET_LANGUAGE="$TARGET_LANGUAGE" \
      USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
      USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
      ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
      ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
      DEVICE_ASR_SELF_TEST_SECONDS="$DEVICE_ASR_SELF_TEST_SECONDS" \
      EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER" \
      EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER" \
      EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK" \
        "$ROOT_DIR/scripts/ios_nemotron_device_smoke.sh"
      ;;
    e2e)
      echo "== iOS Nemotron MVP smoke: e2e =="
      DEVICE_ID="$DEVICE_ID" \
      IOS_SMOKE_MODE=e2e \
      API_BASE_URL="$API_BASE_URL" \
      REALTIME_BASE_URL="$REALTIME_BASE_URL" \
      DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" \
      DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS" \
      SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
      TARGET_LANGUAGE="$TARGET_LANGUAGE" \
      USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
      USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
      ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
      ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
      DEVICE_ASR_E2E_SECONDS="$DEVICE_ASR_E2E_SECONDS" \
      SERVER_OWNED_HISTORY="$SERVER_OWNED_HISTORY" \
      EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER" \
      EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER" \
      EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK" \
        "$ROOT_DIR/scripts/ios_nemotron_device_smoke.sh"
      ;;
    local_mvp)
      echo "== iOS Nemotron MVP smoke: local_mvp =="
      DEVICE_ID="$DEVICE_ID" \
      IOS_SMOKE_MODE=mvp \
      DEVICE_ASR_PREPARE_MODEL="$DEVICE_ASR_PREPARE_MODEL" \
      DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" \
      DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS" \
      SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
      TARGET_LANGUAGE="$TARGET_LANGUAGE" \
      USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
      USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
      ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
      ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
      DEVICE_ASR_SELF_TEST_SECONDS="$DEVICE_ASR_SELF_TEST_SECONDS" \
      DEVICE_ASR_E2E_SECONDS="$DEVICE_ASR_E2E_SECONDS" \
      SERVER_OWNED_HISTORY=false \
        "$ROOT_DIR/scripts/ios_nemotron_device_smoke.sh"
      ;;
    *)
      echo "Unknown IOS_MVP_SMOKE_STEPS entry: $step" >&2
      exit 2
      ;;
  esac
}

step_enabled() {
  local desired="$1"
  IFS=',' read -ra entries <<<"$IOS_MVP_SMOKE_STEPS"
  for raw_entry in "${entries[@]}"; do
    entry="$(echo "$raw_entry" | xargs)"
    if [[ "$entry" == "$desired" ]]; then
      return 0
    fi
  done
  return 1
}

normalized_steps() {
  local normalized=()
  IFS=',' read -ra entries <<<"$IOS_MVP_SMOKE_STEPS"
  for raw_entry in "${entries[@]}"; do
    entry="$(echo "$raw_entry" | xargs)"
    if [[ -n "$entry" ]]; then
      normalized+=("$entry")
    fi
  done
  local joined=""
  for entry in "${normalized[@]}"; do
    if [[ -n "$joined" ]]; then
      joined+=","
    fi
    joined+="$entry"
  done
  echo "$joined"
}

expected_ws_endpoint() {
  local endpoint="$REALTIME_BASE_URL"
  if [[ "$endpoint" == http://* ]]; then
    endpoint="ws://${endpoint#http://}"
  elif [[ "$endpoint" == https://* ]]; then
    endpoint="wss://${endpoint#https://}"
  else
    echo "REALTIME_BASE_URL must start with http:// or https://." >&2
    exit 2
  fi
  echo "${endpoint%/}/realtime"
}

prepare_e2e_service_urls() {
  if [[ -z "$API_BASE_URL" ]]; then
    LAN_IP="$(MAC_LAN_INTERFACE="${MAC_LAN_INTERFACE:-}" "$ROOT_DIR/scripts/detect_mac_lan_ip.mjs" 2>/dev/null || true)"
    if [[ -z "$LAN_IP" ]]; then
      echo "API_BASE_URL is required for e2e when no usable Mac LAN IPv4 address can be detected." >&2
      echo "Set API_BASE_URL manually, set MAC_LAN_IP for ios:nemotron:run, or set MAC_LAN_INTERFACE=en0/en1/..." >&2
      exit 2
    fi
    API_BASE_URL="http://$LAN_IP:3100"
  fi
  if [[ -z "$REALTIME_BASE_URL" ]]; then
    if [[ "$API_BASE_URL" =~ ^(https?://[^/:]+) ]]; then
      REALTIME_BASE_URL="${BASH_REMATCH[1]}:$REALTIME_PORT"
    else
      echo "REALTIME_BASE_URL is required when Gateway URL cannot be derived." >&2
      exit 2
    fi
  fi
  export API_BASE_URL REALTIME_BASE_URL
}

check_e2e_services() {
  if ! step_enabled e2e; then
    return
  fi
  prepare_e2e_service_urls
  expected_endpoint="$(expected_ws_endpoint)"
  echo "Prechecking API health at $API_BASE_URL/health"
  api_health_json="$(curl -fsS "$API_BASE_URL/health")"
  EXPECTED_REALTIME_WS_ENDPOINT="$expected_endpoint" node -e '
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(0, "utf8"));
const expected = process.env.EXPECTED_REALTIME_WS_ENDPOINT;
if (health.realtimeWsEndpoint !== expected) {
  console.error(`API realtimeWsEndpoint mismatch: ${health.realtimeWsEndpoint || "missing"}`);
  console.error(`Expected: ${expected}`);
  process.exit(2);
}
' <<<"$api_health_json"

  echo "Prechecking Realtime Gateway health at $REALTIME_BASE_URL/health"
  gateway_health_json="$(curl -fsS "$REALTIME_BASE_URL/health")"
  EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER" \
  EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER" \
  EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK" \
  SERVER_OWNED_HISTORY="$SERVER_OWNED_HISTORY" \
    node -e '
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(0, "utf8"));
const expectedProvider = process.env.EXPECTED_GATEWAY_PROVIDER;
const expectedAsrProvider = process.env.EXPECTED_GATEWAY_ASR_PROVIDER;
const expectedSessionEventSink = process.env.EXPECTED_GATEWAY_SESSION_EVENT_SINK;
if (health.provider !== expectedProvider) {
  console.error(`Realtime Gateway provider must be ${expectedProvider}. Actual: ${health.provider || "missing"}`);
  process.exit(2);
}
if (health.asrProvider !== expectedAsrProvider) {
  console.error(`Realtime Gateway ASR provider must be ${expectedAsrProvider}. Actual: ${health.asrProvider || "missing"}`);
  process.exit(2);
}
if (process.env.SERVER_OWNED_HISTORY === "true" && health.sessionEventSink !== expectedSessionEventSink) {
  console.error(`Realtime Gateway sessionEventSink must be ${expectedSessionEventSink}. Actual: ${health.sessionEventSink || "missing"}`);
  process.exit(2);
}
' <<<"$gateway_health_json"
}

validate_steps

"$ROOT_DIR/scripts/check_ios_runtime_permissions.mjs"

echo "Checking physical iPhone readiness"
DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" \
  --require-ready

check_e2e_services

if [[ "$(normalized_steps)" == "diagnostics,selftest,local_mvp" ]]; then
  echo "== iOS Nemotron MVP smoke: combined diagnostics,selftest,local_mvp =="
  DEVICE_ID="$DEVICE_ID" \
  IOS_SMOKE_MODE=mvp \
  API_BASE_URL="$API_BASE_URL" \
  REALTIME_BASE_URL="$REALTIME_BASE_URL" \
  DEVICE_ASR_PREPARE_MODEL="$DEVICE_ASR_PREPARE_MODEL" \
  DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" \
  DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS" \
  SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
  TARGET_LANGUAGE="$TARGET_LANGUAGE" \
  USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
  USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
  ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
  ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
  DEVICE_ASR_SELF_TEST_SECONDS="$DEVICE_ASR_SELF_TEST_SECONDS" \
  DEVICE_ASR_E2E_SECONDS="$DEVICE_ASR_E2E_SECONDS" \
  SERVER_OWNED_HISTORY=false \
    "$ROOT_DIR/scripts/ios_nemotron_device_smoke.sh"
  echo "iOS Nemotron MVP smoke completed."
  exit 0
fi

IFS=',' read -ra STEPS <<<"$IOS_MVP_SMOKE_STEPS"
for raw_step in "${STEPS[@]}"; do
  step="$(echo "$raw_step" | xargs)"
  if [[ -n "$step" ]]; then
    run_step "$step"
  fi
done

echo "iOS Nemotron MVP smoke completed."
