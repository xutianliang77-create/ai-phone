#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
FLUTTER_BIN="${FLUTTER_BIN:-/Users/xutianliang/development/flutter/bin/flutter}"
DEVICE_ID="${DEVICE_ID:-Wha的iPhone}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.cache/ios-nemotron-services}"
PREFLIGHT_JSON="${PREFLIGHT_JSON:-$LOG_DIR/preflight.json}"
SIGNED_BUILD_JSON="${SIGNED_BUILD_JSON:-$LOG_DIR/signed-build.json}"
SIGNED_BUILD_LOG="${SIGNED_BUILD_LOG:-$LOG_DIR/signed-device-build.log}"
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD="${IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD:-false}"
LOCAL_PREFLIGHT_DONE=false
PREFLIGHT_DONE=false

usage() {
  cat <<'USAGE'
Usage:
  npm run ios:nemotron:preflight

Refreshes local iOS Nemotron evidence before physical iPhone smoke:
  1. Validate iOS permission metadata, signing, and CoreML runtime settings.
  2. Validate the staged FluidAudio-ready Nemotron bundle.
  3. Run Flutter tests.
  4. Rebuild iOS simulator and iPhoneOS no-codesign apps.
  5. Verify both built apps include a ready Nemotron model resource.
  6. Optionally build a signed iPhoneOS app.
  7. Print the current MVP status.

Environment:
  DEVICE_ID                              Device name used for final status.
  FLUTTER_BIN                            Flutter binary path.
  IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD    true runs a signed device build.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

run_step() {
  echo "== $* =="
}

write_preflight_json() {
  local status="$1"
  PREFLIGHT_STATUS="$status" \
  PREFLIGHT_JSON="$PREFLIGHT_JSON" \
  ROOT_DIR="$ROOT_DIR" \
  FLUTTER_BIN="$FLUTTER_BIN" \
  DEVICE_ID="$DEVICE_ID" \
  SIGNED_BUILD_JSON="$SIGNED_BUILD_JSON" \
  IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD="$IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD" \
  LOCAL_PREFLIGHT_DONE="$LOCAL_PREFLIGHT_DONE" \
    node <<'NODE'
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("fs");
const { dirname } = require("path");
const output = process.env.PREFLIGHT_JSON;
const signedBuildJson = process.env.SIGNED_BUILD_JSON;
const signedBuild = readJsonIfPresent(signedBuildJson);
const payload = {
  schemaVersion: 1,
  status: process.env.PREFLIGHT_STATUS,
  generatedAt: new Date().toISOString(),
  deviceId: process.env.DEVICE_ID,
  flutterBin: process.env.FLUTTER_BIN,
  localChecksCompleted: process.env.LOCAL_PREFLIGHT_DONE === "true",
  signedDeviceBuildRequested:
    process.env.IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD === "true",
  signedBuildJson,
  signedBuildStatus: signedBuild?.status ?? "missing",
  signedBuildIssues: signedBuild?.issues ?? [],
  simulatorApp: `${process.env.ROOT_DIR}/apps/mobile/build/ios/iphonesimulator/Runner.app`,
  deviceApp: `${process.env.ROOT_DIR}/apps/mobile/build/ios/iphoneos/Runner.app`,
  requiredModel: "Models/multilingual/2240ms",
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

function readJsonIfPresent(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
NODE
}

write_signed_build_json() {
  local status="$1"
  local message="${2:-}"
  local exit_code="${3:-}"
  SIGNED_BUILD_STATUS="$status" \
  SIGNED_BUILD_MESSAGE="$message" \
  SIGNED_BUILD_EXIT_CODE="$exit_code" \
  SIGNED_BUILD_JSON="$SIGNED_BUILD_JSON" \
  SIGNED_BUILD_LOG="$SIGNED_BUILD_LOG" \
  ROOT_DIR="$ROOT_DIR" \
  FLUTTER_BIN="$FLUTTER_BIN" \
    node <<'NODE'
const { mkdirSync, writeFileSync } = require("fs");
const { existsSync, readFileSync } = require("fs");
const { dirname } = require("path");
const output = process.env.SIGNED_BUILD_JSON;
const logPath = process.env.SIGNED_BUILD_LOG;
const diagnosis = signedBuildDiagnosis(
  existsSync(logPath) ? readFileSync(logPath, "utf8") : "",
);
const payload = {
  schemaVersion: 1,
  status: process.env.SIGNED_BUILD_STATUS,
  generatedAt: new Date().toISOString(),
  message: process.env.SIGNED_BUILD_MESSAGE,
  exitCode: process.env.SIGNED_BUILD_EXIT_CODE
    ? Number(process.env.SIGNED_BUILD_EXIT_CODE)
    : null,
  flutterBin: process.env.FLUTTER_BIN,
  logPath,
  deviceApp: `${process.env.ROOT_DIR}/apps/mobile/build/ios/iphoneos/Runner.app`,
  command: "flutter --no-version-check build ios --debug --no-pub",
  issues: diagnosis.issues,
  actions: diagnosis.actions,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

function signedBuildDiagnosis(content) {
  const issues = [];
  const actions = [];
  if (content.includes("Your team has no devices from which to generate a provisioning profile")) {
    issues.push("Apple Team has no registered devices for provisioning profile generation.");
    actions.push("Connect, unlock, and trust the iPhone so Xcode can register it with the Apple Team.");
  }
  const profileMatch = content.match(/No profiles for '([^']+)' were found/);
  if (profileMatch) {
    issues.push(`No iOS App Development provisioning profile matches ${profileMatch[1]}.`);
    actions.push(`Open apps/mobile/ios/Runner.xcworkspace in Xcode and let Automatic Signing create a profile for ${profileMatch[1]}.`);
  }
  if (content.includes("Communication with Apple failed")) {
    issues.push("Xcode could not complete Apple Developer portal provisioning.");
    actions.push("Confirm the Apple ID/team is signed in in Xcode and has permission to create development profiles.");
  }
  return { issues, actions };
}
NODE
}

finish_preflight() {
  local status=$?
  if [[ "$status" -ne 0 && "$PREFLIGHT_DONE" != "true" ]]; then
    if [[ "$LOCAL_PREFLIGHT_DONE" == "true" ]]; then
      write_preflight_json pass || true
    else
      write_preflight_json fail || true
    fi
  fi
  exit "$status"
}
trap finish_preflight EXIT

mkdir -p "$LOG_DIR"
write_preflight_json running

run_step "iOS runtime metadata"
node "$ROOT_DIR/scripts/check_ios_runtime_permissions.mjs"

run_step "iOS signing settings"
node "$ROOT_DIR/scripts/check_ios_signing_settings.mjs"

run_step "iOS CoreML runtime settings"
node "$ROOT_DIR/scripts/check_ios_coreml_runtime.mjs"

run_step "staged Nemotron model"
(cd "$ROOT_DIR" && node scripts/validate_ios_nemotron_bundle.mjs)

run_step "Flutter tests"
(cd "$MOBILE_DIR" && "$FLUTTER_BIN" --no-version-check test)

run_step "iOS simulator build"
(cd "$MOBILE_DIR" && "$FLUTTER_BIN" --no-version-check build ios --simulator --no-pub)

run_step "iOS simulator model resource"
(cd "$ROOT_DIR" && \
  node scripts/check_ios_models_resource.mjs \
    --require-ready-model apps/mobile/build/ios/iphonesimulator/Runner.app)

run_step "iPhoneOS no-codesign build"
(cd "$MOBILE_DIR" && \
  "$FLUTTER_BIN" --no-version-check build ios --debug --no-codesign --no-pub)

run_step "iPhoneOS model resource"
(cd "$ROOT_DIR" && \
  node scripts/check_ios_models_resource.mjs \
    --require-ready-model apps/mobile/build/ios/iphoneos/Runner.app)

run_step "post-build CoreML runtime settings"
node "$ROOT_DIR/scripts/check_ios_coreml_runtime.mjs" \
  "$ROOT_DIR/apps/mobile/build/ios/iphoneos/Runner.app"

run_step "post-build signing settings"
node "$ROOT_DIR/scripts/check_ios_signing_settings.mjs" \
  --built-app "$ROOT_DIR/apps/mobile/build/ios/iphoneos/Runner.app"

LOCAL_PREFLIGHT_DONE=true
write_preflight_json pass

if [[ "$IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD" == "true" ]]; then
  run_step "iPhoneOS signed debug build"
  : >"$SIGNED_BUILD_LOG"
  write_signed_build_json running "signed iPhoneOS build running"
  if (cd "$MOBILE_DIR" && \
    "$FLUTTER_BIN" --no-version-check build ios --debug --no-pub) \
    2>&1 | tee "$SIGNED_BUILD_LOG"; then
    write_signed_build_json pass "signed iPhoneOS build passed" 0
  else
    signed_status=${PIPESTATUS[0]}
    write_signed_build_json fail \
      "signed iPhoneOS build failed; see $SIGNED_BUILD_LOG" \
      "$signed_status"
    write_preflight_json pass
    PREFLIGHT_DONE=true
    exit "$signed_status"
  fi
fi

run_step "MVP status summary"
DEVICE_ID="$DEVICE_ID" node "$ROOT_DIR/scripts/ios_nemotron_mvp_status.mjs"

write_preflight_json pass
PREFLIGHT_DONE=true
echo "Preflight evidence: $PREFLIGHT_JSON"
