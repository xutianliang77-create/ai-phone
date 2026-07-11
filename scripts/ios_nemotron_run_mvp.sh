#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_CONTRACT_ENV="$(node "$ROOT_DIR/scripts/ios_nemotron_runtime_contract_env.mjs")"
eval "$RUNTIME_CONTRACT_ENV"
DEVICE_ID="${DEVICE_ID:-}"
API_PORT="${API_PORT:-3100}"
ACTIVE_PLAN_CODE="${ACTIVE_PLAN_CODE:-${SUBSCRIPTION_PLAN_CODE:-free}}"
REALTIME_PORT="${REALTIME_PORT:-3201}"
MAC_LAN_IP="${MAC_LAN_IP:-}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cache/ios-nemotron-services}"
IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS="${IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS:-false}"
IOS_NEMOTRON_RUN_SKIP_PREFLIGHT="${IOS_NEMOTRON_RUN_SKIP_PREFLIGHT:-}"
IOS_NEMOTRON_RUN_SKIP_SMOKE="${IOS_NEMOTRON_RUN_SKIP_SMOKE:-false}"
IOS_NEMOTRON_RUN_START_SERVICES="${IOS_NEMOTRON_RUN_START_SERVICES:-}"
IOS_NEMOTRON_RUN_REPORT_ON_EXIT="${IOS_NEMOTRON_RUN_REPORT_ON_EXIT:-true}"
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD="${IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD:-}"
IOS_NEMOTRON_RUN_REPAIR_PROVISIONING="${IOS_NEMOTRON_RUN_REPAIR_PROVISIONING:-}"
DEVICE_ASR_AUTO_DOWNLOAD_MODEL="${DEVICE_ASR_AUTO_DOWNLOAD_MODEL:-$IOS_NEMOTRON_CONTRACT_AUTO_DOWNLOAD_MODEL}"
DEVICE_ASR_MODEL_CHUNK_MS="${DEVICE_ASR_MODEL_CHUNK_MS:-$IOS_NEMOTRON_CONTRACT_MODEL_CHUNK_MS}"
SOURCE_LANGUAGE="${SOURCE_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_SOURCE_LANGUAGE}"
TARGET_LANGUAGE="${TARGET_LANGUAGE:-$IOS_NEMOTRON_CONTRACT_TARGET_LANGUAGE}"
USE_LOCAL_SESSIONS="${USE_LOCAL_SESSIONS:-$IOS_NEMOTRON_CONTRACT_USE_LOCAL_SESSIONS}"
USE_ON_DEVICE_TRANSLATION="${USE_ON_DEVICE_TRANSLATION:-$IOS_NEMOTRON_CONTRACT_USE_ON_DEVICE_TRANSLATION}"
ON_DEVICE_TRANSLATION_PROVIDER="${ON_DEVICE_TRANSLATION_PROVIDER:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_PROVIDER}"
ON_DEVICE_TRANSLATION_REQUIRED="${ON_DEVICE_TRANSLATION_REQUIRED:-$IOS_NEMOTRON_CONTRACT_ON_DEVICE_TRANSLATION_REQUIRED}"
REALTIME_PROVIDER="${REALTIME_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_PROVIDER}"
SESSION_EVENT_SINK="${SESSION_EVENT_SINK:-$IOS_NEMOTRON_CONTRACT_GATEWAY_SESSION_EVENT_SINK}"
ASR_PROVIDER="${ASR_PROVIDER:-$IOS_NEMOTRON_CONTRACT_GATEWAY_ASR_PROVIDER}"

