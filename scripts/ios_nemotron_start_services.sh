#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
API_PORT="${API_PORT:-3100}"
ACTIVE_PLAN_CODE="${ACTIVE_PLAN_CODE:-${SUBSCRIPTION_PLAN_CODE:-free}}"
REALTIME_PORT="${REALTIME_PORT:-3201}"
REALTIME_TOKEN_SECRET="${REALTIME_TOKEN_SECRET:-test-secret}"
MODEL_ROUTING_FILE="${MODEL_ROUTING_FILE:-}"
MODEL_ROUTING_PROFILE="${MODEL_ROUTING_PROFILE:-}"

capture_explicit_env() {
  local name="$1"
  if [[ "${!name+x}" == "x" ]]; then
    printf -v "USER_${name}_SET" "%s" "1"
    printf -v "USER_${name}" "%s" "${!name}"
  else
    printf -v "USER_${name}_SET" "%s" "0"
  fi
}

restore_explicit_env() {
  local name="$1"
  local set_name="USER_${name}_SET"
  local value_name="USER_${name}"
  if [[ "${!set_name}" == "1" ]]; then
    printf -v "$name" "%s" "${!value_name}"
  fi
}

for name in \
  REALTIME_PROVIDER \
  SESSION_EVENT_SINK \
  ASR_PROVIDER \
  ASR_HTTP_ENDPOINT \
  ASR_HTTP_FLUSH_ENDPOINT \
  ASR_HTTP_API_KEY \
  TRANSLATION_BASE_URL \
  TRANSLATION_MODEL \
  LMSTUDIO_BASE_URL \
  LMSTUDIO_MODEL; do
  capture_explicit_env "$name"
done

if [[ -n "$MODEL_ROUTING_FILE" || -n "$MODEL_ROUTING_PROFILE" ]]; then
  eval "$(MODEL_ROUTING_FILE="$MODEL_ROUTING_FILE" \
    MODEL_ROUTING_PROFILE="$MODEL_ROUTING_PROFILE" \
      node "$ROOT_DIR/scripts/render_model_routing_env.mjs" --group gateway)"
fi

for name in \
  REALTIME_PROVIDER \
  SESSION_EVENT_SINK \
  ASR_PROVIDER \
  ASR_HTTP_ENDPOINT \
  ASR_HTTP_FLUSH_ENDPOINT \
  ASR_HTTP_API_KEY \
  TRANSLATION_BASE_URL \
  TRANSLATION_MODEL \
  LMSTUDIO_BASE_URL \
  LMSTUDIO_MODEL; do
  restore_explicit_env "$name"
done

REALTIME_PROVIDER="${REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER}"
SESSION_EVENT_SINK="${SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK}"
ASR_PROVIDER="${ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER}"
LMSTUDIO_BASE_URL="${LMSTUDIO_BASE_URL:-${TRANSLATION_BASE_URL:-http://222.128.62.139:1234/v1}}"
LMSTUDIO_MODEL="${LMSTUDIO_MODEL:-${TRANSLATION_MODEL:-qwen/qwen3.5-9b}}"
LMSTUDIO_TIMEOUT_MS="${LMSTUDIO_TIMEOUT_MS:-60000}"
LMSTUDIO_MAX_TOKENS="${LMSTUDIO_MAX_TOKENS:-512}"
ASR_HTTP_ENDPOINT="${ASR_HTTP_ENDPOINT:-}"
ASR_HTTP_FLUSH_ENDPOINT="${ASR_HTTP_FLUSH_ENDPOINT:-}"
ASR_HTTP_API_KEY="${ASR_HTTP_API_KEY:-}"
ASR_HTTP_HEALTH_URL="${ASR_HTTP_HEALTH_URL:-}"
ASR_HTTP_TIMEOUT_MS="${ASR_HTTP_TIMEOUT_MS:-120000}"
IOS_NEMOTRON_CHECK_LMSTUDIO="${IOS_NEMOTRON_CHECK_LMSTUDIO:-true}"
MAC_LAN_IP="${MAC_LAN_IP:-}"
IOS_NEMOTRON_SERVICES_EXIT_AFTER_HEALTH="${IOS_NEMOTRON_SERVICES_EXIT_AFTER_HEALTH:-false}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cache/ios-nemotron-services}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/ios_nemotron_start_services.sh

Starts the local API Server and Realtime Gateway for physical iPhone
CoreML/Nemotron e2e. The script keeps both services in the foreground until
Ctrl-C. It detects the Mac LAN IP unless MAC_LAN_IP is set.

