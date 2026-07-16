#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
FLUTTER_BIN="${FLUTTER_BIN:-/Users/xutianliang/development/flutter/bin/flutter}"
API_BASE_URL="${API_BASE_URL:-}"
REALTIME_BASE_URL="${REALTIME_BASE_URL:-}"
REALTIME_PORT="${REALTIME_PORT:-3201}"
DEVICE_ID="${DEVICE_ID:-}"
ALLOW_IOS_SIMULATOR="${ALLOW_IOS_SIMULATOR:-false}"
IOS_SMOKE_MODE="${IOS_SMOKE_MODE:-app}"
DEVICE_ASR_PREPARE_MODEL="${DEVICE_ASR_PREPARE_MODEL:-false}"
DEVICE_ASR_LANGUAGE="${DEVICE_ASR_LANGUAGE:-auto}"
DEVICE_ASR_PROVIDER="${DEVICE_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_DEVICE_ASR_PROVIDER}"
DEVICE_ASR_AUTO_DOWNLOAD_MODEL="${DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL}"
DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT="${DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT:-false}"
DEVICE_ASR_MODEL_CHUNK_MS="${DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS}"
DEVICE_ASR_CHUNK_DURATION_MS="${DEVICE_ASR_CHUNK_DURATION_MS:-320}"
DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS="${DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS:-600}"
DEVICE_ASR_ENDPOINT_SILENCE_MS="${DEVICE_ASR_ENDPOINT_SILENCE_MS:-900}"
DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS="${DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS:-0.006}"
DEVICE_ASR_VAD_PROVIDER="${DEVICE_ASR_VAD_PROVIDER:-fluidaudio_silero}"
DEVICE_ASR_VAD_THRESHOLD="${DEVICE_ASR_VAD_THRESHOLD:-0.6}"
DEVICE_ASR_VAD_NEGATIVE_THRESHOLD="${DEVICE_ASR_VAD_NEGATIVE_THRESHOLD:-0.35}"
DEVICE_ASR_VAD_PRE_ROLL_MS="${DEVICE_ASR_VAD_PRE_ROLL_MS:-800}"
DEVICE_ASR_DIAGNOSTIC_CAPTURE="${DEVICE_ASR_DIAGNOSTIC_CAPTURE:-false}"
SOURCE_LANGUAGE="${SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE}"
TARGET_LANGUAGE="${TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE}"
USE_LOCAL_SESSIONS="${USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS}"
USE_ON_DEVICE_TRANSLATION="${USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION}"
ON_DEVICE_TRANSLATION_PROVIDER="${ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER}"
ON_DEVICE_TRANSLATION_REQUIRED="${ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED}"
DEVICE_ASR_SELF_TEST_SECONDS="${DEVICE_ASR_SELF_TEST_SECONDS:-15}"
DEVICE_ASR_EXPECT_SEGMENT="${DEVICE_ASR_EXPECT_SEGMENT:-true}"
DEVICE_ASR_LOG_TEXT="${DEVICE_ASR_LOG_TEXT:-false}"
DEVICE_ASR_E2E_SECONDS="${DEVICE_ASR_E2E_SECONDS:-30}"
DEVICE_ASR_EXPECT_TRANSLATION="${DEVICE_ASR_EXPECT_TRANSLATION:-true}"
EXPECTED_GATEWAY_PROVIDER="${EXPECTED_GATEWAY_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER}"
EXPECTED_GATEWAY_ASR_PROVIDER="${EXPECTED_GATEWAY_ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER}"
EXPECTED_GATEWAY_SESSION_EVENT_SINK="${EXPECTED_GATEWAY_SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK}"
IOS_SMOKE_DIAGNOSTICS_TIMEOUT_SECONDS="${IOS_SMOKE_DIAGNOSTICS_TIMEOUT_SECONDS:-240}"
IOS_SMOKE_SELFTEST_TIMEOUT_SECONDS="${IOS_SMOKE_SELFTEST_TIMEOUT_SECONDS:-$((DEVICE_ASR_SELF_TEST_SECONDS + 240))}"
IOS_SMOKE_E2E_TIMEOUT_SECONDS="${IOS_SMOKE_E2E_TIMEOUT_SECONDS:-$((DEVICE_ASR_E2E_SECONDS + 300))}"
IOS_SMOKE_MVP_TIMEOUT_SECONDS="${IOS_SMOKE_MVP_TIMEOUT_SECONDS:-$((DEVICE_ASR_SELF_TEST_SECONDS + DEVICE_ASR_E2E_SECONDS + 720))}"
SERVER_OWNED_HISTORY="${SERVER_OWNED_HISTORY:-true}"
IOS_APP_BUNDLE_ID="${IOS_APP_BUNDLE_ID:-com.example.translationMobile}"