usage() {
  cat <<'USAGE'
Usage:
  DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run

Runs the physical iPhone CoreML/Nemotron MVP flow:
  1. Check iPhone readiness.
  2. Refresh local preflight evidence.
  3. Run the MVP status gate.
  4. Run diagnostics, microphone selftest, and local on-device MVP smoke.

Environment:
  DEVICE_ID                Required physical iPhone name/id.
  MAC_LAN_IP               Override the Mac LAN IP used by the iPhone.
  MAC_LAN_INTERFACE        Optional interface preference for LAN IP detection.
  API_PORT                 Default 3100.
  ACTIVE_PLAN_CODE         free/pro/premium. Default free.
  REALTIME_PORT            Default 3201.
  IOS_MVP_SMOKE_STEPS      Passed through to ios_nemotron_mvp_smoke.sh.
  DEVICE_ASR_AUTO_DOWNLOAD_MODEL
                           Default false from runtime contract.
  DEVICE_ASR_MODEL_CHUNK_MS
                           Default 2240 from runtime contract.
  SOURCE_LANGUAGE           Default auto from runtime contract.
  TARGET_LANGUAGE           Default zh from runtime contract.
  USE_LOCAL_SESSIONS        Default true from runtime contract.
  USE_ON_DEVICE_TRANSLATION Default true from runtime contract.
  ON_DEVICE_TRANSLATION_PROVIDER
                           Default ios_system from runtime contract.
  ON_DEVICE_TRANSLATION_REQUIRED
                           Default true for local on-device MVP.
  REALTIME_PROVIDER        Default lmstudio from runtime contract.
  SESSION_EVENT_SINK       Default api from runtime contract.
  ASR_PROVIDER             Default mock from runtime contract.
  IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS
                           true only for local service orchestration tests.
  IOS_NEMOTRON_RUN_SKIP_PREFLIGHT
                           true skips local rebuild/test preflight.
  IOS_NEMOTRON_RUN_SKIP_SMOKE
                           true checks status, then exits.
  IOS_NEMOTRON_RUN_START_SERVICES
                           true starts API/Gateway; defaults true only for e2e.
  IOS_NEMOTRON_RUN_REPORT_ON_EXIT
                           true refreshes Markdown/JSON acceptance evidence on exit.
  IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD
                           defaults to true for real iPhone runs.
  IOS_NEMOTRON_RUN_REPAIR_PROVISIONING
                           defaults to true for real iPhone runs.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "DEVICE_ID is required for the physical iPhone MVP run." >&2
  exit 2
fi

if [[ -z "$MAC_LAN_IP" ]]; then
  MAC_LAN_IP="$(MAC_LAN_INTERFACE="${MAC_LAN_INTERFACE:-}" "$ROOT_DIR/scripts/detect_mac_lan_ip.mjs" 2>/dev/null || true)"
fi
if [[ -z "$MAC_LAN_IP" ]]; then
  echo "MAC_LAN_IP is required when no usable Mac LAN IPv4 address can be detected." >&2
  echo "Set MAC_LAN_IP manually or set MAC_LAN_INTERFACE=en0/en1/..." >&2
  exit 2
fi
if [[ -z "$IOS_NEMOTRON_RUN_SKIP_PREFLIGHT" ]]; then
  if [[ "$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS" == "true" ]]; then
    IOS_NEMOTRON_RUN_SKIP_PREFLIGHT=true
  else
    IOS_NEMOTRON_RUN_SKIP_PREFLIGHT=false
  fi
fi
if [[ -z "$IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD" ]]; then
  if [[ "$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS" == "true" ]]; then
    IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=false
  else
    IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true
  fi
fi
if [[ -z "$IOS_NEMOTRON_RUN_REPAIR_PROVISIONING" ]]; then
  if [[ "$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS" == "true" ]]; then
    IOS_NEMOTRON_RUN_REPAIR_PROVISIONING=false
  else
    IOS_NEMOTRON_RUN_REPAIR_PROVISIONING=true
  fi
fi
if [[ -z "$IOS_NEMOTRON_RUN_START_SERVICES" ]]; then
  if [[ "$USE_LOCAL_SESSIONS" != "true" ||
    ",${IOS_MVP_SMOKE_STEPS:-diagnostics,selftest,local_mvp}," == *,e2e,* ]]; then
    IOS_NEMOTRON_RUN_START_SERVICES=true
  else
    IOS_NEMOTRON_RUN_START_SERVICES=false
  fi
fi

API_BASE_URL="http://$MAC_LAN_IP:$API_PORT"
REALTIME_BASE_URL="http://$MAC_LAN_IP:$REALTIME_PORT"
RUN_LOG="$LOG_DIR/mvp-run-services.log"
PREFLIGHT_LOG="$LOG_DIR/preflight.log"
STATUS_LOG="$LOG_DIR/mvp-status.log"
STATUS_JSON="$LOG_DIR/mvp-status.json"
SMOKE_LOG="$LOG_DIR/mvp-smoke.log"
SERVICE_PID=""

print_run_context() {
  {
    echo "iOS Nemotron MVP run context"
    echo "  generatedAt=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "  DEVICE_ID=$DEVICE_ID"
    echo "  MAC_LAN_IP=$MAC_LAN_IP"
    echo "  API_BASE_URL=$API_BASE_URL"
    echo "  ACTIVE_PLAN_CODE=$ACTIVE_PLAN_CODE"
    echo "  REALTIME_BASE_URL=$REALTIME_BASE_URL"
    echo "  IOS_MVP_SMOKE_STEPS=${IOS_MVP_SMOKE_STEPS:-diagnostics,selftest,local_mvp}"
    echo "  DEVICE_ASR_AUTO_DOWNLOAD_MODEL=$DEVICE_ASR_AUTO_DOWNLOAD_MODEL"
    echo "  DEVICE_ASR_MODEL_CHUNK_MS=$DEVICE_ASR_MODEL_CHUNK_MS"
    echo "  SOURCE_LANGUAGE=$SOURCE_LANGUAGE"
    echo "  TARGET_LANGUAGE=$TARGET_LANGUAGE"
    echo "  USE_LOCAL_SESSIONS=$USE_LOCAL_SESSIONS"
    echo "  USE_ON_DEVICE_TRANSLATION=$USE_ON_DEVICE_TRANSLATION"
    echo "  ON_DEVICE_TRANSLATION_PROVIDER=$ON_DEVICE_TRANSLATION_PROVIDER"
    echo "  ON_DEVICE_TRANSLATION_REQUIRED=$ON_DEVICE_TRANSLATION_REQUIRED"
    echo "  REALTIME_PROVIDER=$REALTIME_PROVIDER"
    echo "  SESSION_EVENT_SINK=$SESSION_EVENT_SINK"
    echo "  ASR_PROVIDER=$ASR_PROVIDER"
    echo "  IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS=$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS"
    echo "  IOS_NEMOTRON_RUN_SKIP_PREFLIGHT=$IOS_NEMOTRON_RUN_SKIP_PREFLIGHT"
    echo "  IOS_NEMOTRON_RUN_SKIP_SMOKE=$IOS_NEMOTRON_RUN_SKIP_SMOKE"
    echo "  IOS_NEMOTRON_RUN_START_SERVICES=$IOS_NEMOTRON_RUN_START_SERVICES"
    echo "  IOS_NEMOTRON_RUN_REPORT_ON_EXIT=$IOS_NEMOTRON_RUN_REPORT_ON_EXIT"
    echo "  IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=$IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD"
    echo "  IOS_NEMOTRON_RUN_REPAIR_PROVISIONING=$IOS_NEMOTRON_RUN_REPAIR_PROVISIONING"
  } >>"$RUN_LOG"
  "$ROOT_DIR/scripts/check_ios_models_resource.mjs" \
    --require-ready-model "$ROOT_DIR/apps/mobile/build/ios/iphoneos/Runner.app" \
    >>"$RUN_LOG" 2>&1 || true
  echo "Provisioning profile evidence:" >>"$RUN_LOG"
  DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/check_ios_provisioning_profile.mjs" \
    --json >>"$RUN_LOG" 2>&1 || true
  echo "" >>"$RUN_LOG"
}

cleanup() {
  local status=$?
  if [[ -n "$SERVICE_PID" ]]; then
    kill "$SERVICE_PID" >/dev/null 2>&1 || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
  if [[ "$IOS_NEMOTRON_RUN_REPORT_ON_EXIT" == "true" ]]; then
    DEVICE_ID="$DEVICE_ID" \
      "$ROOT_DIR/scripts/ios_nemotron_mvp_report.mjs" --cached-status >>"$RUN_LOG" 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR"
: >"$RUN_LOG"
: >"$PREFLIGHT_LOG"
: >"$STATUS_LOG"
: >"$STATUS_JSON"
: >"$SMOKE_LOG"
print_run_context

if [[ "$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS" != "true" ]]; then
  DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" --require-ready 2>&1 | tee -a "$RUN_LOG"
  test "${PIPESTATUS[0]}" -eq 0
fi

if [[ "$IOS_NEMOTRON_RUN_REPAIR_PROVISIONING" == "true" ]]; then
  DEVICE_ID="$DEVICE_ID" LOG_DIR="$LOG_DIR" \
    "$ROOT_DIR/scripts/ios_nemotron_repair_provisioning.sh" 2>&1 | tee -a "$RUN_LOG"
  test "${PIPESTATUS[0]}" -eq 0
fi

if [[ "$IOS_NEMOTRON_RUN_SKIP_PREFLIGHT" != "true" ]]; then
  DEVICE_ID="$DEVICE_ID" \
  LOG_DIR="$LOG_DIR" \
  IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD="$IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD" \
    "$ROOT_DIR/scripts/ios_nemotron_local_preflight.sh" 2>&1 | tee "$PREFLIGHT_LOG"
  test "${PIPESTATUS[0]}" -eq 0
fi

if [[ "$IOS_NEMOTRON_RUN_START_SERVICES" == "true" ]]; then
  MAC_LAN_IP="$MAC_LAN_IP" \
  API_PORT="$API_PORT" \
  ACTIVE_PLAN_CODE="$ACTIVE_PLAN_CODE" \
  REALTIME_PORT="$REALTIME_PORT" \
  REALTIME_PROVIDER="$REALTIME_PROVIDER" \
  SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
  ASR_PROVIDER="$ASR_PROVIDER" \
    "$ROOT_DIR/scripts/ios_nemotron_start_services.sh" >>"$RUN_LOG" 2>&1 &
  SERVICE_PID=$!

  for _ in {1..80}; do
    if grep -q "iOS Nemotron services are ready." "$RUN_LOG"; then
      break
    fi
    if ! kill -0 "$SERVICE_PID" >/dev/null 2>&1; then
      echo "iOS Nemotron services exited before readiness. Log: $RUN_LOG" >&2
      sed -n '1,160p' "$RUN_LOG" >&2
      exit 1
    fi
    sleep 0.25
  done

  if ! grep -q "iOS Nemotron services are ready." "$RUN_LOG"; then
    echo "Timed out waiting for iOS Nemotron services. Log: $RUN_LOG" >&2
    sed -n '1,160p' "$RUN_LOG" >&2
    exit 1
  fi
else
  echo "Skipping API/Gateway services for local on-device MVP." >>"$RUN_LOG"
fi

sed -n '1,40p' "$RUN_LOG"

DEVICE_ID="$DEVICE_ID" \
API_BASE_URL="$API_BASE_URL" \
REALTIME_BASE_URL="$REALTIME_BASE_URL" \
REALTIME_PROVIDER="$REALTIME_PROVIDER" \
ASR_PROVIDER="$ASR_PROVIDER" \
SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
  "$ROOT_DIR/scripts/ios_nemotron_mvp_status.mjs" --json >"$STATUS_JSON"

if [[ "$IOS_NEMOTRON_RUN_SKIP_DEVICE_READINESS" == "true" || "$IOS_NEMOTRON_RUN_SKIP_SMOKE" == "true" ]]; then
  DEVICE_ID="$DEVICE_ID" \
  API_BASE_URL="$API_BASE_URL" \
  REALTIME_BASE_URL="$REALTIME_BASE_URL" \
  REALTIME_PROVIDER="$REALTIME_PROVIDER" \
  ASR_PROVIDER="$ASR_PROVIDER" \
  SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
    "$ROOT_DIR/scripts/ios_nemotron_mvp_status.mjs" | tee "$STATUS_LOG"
else
  DEVICE_ID="$DEVICE_ID" \
  API_BASE_URL="$API_BASE_URL" \
  REALTIME_BASE_URL="$REALTIME_BASE_URL" \
  REALTIME_PROVIDER="$REALTIME_PROVIDER" \
  ASR_PROVIDER="$ASR_PROVIDER" \
  SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
    "$ROOT_DIR/scripts/ios_nemotron_mvp_status.mjs" --strict | tee "$STATUS_LOG"
fi

if [[ "$IOS_NEMOTRON_RUN_SKIP_SMOKE" == "true" ]]; then
  exit 0
fi

DEVICE_ID="$DEVICE_ID" \
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
REALTIME_PROVIDER="$REALTIME_PROVIDER" \
ASR_PROVIDER="$ASR_PROVIDER" \
SESSION_EVENT_SINK="$SESSION_EVENT_SINK" \
  "$ROOT_DIR/scripts/ios_nemotron_mvp_smoke.sh" 2>&1 | tee "$SMOKE_LOG"
exit "${PIPESTATUS[0]}"