Common environment:
  MAC_LAN_IP              Override the Mac LAN IP used by the iPhone.
  MAC_LAN_INTERFACE       Optional interface preference for LAN IP detection.
  API_PORT                Default 3100.
  ACTIVE_PLAN_CODE        free/pro/premium. Default free.
  REALTIME_PORT           Default 3201.
  REALTIME_PROVIDER       Default lmstudio from runtime contract.
  MODEL_ROUTING_FILE      Optional model routing config path.
  MODEL_ROUTING_PROFILE   Optional profile, for example domestic_server_qwen3_hymt2_voxcpm2.
  LMSTUDIO_BASE_URL       Default http://222.128.62.139:1234/v1.
  LMSTUDIO_MODEL          Default qwen/qwen3.5-9b.
  SESSION_EVENT_SINK      Default api from runtime contract.
  ASR_PROVIDER            Default mock from runtime contract because iOS
                          Nemotron sends text segments.
  IOS_NEMOTRON_CHECK_LMSTUDIO
                          true checks LM Studio translation before smoke.
  IOS_NEMOTRON_SERVICES_EXIT_AFTER_HEALTH
                          true exits after health checks, for CI/smoke.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$MAC_LAN_IP" ]]; then
  MAC_LAN_IP="$(MAC_LAN_INTERFACE="${MAC_LAN_INTERFACE:-}" "$ROOT_DIR/scripts/detect_mac_lan_ip.mjs" 2>/dev/null || true)"
fi
if [[ -z "$MAC_LAN_IP" ]]; then
  echo "MAC_LAN_IP is required when no usable Mac LAN IPv4 address can be detected." >&2
  echo "Set MAC_LAN_IP manually or set MAC_LAN_INTERFACE=en0/en1/..." >&2
  exit 2
fi

API_BASE_URL_LOCAL="http://127.0.0.1:$API_PORT"
API_BASE_URL_IPHONE="http://$MAC_LAN_IP:$API_PORT"
REALTIME_BASE_URL_IPHONE="http://$MAC_LAN_IP:$REALTIME_PORT"
REALTIME_WS_ENDPOINT="ws://$MAC_LAN_IP:$REALTIME_PORT/realtime"

mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api-server.log"
GATEWAY_LOG="$LOG_DIR/realtime-gateway.log"
LMSTUDIO_PROVIDER_JSON="$LOG_DIR/lmstudio-provider.json"
API_PID=""
GATEWAY_PID=""

cleanup() {
  local status=$?
  if [[ -n "$GATEWAY_PID" ]]; then
    kill "$GATEWAY_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
  wait "$GATEWAY_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

start_api() {
  : >"$API_LOG"
  API_PORT="$API_PORT" \
  ACTIVE_PLAN_CODE="$ACTIVE_PLAN_CODE" \
  REALTIME_TOKEN_SECRET="$REALTIME_TOKEN_SECRET" \
  REALTIME_WS_ENDPOINT="$REALTIME_WS_ENDPOINT" \
    npm run dev -w @translation/api-server >"$API_LOG" 2>&1 &
  API_PID=$!
}

start_gateway() {
  : >"$GATEWAY_LOG"
  REALTIME_PORT="$REALTIME_PORT" \
  REALTIME_TOKEN_SECRET="$REALTIME_TOKEN_SECRET" \
  MODEL_ROUTING_FILE="$MODEL_ROUTING_FILE" \
  MODEL_ROUTING_PROFILE="$MODEL_ROUTING_PROFILE" \
  REALTIME_PROVIDER="$REALTIME_PROVIDER" \
  SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
  API_BASE_URL="$API_BASE_URL_LOCAL" \
  LMSTUDIO_BASE_URL="$LMSTUDIO_BASE_URL" \
  LMSTUDIO_MODEL="$LMSTUDIO_MODEL" \
  LMSTUDIO_TIMEOUT_MS="$LMSTUDIO_TIMEOUT_MS" \
  LMSTUDIO_MAX_TOKENS="$LMSTUDIO_MAX_TOKENS" \
  ASR_PROVIDER="$ASR_PROVIDER" \
  ASR_HTTP_ENDPOINT="$ASR_HTTP_ENDPOINT" \
  ASR_HTTP_FLUSH_ENDPOINT="$ASR_HTTP_FLUSH_ENDPOINT" \
  ASR_HTTP_API_KEY="$ASR_HTTP_API_KEY" \
  ASR_HTTP_HEALTH_URL="$ASR_HTTP_HEALTH_URL" \
  ASR_HTTP_TIMEOUT_MS="$ASR_HTTP_TIMEOUT_MS" \
    npm run dev -w @translation/realtime-gateway >"$GATEWAY_LOG" 2>&1 &
  GATEWAY_PID=$!
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local log_file="$3"
  for _ in {1..40}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return
    fi
    if ! kill -0 "${4}" >/dev/null 2>&1; then
      echo "$label exited before health was ready. Log: $log_file" >&2
      sed -n '1,120p' "$log_file" >&2
      exit 1
    fi
    sleep 0.25
  done
  echo "$label did not become healthy at $url. Log: $log_file" >&2
  sed -n '1,120p' "$log_file" >&2
  exit 1
}

assert_api_endpoint() {
  local body
  body="$(curl -fsS "$API_BASE_URL_IPHONE/health")"
  EXPECTED_REALTIME_WS_ENDPOINT="$REALTIME_WS_ENDPOINT" node -e '
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(0, "utf8"));
if (health.realtimeWsEndpoint !== process.env.EXPECTED_REALTIME_WS_ENDPOINT) {
  console.error(`API realtimeWsEndpoint mismatch: ${health.realtimeWsEndpoint || "missing"}`);
  console.error(`Expected: ${process.env.EXPECTED_REALTIME_WS_ENDPOINT}`);
  process.exit(1);
}
' <<<"$body"
}