usage() {
  cat <<'USAGE'
Usage:
  DEVICE_ID="Wha的iPhone" API_BASE_URL=http://MAC_LAN_IP:3100 \
    scripts/ios_nemotron_device_smoke.sh
Environment:
  DEVICE_ID                 Flutter device name/id. Optional if only one iPhone is visible.
  IOS_SMOKE_MODE            app/diagnostics/selftest/e2e/mvp. Default: app.
  API_BASE_URL, REALTIME_BASE_URL, MAC_LAN_INTERFACE
  SOURCE_LANGUAGE, TARGET_LANGUAGE
  USE_LOCAL_SESSIONS
  USE_ON_DEVICE_TRANSLATION, ON_DEVICE_TRANSLATION_PROVIDER, ON_DEVICE_TRANSLATION_REQUIRED
  DEVICE_ASR_LANGUAGE       auto, en-US, zh-CN, turn. Default: auto.
  DEVICE_ASR_PROVIDER, DEVICE_ASR_AUTO_DOWNLOAD_MODEL, DEVICE_ASR_MODEL_CHUNK_MS
  DEVICE_ASR_* endpoint/VAD tuning and optional diagnostic capture
  DEVICE_ASR_SELF_TEST_SECONDS, DEVICE_ASR_E2E_SECONDS
  SERVER_OWNED_HISTORY, ALLOW_IOS_SIMULATOR
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$IOS_SMOKE_MODE" != "app" && "$IOS_SMOKE_MODE" != "diagnostics" && "$IOS_SMOKE_MODE" != "selftest" && "$IOS_SMOKE_MODE" != "e2e" && "$IOS_SMOKE_MODE" != "mvp" ]]; then
  echo "IOS_SMOKE_MODE must be app, diagnostics, selftest, e2e, or mvp." >&2
  exit 1
fi
run_with_timeout() {
  local seconds="$1"
  shift
  local marker="${TMPDIR:-/tmp}/ios-smoke-timeout-$$-$RANDOM"
  "$@" &
  local command_pid=$!
  (
    sleep "$seconds"
    if kill -0 "$command_pid" >/dev/null 2>&1; then
      : >"$marker"
      kill "$command_pid" >/dev/null 2>&1 || true
    fi
  ) &
  local watchdog_pid=$!
  set +e
  wait "$command_pid"
  local status=$?
  set -e
  kill "$watchdog_pid" >/dev/null 2>&1 || true
  wait "$watchdog_pid" 2>/dev/null || true
  if [[ -f "$marker" ]]; then
    rm -f "$marker"
    echo "Command timed out after ${seconds}s: $*" >&2
    return 124
  fi
  rm -f "$marker"
  return "$status"
}

terminate_existing_simulator_app() {
  if [[ "$ALLOW_IOS_SIMULATOR" != "true" ]]; then
    return
  fi
  echo "Terminating existing simulator app if present"
  run_with_timeout 15 xcrun simctl terminate \
    "$SELECTED_DEVICE_ID" "$IOS_APP_BUNDLE_ID" >/dev/null 2>&1 || true
}

require_ready_real_device() {
  if [[ "$ALLOW_IOS_SIMULATOR" == "true" ]]; then
    return
  fi
  echo "Checking physical iPhone readiness"
  DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" \
    --require-ready
}

NEEDS_MODEL_PREFLIGHT=false
if [[ "$DEVICE_ASR_AUTO_DOWNLOAD_MODEL" != "true" && "$DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT" != "true" ]]; then
  if [[ "$IOS_SMOKE_MODE" == "app" || "$IOS_SMOKE_MODE" == "selftest" || "$IOS_SMOKE_MODE" == "e2e" || "$IOS_SMOKE_MODE" == "mvp" ]]; then
    NEEDS_MODEL_PREFLIGHT=true
  elif [[ "$IOS_SMOKE_MODE" == "diagnostics" && "$DEVICE_ASR_PREPARE_MODEL" == "true" ]]; then
    NEEDS_MODEL_PREFLIGHT=true
  fi
fi

if [[ "$NEEDS_MODEL_PREFLIGHT" == "true" ]]; then
  echo "Checking staged iOS Nemotron model because DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false"
  if ! (cd "$ROOT_DIR" && scripts/validate_ios_nemotron_bundle.mjs); then
    cat >&2 <<'MODEL_PREFLIGHT'
No FluidAudio-ready Nemotron CoreML bundle is staged under apps/mobile/ios/Runner/Models.
Either:
  1. Stage a model before running the iPhone smoke:
       scripts/stage_ios_nemotron_bundle.mjs /path/to/.../multilingual/2240ms --family multilingual --tier 2240ms
  2. Enable runtime download:
       DEVICE_ASR_AUTO_DOWNLOAD_MODEL=true
  3. Skip this Mac-side check only when the model is already available in the iPhone Documents model cache:
       DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT=true
MODEL_PREFLIGHT
    exit 1
  fi
fi

if [[ "$IOS_SMOKE_MODE" == "app" || "$IOS_SMOKE_MODE" == "selftest" || "$IOS_SMOKE_MODE" == "e2e" || "$IOS_SMOKE_MODE" == "mvp" ]]; then
  "$ROOT_DIR/scripts/check_ios_runtime_permissions.mjs"
fi

require_ready_real_device

echo "Checking Flutter devices"
DEVICES_JSON="$("$FLUTTER_BIN" --no-version-check devices --machine)"
SELECTED_DEVICE_ID="$(DEVICE_ID="$DEVICE_ID" ALLOW_IOS_SIMULATOR="$ALLOW_IOS_SIMULATOR" \
  "$ROOT_DIR/scripts/select_flutter_ios_device.mjs" <<<"$DEVICES_JSON")" || {
  echo "Available Flutter devices:" >&2
  "$FLUTTER_BIN" --no-version-check devices >&2
  DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" >&2 || true
  exit 1
}

echo "Selected iOS device: $SELECTED_DEVICE_ID"

DEVICE_ARGS=(-d "$SELECTED_DEVICE_ID")
terminate_existing_simulator_app

if [[ "$IOS_SMOKE_MODE" == "e2e" ]]; then
  if [[ -z "$API_BASE_URL" ]]; then
    LAN_IP="$(MAC_LAN_INTERFACE="${MAC_LAN_INTERFACE:-}" "$ROOT_DIR/scripts/detect_mac_lan_ip.mjs" 2>/dev/null || true)"
    if [[ -z "$LAN_IP" ]]; then
      echo "API_BASE_URL is required when no usable Mac LAN IPv4 address can be detected." >&2
      echo "Set API_BASE_URL manually or set MAC_LAN_INTERFACE=en0/en1/..." >&2
      exit 1
    fi
    API_BASE_URL="http://$LAN_IP:3100"
  fi

  if [[ -z "$REALTIME_BASE_URL" ]]; then
    if [[ "$API_BASE_URL" =~ ^(https?://[^/:]+) ]]; then
      REALTIME_BASE_URL="${BASH_REMATCH[1]}:$REALTIME_PORT"
    else
      echo "REALTIME_BASE_URL is required when Gateway URL cannot be derived." >&2
      exit 1
    fi
  fi

  EXPECTED_REALTIME_WS_ENDPOINT="$REALTIME_BASE_URL"
  if [[ "$EXPECTED_REALTIME_WS_ENDPOINT" == http://* ]]; then
    EXPECTED_REALTIME_WS_ENDPOINT="ws://${EXPECTED_REALTIME_WS_ENDPOINT#http://}"
  elif [[ "$EXPECTED_REALTIME_WS_ENDPOINT" == https://* ]]; then
    EXPECTED_REALTIME_WS_ENDPOINT="wss://${EXPECTED_REALTIME_WS_ENDPOINT#https://}"
  else
    echo "REALTIME_BASE_URL must start with http:// or https://." >&2
    exit 1
  fi
  EXPECTED_REALTIME_WS_ENDPOINT="${EXPECTED_REALTIME_WS_ENDPOINT%/}/realtime"

  echo "Checking API health at $API_BASE_URL/health"
  API_HEALTH_JSON="$(curl -fsS "$API_BASE_URL/health")"
  EXPECTED_REALTIME_WS_ENDPOINT="$EXPECTED_REALTIME_WS_ENDPOINT" \
    ALLOW_IOS_SIMULATOR="$ALLOW_IOS_SIMULATOR" node -e '
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(0, "utf8"));
const actualValue = health.realtimeWsEndpoint;
const expectedValue = process.env.EXPECTED_REALTIME_WS_ENDPOINT;
const allowSimulator = process.env.ALLOW_IOS_SIMULATOR === "true";
if (typeof actualValue !== "string" || actualValue.length === 0) {
  console.error("API /health did not expose realtimeWsEndpoint.");
  console.error("Restart the API server from the latest code and set REALTIME_WS_ENDPOINT.");
  process.exit(2);
}
const actual = new URL(actualValue);
const expected = new URL(expectedValue);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!allowSimulator && loopbackHosts.has(actual.hostname)) {
  console.error(`API realtimeWsEndpoint is loopback-only: ${actualValue}`);
  console.error(`For a real iPhone, start API with REALTIME_WS_ENDPOINT=${expectedValue}`);
  process.exit(2);
}
const sameEndpoint = actual.protocol === expected.protocol &&
  actual.hostname === expected.hostname &&
  actual.port === expected.port &&
  actual.pathname === expected.pathname;
if (!sameEndpoint) {
  console.error(`API realtimeWsEndpoint mismatch: ${actualValue}`);
  console.error(`Expected: ${expectedValue}`);
  console.error("Start/restart the API server with REALTIME_WS_ENDPOINT set to the Mac LAN Gateway URL.");
  process.exit(2);
}
' <<<"$API_HEALTH_JSON"

  echo "Checking Realtime Gateway health at $REALTIME_BASE_URL/health"
  GATEWAY_HEALTH_JSON="$(curl -fsS "$REALTIME_BASE_URL/health")"
  if [[ "$IOS_SMOKE_MODE" == "e2e" || "$IOS_SMOKE_MODE" == "mvp" ]]; then
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
  console.error("Restart Gateway with SESSION_EVENT_SINK and API_BASE_URL pointing at the API server.");
  process.exit(2);
}
' <<<"$GATEWAY_HEALTH_JSON"
  fi
fi

cd "$MOBILE_DIR"
DEVICE_ASR_DART_DEFINES=(
  --dart-define=DEVICE_ASR_LANGUAGE="$DEVICE_ASR_LANGUAGE"
  --dart-define=DEVICE_ASR_AUTO_DOWNLOAD_MODEL="$DEVICE_ASR_AUTO_DOWNLOAD_MODEL"
  --dart-define=DEVICE_ASR_MODEL_CHUNK_MS="$DEVICE_ASR_MODEL_CHUNK_MS"
  --dart-define=DEVICE_ASR_CHUNK_DURATION_MS="$DEVICE_ASR_CHUNK_DURATION_MS"
  --dart-define=DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS="$DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS"
  --dart-define=DEVICE_ASR_ENDPOINT_SILENCE_MS="$DEVICE_ASR_ENDPOINT_SILENCE_MS"
  --dart-define=DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS="$DEVICE_ASR_ENDPOINT_SPEECH_THRESHOLD_RMS"
  --dart-define=DEVICE_ASR_VAD_PROVIDER="$DEVICE_ASR_VAD_PROVIDER"
  --dart-define=DEVICE_ASR_VAD_THRESHOLD="$DEVICE_ASR_VAD_THRESHOLD"
  --dart-define=DEVICE_ASR_VAD_NEGATIVE_THRESHOLD="$DEVICE_ASR_VAD_NEGATIVE_THRESHOLD"
  --dart-define=DEVICE_ASR_VAD_PRE_ROLL_MS="$DEVICE_ASR_VAD_PRE_ROLL_MS"
  --dart-define=DEVICE_ASR_DIAGNOSTIC_CAPTURE="$DEVICE_ASR_DIAGNOSTIC_CAPTURE"
)
if [[ "$IOS_SMOKE_MODE" == "mvp" ]]; then
  echo "Running combined iOS Nemotron local MVP diagnostics, self-test, translation, and history"
  echo "Speak: hello, this is a realtime translation test. Then pause."
  run_with_timeout "$IOS_SMOKE_MVP_TIMEOUT_SECONDS" \
    "$FLUTTER_BIN" --no-version-check test \
    integration_test/core_ml_nemotron_mvp_test.dart \
    "${DEVICE_ARGS[@]}" \
    --dart-define=API_BASE_URL="$API_BASE_URL" \
    --dart-define=USE_DEVICE_ASR=true \
    --dart-define=DEVICE_ASR_PROVIDER="$DEVICE_ASR_PROVIDER" \
    --dart-define=SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
    --dart-define=TARGET_LANGUAGE="$TARGET_LANGUAGE" \
    --dart-define=USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
    --dart-define=USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
    --dart-define=ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
    --dart-define=ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
    "${DEVICE_ASR_DART_DEFINES[@]}" \
    --dart-define=DEVICE_ASR_PREPARE_MODEL="$DEVICE_ASR_PREPARE_MODEL" \
    --dart-define=DEVICE_ASR_SELF_TEST_SECONDS="$DEVICE_ASR_SELF_TEST_SECONDS" \
    --dart-define=DEVICE_ASR_EXPECT_SEGMENT="$DEVICE_ASR_EXPECT_SEGMENT" \
    --dart-define=DEVICE_ASR_LOG_TEXT="$DEVICE_ASR_LOG_TEXT" \
    --dart-define=DEVICE_ASR_LOCAL_MVP_SECONDS="$DEVICE_ASR_E2E_SECONDS" \
    --dart-define=DEVICE_ASR_EXPECT_TRANSLATION="$DEVICE_ASR_EXPECT_TRANSLATION" \
    --dart-define=SERVER_OWNED_HISTORY=false
elif [[ "$IOS_SMOKE_MODE" == "diagnostics" ]]; then
  echo "Running iOS Nemotron ASR diagnostics"
  run_with_timeout "$IOS_SMOKE_DIAGNOSTICS_TIMEOUT_SECONDS" \
    "$FLUTTER_BIN" --no-version-check test integration_test/core_ml_nemotron_diagnostics_test.dart \
    "${DEVICE_ARGS[@]}" \
    "${DEVICE_ASR_DART_DEFINES[@]}" \
    --dart-define=DEVICE_ASR_PREPARE_MODEL="$DEVICE_ASR_PREPARE_MODEL"
elif [[ "$IOS_SMOKE_MODE" == "selftest" ]]; then
  echo "Running iOS Nemotron ASR microphone self-test"
  echo "Speak a short Chinese or English sentence into the iPhone microphone."
  run_with_timeout "$IOS_SMOKE_SELFTEST_TIMEOUT_SECONDS" \
    "$FLUTTER_BIN" --no-version-check test integration_test/core_ml_nemotron_self_test.dart \
    "${DEVICE_ARGS[@]}" \
    "${DEVICE_ASR_DART_DEFINES[@]}" \
    --dart-define=DEVICE_ASR_SELF_TEST_SECONDS="$DEVICE_ASR_SELF_TEST_SECONDS" \
    --dart-define=DEVICE_ASR_EXPECT_SEGMENT="$DEVICE_ASR_EXPECT_SEGMENT" \
    --dart-define=DEVICE_ASR_LOG_TEXT="$DEVICE_ASR_LOG_TEXT"
elif [[ "$IOS_SMOKE_MODE" == "e2e" ]]; then
  echo "Running iOS Nemotron ASR Gateway E2E test"
  echo "Speak a short Chinese or English sentence into the iPhone microphone, then pause."
  run_with_timeout "$IOS_SMOKE_E2E_TIMEOUT_SECONDS" \
    "$FLUTTER_BIN" --no-version-check test integration_test/core_ml_nemotron_gateway_e2e_test.dart \
    "${DEVICE_ARGS[@]}" \
    --dart-define=API_BASE_URL="$API_BASE_URL" \
    --dart-define=USE_DEVICE_ASR=true \
    --dart-define=DEVICE_ASR_PROVIDER="$DEVICE_ASR_PROVIDER" \
    --dart-define=SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
    --dart-define=TARGET_LANGUAGE="$TARGET_LANGUAGE" \
    --dart-define=USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
    --dart-define=USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
    --dart-define=ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
    --dart-define=ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
    "${DEVICE_ASR_DART_DEFINES[@]}" \
    --dart-define=DEVICE_ASR_E2E_SECONDS="$DEVICE_ASR_E2E_SECONDS" \
    --dart-define=DEVICE_ASR_EXPECT_TRANSLATION="$DEVICE_ASR_EXPECT_TRANSLATION" \
    --dart-define=SERVER_OWNED_HISTORY="$SERVER_OWNED_HISTORY" \
    --dart-define=EXPECTED_GATEWAY_PROVIDER="$EXPECTED_GATEWAY_PROVIDER" \
    --dart-define=EXPECTED_GATEWAY_ASR_PROVIDER="$EXPECTED_GATEWAY_ASR_PROVIDER" \
    --dart-define=EXPECTED_GATEWAY_SESSION_EVENT_SINK="$EXPECTED_GATEWAY_SESSION_EVENT_SINK"
else
  echo "Launching iOS Nemotron ASR smoke app"
  "$FLUTTER_BIN" --no-version-check run "${DEVICE_ARGS[@]}" \
    --dart-define=API_BASE_URL="$API_BASE_URL" \
    --dart-define=USE_DEVICE_ASR=true \
    --dart-define=DEVICE_ASR_PROVIDER="$DEVICE_ASR_PROVIDER" \
    --dart-define=SOURCE_LANGUAGE="$SOURCE_LANGUAGE" \
    --dart-define=TARGET_LANGUAGE="$TARGET_LANGUAGE" \
    --dart-define=USE_LOCAL_SESSIONS="$USE_LOCAL_SESSIONS" \
    --dart-define=USE_ON_DEVICE_TRANSLATION="$USE_ON_DEVICE_TRANSLATION" \
    --dart-define=ON_DEVICE_TRANSLATION_PROVIDER="$ON_DEVICE_TRANSLATION_PROVIDER" \
    --dart-define=ON_DEVICE_TRANSLATION_REQUIRED="$ON_DEVICE_TRANSLATION_REQUIRED" \
    "${DEVICE_ASR_DART_DEFINES[@]}"
fi
