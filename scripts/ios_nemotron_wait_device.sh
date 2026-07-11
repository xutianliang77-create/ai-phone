#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ID="${DEVICE_ID:-}"
WAIT_TIMEOUT_SECONDS="${IOS_NEMOTRON_WAIT_TIMEOUT_SECONDS:-900}"
WAIT_INTERVAL_SECONDS="${IOS_NEMOTRON_WAIT_INTERVAL_SECONDS:-5}"
RUN_ON_READY="${IOS_NEMOTRON_WAIT_RUN_ON_READY:-false}"
REPAIR_ON_READY="${IOS_NEMOTRON_WAIT_REPAIR_ON_READY:-false}"
REPORT_ON_EXIT="${IOS_NEMOTRON_WAIT_REPORT_ON_EXIT:-true}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cache/ios-nemotron-services}"
WAIT_LOG="$LOG_DIR/device-readiness-wait.log"
WAIT_JSON="$LOG_DIR/device-readiness-latest.json"
PROFILE_JSON="$LOG_DIR/provisioning-profile-latest.json"

usage() {
  cat <<'USAGE'
Usage:
  DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device
  DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --repair
  DEVICE_ID="Wha的iPhone" npm run ios:nemotron:wait-device -- --run

Waits until devicectl reports the physical iPhone is ready for the
CoreML/Nemotron MVP smoke. With --repair, runs provisioning repair once ready.
With --run, starts the full MVP flow once ready.

Environment:
  DEVICE_ID                           Required physical iPhone name/id.
  IOS_NEMOTRON_WAIT_TIMEOUT_SECONDS   Default 900.
  IOS_NEMOTRON_WAIT_INTERVAL_SECONDS  Default 5.
  IOS_NEMOTRON_WAIT_REPAIR_ON_READY   true is equivalent to --repair.
  IOS_NEMOTRON_WAIT_RUN_ON_READY      true is equivalent to --run.
  IOS_NEMOTRON_WAIT_REPORT_ON_EXIT    Default true; refreshes report when this
                                      wait command exits without handoff.

Writes:
  .cache/ios-nemotron-services/device-readiness-wait.log
  .cache/ios-nemotron-services/device-readiness-latest.json
  .cache/ios-nemotron-services/provisioning-profile-latest.json
  docs/poc/ios-nemotron-mvp-acceptance-report.md on wait exit
  .cache/ios-nemotron-services/mvp-acceptance-summary.json on wait exit
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --run)
      RUN_ON_READY=true
      shift
      ;;
    --repair)
      REPAIR_ON_READY=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$DEVICE_ID" ]]; then
  echo "DEVICE_ID is required for iPhone readiness waiting." >&2
  exit 2
fi
if [[ "$RUN_ON_READY" == "true" && "$REPAIR_ON_READY" == "true" ]]; then
  echo "Use either --run or --repair. The full --run flow already attempts provisioning repair." >&2
  exit 2
fi

print_readiness_summary() {
  local json_file="$1"
  node - "$json_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.log(`Unable to read readiness JSON: ${error.message}`);
  process.exit(0);
}
console.log(`ready=${payload.ready ? "yes" : "no"} physical=${payload.physicalDeviceCount ?? "unknown"} matched=${payload.matchedDeviceCount ?? "unknown"}`);
for (const device of payload.devices ?? []) {
  const parts = [
    `${device.name ?? "unknown"} (${device.model ?? "unknown"}, iOS ${device.osVersion ?? "unknown"})`,
    `pairing=${device.pairingState ?? "unknown"}`,
    `developerMode=${device.developerModeStatus ?? "unknown"}`,
    `tunnel=${device.tunnelState ?? "unknown"}`,
    `ready=${device.ready ? "yes" : "no"}`,
  ];
  console.log(parts.join(" | "));
  for (const action of device.actions ?? []) {
    console.log(`action: ${action}`);
  }
}
if (payload.error) console.log(payload.error);
NODE
}