assert_gateway_runtime() {
  local body
  body="$(curl -fsS "$REALTIME_BASE_URL_IPHONE/health")"
  EXPECTED_REALTIME_PROVIDER="$REALTIME_PROVIDER" \
  EXPECTED_ASR_PROVIDER="$ASR_PROVIDER" \
  EXPECTED_SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
    node -e '
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(0, "utf8"));
const expected = {
  provider: process.env.EXPECTED_REALTIME_PROVIDER,
  asrProvider: process.env.EXPECTED_ASR_PROVIDER,
  sessionEventSink: process.env.EXPECTED_SESSION_EVENT_SINK,
};
for (const [field, value] of Object.entries(expected)) {
  if (health[field] !== value) {
    console.error(`Gateway ${field} mismatch: ${health[field] || "missing"}`);
    console.error(`Expected: ${value}`);
    process.exit(1);
  }
}
' <<<"$body"
}

start_api
start_gateway
wait_for_url "API Server" "$API_BASE_URL_IPHONE/health" "$API_LOG" "$API_PID"
wait_for_url "Realtime Gateway" "$REALTIME_BASE_URL_IPHONE/health" "$GATEWAY_LOG" "$GATEWAY_PID"
assert_api_endpoint
assert_gateway_runtime

if [[ "$REALTIME_PROVIDER" == "lmstudio" && "$IOS_NEMOTRON_CHECK_LMSTUDIO" == "true" ]]; then
  lmstudio_tmp="$LMSTUDIO_PROVIDER_JSON.tmp"
  if LMSTUDIO_BASE_URL="$LMSTUDIO_BASE_URL" \
    LMSTUDIO_MODEL="$LMSTUDIO_MODEL" \
    LMSTUDIO_TIMEOUT_MS="$LMSTUDIO_TIMEOUT_MS" \
    LMSTUDIO_MAX_TOKENS="$LMSTUDIO_MAX_TOKENS" \
    LMSTUDIO_API_KEY="${LMSTUDIO_API_KEY:-}" \
      "$ROOT_DIR/scripts/check_lmstudio_translation_provider.mjs" --json >"$lmstudio_tmp"; then
    mv "$lmstudio_tmp" "$LMSTUDIO_PROVIDER_JSON"
    cat "$LMSTUDIO_PROVIDER_JSON"
  else
    check_status=$?
    mv "$lmstudio_tmp" "$LMSTUDIO_PROVIDER_JSON" 2>/dev/null || true
    cat "$LMSTUDIO_PROVIDER_JSON" >&2 2>/dev/null || true
    exit "$check_status"
  fi
fi

cat <<READY
iOS Nemotron services are ready.
  API_BASE_URL=$API_BASE_URL_IPHONE
  ACTIVE_PLAN_CODE=$ACTIVE_PLAN_CODE
  REALTIME_BASE_URL=$REALTIME_BASE_URL_IPHONE
  REALTIME_WS_ENDPOINT=$REALTIME_WS_ENDPOINT
  API log: $API_LOG
  Gateway log: $GATEWAY_LOG
  LM Studio provider evidence: $LMSTUDIO_PROVIDER_JSON

In another terminal:
  DEVICE_ID="Wha的iPhone" API_BASE_URL=$API_BASE_URL_IPHONE REALTIME_BASE_URL=$REALTIME_BASE_URL_IPHONE scripts/ios_nemotron_mvp_status.mjs
  DEVICE_ID="Wha的iPhone" API_BASE_URL=$API_BASE_URL_IPHONE REALTIME_BASE_URL=$REALTIME_BASE_URL_IPHONE scripts/ios_nemotron_mvp_smoke.sh
READY

if [[ "$IOS_NEMOTRON_SERVICES_EXIT_AFTER_HEALTH" == "true" ]]; then
  exit 0
fi

wait "$API_PID" "$GATEWAY_PID"
