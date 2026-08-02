#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
APP_PATH="$MOBILE_DIR/build/ios/iphoneos/Runner.app"

run_device_command() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    if [[ "$attempt" -lt 3 ]]; then
      echo "Device connection failed (attempt $attempt/3); retrying..." >&2
      sleep 3
    fi
  done
  return 1
}

DEVICE_ID="${DEVICE_ID:-}"
SERVER_BASE_URL="${SERVER_BASE_URL:-}"
REALTIME_MODE="${REALTIME_MODE:-conversation}"
PUBSPEC_RELEASE_VERSION="$(
  awk '/^version:[[:space:]]*/ { print $2; exit }' "$MOBILE_DIR/pubspec.yaml"
)"
if [[ ! "$PUBSPEC_RELEASE_VERSION" =~ ^([0-9]+(\.[0-9]+){2})\+([0-9]+)$ ]]; then
  echo "apps/mobile/pubspec.yaml must define version as X.Y.Z+BUILD." >&2
  exit 2
fi
PUBSPEC_APP_VERSION="${BASH_REMATCH[1]}"
PUBSPEC_BUILD_NUMBER="${BASH_REMATCH[3]}"
APP_VERSION="${APP_VERSION:-$PUBSPEC_APP_VERSION}"
BUILD_NUMBER="${BUILD_NUMBER:-$PUBSPEC_BUILD_NUMBER}"

if [[ -z "$DEVICE_ID" ]]; then
  echo "DEVICE_ID is required." >&2
  exit 2
fi

if [[ -z "$SERVER_BASE_URL" ]]; then
  echo "SERVER_BASE_URL is required and must point to the server-side deployment." >&2
  exit 2
fi
if [[ ! "$APP_VERSION" =~ ^[0-9]+(\.[0-9]+){2}$ ]]; then
  echo "APP_VERSION must use X.Y.Z numeric format." >&2
  exit 2
fi
if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "BUILD_NUMBER must contain digits only." >&2
  exit 2
fi
case "$REALTIME_MODE" in
  conversation|meeting|classroom|business) ;;
  *)
    echo "REALTIME_MODE must be conversation, meeting, classroom, or business." >&2
    exit 2
    ;;
esac

case "$SERVER_BASE_URL" in
  *://localhost*|*://127.0.0.1*|*://0.0.0.0*|*://\[::1\]*)
    echo "SERVER_BASE_URL must be reachable from the iPhone and cannot be local-only." >&2
    exit 2
    ;;
esac

if ! curl --noproxy '*' --fail --silent --show-error \
  --connect-timeout 3 \
  --max-time 5 \
  "$SERVER_BASE_URL/health" >/dev/null; then
  echo "Server health check failed: $SERVER_BASE_URL/health" >&2
  echo "Refusing to install an App that points to an unavailable server." >&2
  exit 2
fi

cd "$MOBILE_DIR"

build_args=(
  --profile
  --build-name="$APP_VERSION"
  --build-number="$BUILD_NUMBER"
  --dart-define="APP_VERSION=$APP_VERSION"
  --dart-define="BUILD_NUMBER=$BUILD_NUMBER"
  --dart-define="API_BASE_URL=$SERVER_BASE_URL"
  --dart-define="REALTIME_MODE=$REALTIME_MODE"
  --dart-define=SERVER_OWNED_HISTORY=true
  --dart-define=USE_MOCK_AUDIO=false
)
flutter build ios "${build_args[@]}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Profile build did not produce $APP_PATH" >&2
  exit 1
fi

if find "$APP_PATH" -name 'Runner.debug.dylib' -print -quit | grep -q .; then
  echo "Refusing to install a Debug Flutter artifact for standalone testing." >&2
  exit 1
fi

MODEL_ROOT="$APP_PATH/Models/multilingual/2240ms"
for model_asset in \
  metadata.json \
  tokenizer.json \
  preprocessor.mlmodelc/coremldata.bin \
  encoder.mlmodelc/weights/weight.bin \
  decoder.mlmodelc/weights/weight.bin \
  joint.mlmodelc/weights/weight.bin \
  decoder_joint.mlmodelc/weights/weight.bin; do
  if [[ ! -s "$MODEL_ROOT/$model_asset" ]]; then
    echo "Refusing to install an App with missing on-device ASR asset: $model_asset" >&2
    exit 1
  fi
done

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
if [[ -z "$BUNDLE_ID" ]]; then
  echo "Built App has no bundle identifier." >&2
  exit 1
fi

run_device_command xcrun devicectl device install app \
  --device "$DEVICE_ID" \
  "$APP_PATH"
run_device_command xcrun devicectl device process launch \
  --device "$DEVICE_ID" \
  --terminate-existing \
  "$BUNDLE_ID"

echo "Installed and independently launched Profile App: $BUNDLE_ID"
echo "Configured release identity: $APP_VERSION ($BUILD_NUMBER)"
echo "Configured realtime mode: $REALTIME_MODE"
echo "Manually close and reopen the App from the iPhone home screen to complete launch acceptance."