print_profile_summary() {
  local json_file="$1"
  node - "$json_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  console.log(`Unable to read provisioning profile JSON: ${error.message}`);
  process.exit(0);
}
console.log(`provisioning=${payload.status ?? "unknown"} profiles=${payload.profileCount ?? "unknown"} candidates=${payload.candidateCount ?? "unknown"}`);
for (const issue of payload.issues ?? []) console.log(`profile issue: ${issue}`);
for (const action of payload.actions ?? []) console.log(`profile action: ${action}`);
NODE
}

handoff_to_repair() {
  echo "Starting provisioning repair. Log: $LOG_DIR/provisioning-repair.log" | tee -a "$WAIT_LOG"
  export DEVICE_ID LOG_DIR
  exec "$ROOT_DIR/scripts/ios_nemotron_repair_provisioning.sh"
}

handoff_to_run() {
  echo "Starting full iOS Nemotron MVP run. Log: $LOG_DIR/mvp-run-services.log" | tee -a "$WAIT_LOG"
  export DEVICE_ID LOG_DIR
  exec "$ROOT_DIR/scripts/ios_nemotron_run_mvp.sh"
}

refresh_report_on_exit() {
  local status=$?
  if [[ "$REPORT_ON_EXIT" == "true" ]]; then
    {
      echo ""
      echo "Refreshing MVP acceptance report after wait-device exit."
    } >>"$WAIT_LOG"
    DEVICE_ID="$DEVICE_ID" \
      "$ROOT_DIR/scripts/ios_nemotron_mvp_report.mjs" --live-status >>"$WAIT_LOG" 2>&1 || true
  fi
  exit "$status"
}

mkdir -p "$LOG_DIR"
: >"$WAIT_LOG"
rm -f "$WAIT_JSON"
rm -f "$PROFILE_JSON"
trap refresh_report_on_exit EXIT INT TERM

echo "Waiting for iPhone readiness: DEVICE_ID=$DEVICE_ID" | tee -a "$WAIT_LOG"
echo "Timeout: ${WAIT_TIMEOUT_SECONDS}s, interval: ${WAIT_INTERVAL_SECONDS}s" | tee -a "$WAIT_LOG"
echo "Latest readiness JSON: $WAIT_JSON" | tee -a "$WAIT_LOG"
echo "Latest provisioning profile JSON: $PROFILE_JSON" | tee -a "$WAIT_LOG"

start=$SECONDS
attempt=1
while (( SECONDS - start <= WAIT_TIMEOUT_SECONDS )); do
  tmp_json="$WAIT_JSON.tmp"
  echo "" | tee -a "$WAIT_LOG"
  echo "Attempt $attempt at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee -a "$WAIT_LOG"
  if DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" \
    --require-ready --json >"$tmp_json"; then
    mv "$tmp_json" "$WAIT_JSON"
    print_readiness_summary "$WAIT_JSON" | tee -a "$WAIT_LOG"
    echo "iPhone is ready for CoreML/Nemotron MVP smoke." | tee -a "$WAIT_LOG"
    profile_tmp="$PROFILE_JSON.tmp"
    if DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/check_ios_provisioning_profile.mjs" \
      --json >"$profile_tmp"; then
      mv "$profile_tmp" "$PROFILE_JSON"
    else
      mv "$profile_tmp" "$PROFILE_JSON"
    fi
    print_profile_summary "$PROFILE_JSON" | tee -a "$WAIT_LOG"
    if [[ "$REPAIR_ON_READY" == "true" ]]; then
      handoff_to_repair
    fi
    if [[ "$RUN_ON_READY" == "true" ]]; then
      handoff_to_run
    fi
    exit 0
  fi
  mv "$tmp_json" "$WAIT_JSON"
  print_readiness_summary "$WAIT_JSON" | tee -a "$WAIT_LOG"
  attempt=$((attempt + 1))
  if (( SECONDS - start >= WAIT_TIMEOUT_SECONDS )); then
    break
  fi
  sleep "$WAIT_INTERVAL_SECONDS"
done

echo "Timed out waiting for iPhone readiness. Log: $WAIT_LOG" >&2
echo "Latest readiness JSON: $WAIT_JSON" >&2
exit 2
