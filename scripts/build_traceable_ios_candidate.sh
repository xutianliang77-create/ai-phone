#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
SERVER_BASE_URL="${SERVER_BASE_URL:-}"
BUILD_MODE="${BUILD_MODE:-profile}"
PRODUCT_PROFILE="${PRODUCT_PROFILE:-core_translation}"
APP_VERSION="${APP_VERSION:-$(awk '/^version:/{split($2,v,"+"); print v[1]; exit}' "$MOBILE_DIR/pubspec.yaml")}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date '+%Y%m%d01')}"
SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$ROOT_DIR" rev-parse 'HEAD^{tree}')"
CANDIDATE_ID="${CANDIDATE_ID:-wujie-ios-${SOURCE_COMMIT:0:7}-$BUILD_NUMBER}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/.cache/ios-candidates/$CANDIDATE_ID}"

if [[ -z "$SERVER_BASE_URL" ]]; then
  echo "SERVER_BASE_URL is required" >&2
  exit 2
fi
if [[ "$BUILD_MODE" != "profile" && "$BUILD_MODE" != "release" ]]; then
  echo "BUILD_MODE must be profile or release" >&2
  exit 2
fi
if [[ "$PRODUCT_PROFILE" != "core_translation" && "$PRODUCT_PROFILE" != "full" ]]; then
  echo "PRODUCT_PROFILE must be core_translation or full" >&2
  exit 2
fi
if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "BUILD_NUMBER must be numeric" >&2
  exit 2
fi
case "$SERVER_BASE_URL" in
  *://localhost*|*://127.0.0.1*|*://0.0.0.0*|*://\[::1\]*)
    echo "SERVER_BASE_URL must be reachable from the iPhone" >&2
    exit 2
    ;;
esac
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Traceable iOS candidate requires a clean worktree" >&2
  exit 2
fi
if ! curl --noproxy '*' --fail --silent --show-error \
  --connect-timeout 3 --max-time 5 "$SERVER_BASE_URL/health" >/dev/null; then
  echo "Server health check failed: $SERVER_BASE_URL/health" >&2
  exit 2
fi

cd "$MOBILE_DIR"
WUJIE_CANDIDATE_ID="$CANDIDATE_ID" \
WUJIE_SOURCE_COMMIT="$SOURCE_COMMIT" \
WUJIE_SOURCE_TREE="$SOURCE_TREE" \
WUJIE_SOURCE_STATE=clean \
WUJIE_PRODUCT_PROFILE="$PRODUCT_PROFILE" \
node "$ROOT_DIR/scripts/lib/write_ios_build_identity_xcconfig.mjs" \
  "$MOBILE_DIR/ios/Flutter/LocalIdentity.xcconfig"
flutter build ios "--$BUILD_MODE" \
  --build-name="$APP_VERSION" \
  --build-number="$BUILD_NUMBER" \
  --dart-define="APP_VERSION=$APP_VERSION" \
  --dart-define="BUILD_NUMBER=$BUILD_NUMBER" \
  --dart-define="API_BASE_URL=$SERVER_BASE_URL" \
  --dart-define="WUJIE_CANDIDATE_ID=$CANDIDATE_ID" \
  --dart-define="SOURCE_COMMIT=$SOURCE_COMMIT" \
  --dart-define="SOURCE_TREE=$SOURCE_TREE" \
  --dart-define="SOURCE_STATE=clean" \
  --dart-define="WUJIE_PRODUCT_PROFILE=$PRODUCT_PROFILE" \
  --dart-define="SERVER_OWNED_HISTORY=true" \
  --dart-define="USE_MOCK_AUDIO=false"

if ! git -C "$ROOT_DIR" diff --quiet ||
    ! git -C "$ROOT_DIR" diff --cached --quiet; then
  echo "iOS build changed tracked source or lock files" >&2
  exit 1
fi

APP_PATH="$MOBILE_DIR/build/ios/iphoneos/Runner.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "iOS build did not produce $APP_PATH" >&2
  exit 1
fi
if find "$APP_PATH" -name 'Runner.debug.dylib' -print -quit | grep -q .; then
  echo "Traceable candidate cannot contain a Debug Flutter artifact" >&2
  exit 1
fi
codesign --verify --deep --strict "$APP_PATH"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
ACTUAL_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist")"
ACTUAL_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist")"
ACTUAL_CANDIDATE="$(/usr/libexec/PlistBuddy -c 'Print :WujieCandidateId' "$APP_PATH/Info.plist")"
ACTUAL_COMMIT="$(/usr/libexec/PlistBuddy -c 'Print :WujieSourceCommit' "$APP_PATH/Info.plist")"
ACTUAL_TREE="$(/usr/libexec/PlistBuddy -c 'Print :WujieSourceTree' "$APP_PATH/Info.plist")"
ACTUAL_SOURCE_STATE="$(/usr/libexec/PlistBuddy -c 'Print :WujieSourceState' "$APP_PATH/Info.plist")"
ACTUAL_PRODUCT_PROFILE="$(/usr/libexec/PlistBuddy -c 'Print :WujieProductProfile' "$APP_PATH/Info.plist")"
[[ "$ACTUAL_VERSION" == "$APP_VERSION" && "$ACTUAL_BUILD" == "$BUILD_NUMBER" ]] || {
  echo "Built App identity does not match requested version/build" >&2
  exit 1
}
[[ "$ACTUAL_CANDIDATE" == "$CANDIDATE_ID" &&
   "$ACTUAL_COMMIT" == "$SOURCE_COMMIT" &&
   "$ACTUAL_TREE" == "$SOURCE_TREE" &&
   "$ACTUAL_SOURCE_STATE" == clean &&
   "$ACTUAL_PRODUCT_PROFILE" == "$PRODUCT_PROFILE" ]] || {
  echo "Signed App source identity does not match the candidate input" >&2
  exit 1
}

install -d -m 700 "$OUTPUT_ROOT"
ARCHIVED_APP="$OUTPUT_ROOT/Runner.app"
if [[ -e "$ARCHIVED_APP" ]]; then
  echo "Candidate archive already exists: $ARCHIVED_APP" >&2
  exit 2
fi
ditto "$APP_PATH" "$ARCHIVED_APP"
codesign --verify --deep --strict "$ARCHIVED_APP"

APP_SHA256="$(find "$ARCHIVED_APP" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')"
SIGNING_DETAILS="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
SIGNING_IDENTITY="$(awk -F= '/^Authority=/{if (!found) {print $2; found=1}}' <<< "$SIGNING_DETAILS")"
CANDIDATE_ID="$CANDIDATE_ID" SOURCE_COMMIT="$SOURCE_COMMIT" \
SOURCE_TREE="$SOURCE_TREE" BUNDLE_ID="$BUNDLE_ID" \
APP_VERSION="$ACTUAL_VERSION" BUILD_NUMBER="$ACTUAL_BUILD" \
BUILD_MODE="$BUILD_MODE" SERVER_BASE_URL="$SERVER_BASE_URL" \
PRODUCT_PROFILE="$PRODUCT_PROFILE" \
APP_SHA256="$APP_SHA256" SIGNING_IDENTITY="$SIGNING_IDENTITY" \
node "$ROOT_DIR/scripts/lib/write_ios_candidate_manifest.mjs" \
  "$OUTPUT_ROOT/candidate-manifest.json"
chmod 600 "$OUTPUT_ROOT/candidate-manifest.json"

echo "$OUTPUT_ROOT/candidate-manifest.json"
