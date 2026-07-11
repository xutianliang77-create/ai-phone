#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
DEVICE_ID="${DEVICE_ID:-}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cache/ios-nemotron-services}"
REPAIR_LOG="${REPAIR_LOG:-$LOG_DIR/provisioning-repair.log}"
REPAIR_JSON="${REPAIR_JSON:-$LOG_DIR/provisioning-repair.json}"
PROFILE_BEFORE_JSON="$LOG_DIR/provisioning-profile-before-repair.json"
PROFILE_AFTER_JSON="$LOG_DIR/provisioning-profile-after-repair.json"
DEVICE_JSON="$LOG_DIR/provisioning-repair-device.json"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$LOG_DIR/xcode-derived-data-provisioning}"

usage() {
  cat <<'USAGE'
Usage:
  DEVICE_ID="Wha的iPhone" npm run ios:nemotron:repair-provisioning

Checks the selected iPhone readiness, then asks xcodebuild Automatic Signing to
register the device and create/update a development provisioning profile.

Environment:
  DEVICE_ID           Required physical iPhone name/id.
  LOG_DIR             Default .cache/ios-nemotron-services.
  REPAIR_LOG          Default $LOG_DIR/provisioning-repair.log.
  REPAIR_JSON         Default $LOG_DIR/provisioning-repair.json.
  DERIVED_DATA_PATH   Default $LOG_DIR/xcode-derived-data-provisioning.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "DEVICE_ID is required for provisioning repair." >&2
  exit 2
fi

mkdir -p "$LOG_DIR"
: >"$REPAIR_LOG"

write_result() {
  local status="$1"
  local stage="$2"
  local message="$3"
  local exit_code="${4:-}"
  REPAIR_STATUS="$status" \
  REPAIR_STAGE="$stage" \
  REPAIR_MESSAGE="$message" \
  REPAIR_EXIT_CODE="$exit_code" \
  REPAIR_JSON="$REPAIR_JSON" \
  REPAIR_LOG="$REPAIR_LOG" \
  DEVICE_ID="$DEVICE_ID" \
  PROFILE_BEFORE_JSON="$PROFILE_BEFORE_JSON" \
  PROFILE_AFTER_JSON="$PROFILE_AFTER_JSON" \
  DEVICE_JSON="$DEVICE_JSON" \
    node <<'NODE'
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { dirname } = require("path");
const output = process.env.REPAIR_JSON;
const payload = {
  schemaVersion: 1,
  status: process.env.REPAIR_STATUS,
  stage: process.env.REPAIR_STAGE,
  generatedAt: new Date().toISOString(),
  deviceId: process.env.DEVICE_ID ?? null,
  message: process.env.REPAIR_MESSAGE,
  exitCode: process.env.REPAIR_EXIT_CODE
    ? Number(process.env.REPAIR_EXIT_CODE)
    : null,
  logPath: process.env.REPAIR_LOG,
  deviceDiagnostic: readJson(process.env.DEVICE_JSON),
  profileBefore: readJson(process.env.PROFILE_BEFORE_JSON),
  profileAfter: readJson(process.env.PROFILE_AFTER_JSON),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
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
  console.log(`Unable to read profile JSON: ${error.message}`);
  process.exit(0);
}
console.log(`profile status=${payload.status ?? "unknown"} count=${payload.profileCount ?? "unknown"} candidates=${payload.candidateCount ?? "unknown"}`);
for (const issue of payload.issues ?? []) console.log(`issue: ${issue}`);
for (const action of payload.actions ?? []) console.log(`action: ${action}`);
NODE
}

selected_udid() {
  node - "$DEVICE_JSON" <<'NODE'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const devices = payload.devices ?? [];
const selected = devices.find((device) => device.matched !== false) ?? devices[0];
if (selected?.udid && selected.udid !== "unknown") {
  process.stdout.write(selected.udid);
}
NODE
}

echo "Checking existing provisioning profile..." | tee -a "$REPAIR_LOG"
if DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/check_ios_provisioning_profile.mjs" \
  --json >"$PROFILE_BEFORE_JSON"; then
  print_profile_summary "$PROFILE_BEFORE_JSON" | tee -a "$REPAIR_LOG"
  write_result pass already_ready "matching provisioning profile already exists" 0
  exit 0
fi
print_profile_summary "$PROFILE_BEFORE_JSON" | tee -a "$REPAIR_LOG"

echo "Checking iPhone readiness before provisioning repair..." | tee -a "$REPAIR_LOG"
if ! DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/diagnose_ios_device.mjs" \
  --require-ready --json >"$DEVICE_JSON"; then
  write_result fail device_readiness "iPhone is not ready for provisioning repair" 2
  cat "$DEVICE_JSON" >>"$REPAIR_LOG"
  echo "iPhone is not ready for provisioning repair. See $REPAIR_JSON" >&2
  exit 2
fi

UDID="$(selected_udid)"
if [[ -z "$UDID" ]]; then
  write_result fail device_udid "Unable to resolve selected iPhone UDID" 2
  echo "Unable to resolve selected iPhone UDID. See $REPAIR_JSON" >&2
  exit 2
fi

echo "Running xcodebuild provisioning repair for UDID=$UDID" | tee -a "$REPAIR_LOG"
set +e
(
  cd "$MOBILE_DIR"
  xcodebuild \
    -workspace ios/Runner.xcworkspace \
    -scheme Runner \
    -configuration Debug \
    -destination "id=$UDID" \
    -destination-timeout 30 \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
) 2>&1 | tee -a "$REPAIR_LOG"
xcode_status=${PIPESTATUS[0]}
set -e

if [[ "$xcode_status" -ne 0 ]]; then
  write_result fail xcodebuild "xcodebuild provisioning repair failed" "$xcode_status"
  echo "xcodebuild provisioning repair failed. See $REPAIR_LOG" >&2
  exit "$xcode_status"
fi

if DEVICE_ID="$DEVICE_ID" "$ROOT_DIR/scripts/check_ios_provisioning_profile.mjs" \
  --json >"$PROFILE_AFTER_JSON"; then
  print_profile_summary "$PROFILE_AFTER_JSON" | tee -a "$REPAIR_LOG"
  write_result pass repaired "matching provisioning profile is ready" 0
  echo "Provisioning profile is ready. Evidence: $REPAIR_JSON"
  exit 0
fi

print_profile_summary "$PROFILE_AFTER_JSON" | tee -a "$REPAIR_LOG"
write_result fail profile_check "xcodebuild completed, but no matching profile was found" 1
echo "No matching profile was found after xcodebuild. See $REPAIR_JSON" >&2
exit 1
