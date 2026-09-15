#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$ROOT_DIR/apps/mobile"
SERVER_BASE_URL="${SERVER_BASE_URL:-}"
BUILD_MODE="${BUILD_MODE:-profile}"
PRODUCT_PROFILE="${PRODUCT_PROFILE:-core_translation}"
APP_VERSION="${APP_VERSION:-$(awk '/^version:/{split($2,v,"+"); print v[1]; exit}' "$MOBILE_DIR/pubspec.yaml")}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date '+%Y%m%d01')}"
PUBLIC_IOS_BUNDLE_ID="${PUBLIC_IOS_BUNDLE_ID:-}"
PUBLIC_IOS_DEVELOPMENT_TEAM="${PUBLIC_IOS_DEVELOPMENT_TEAM:-}"
PUBLIC_DEPLOYMENT_ID="${PUBLIC_DEPLOYMENT_ID:-}"
SOURCE_LANGUAGE="${SOURCE_LANGUAGE:-auto}"
TARGET_LANGUAGE="${TARGET_LANGUAGE:-zh}"
AUTO_REVERSE_TARGET_LANGUAGE="${AUTO_REVERSE_TARGET_LANGUAGE:-true}"
AUTOMATIC_LANGUAGE_PAIR="${AUTOMATIC_LANGUAGE_PAIR:-}"
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
if [[ ! "$PUBLIC_IOS_BUNDLE_ID" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] ||
   [[ "$PUBLIC_IOS_BUNDLE_ID" =~ ^com\.(example|yourcompany)(\.|$) ]]; then
  echo "PUBLIC_IOS_BUNDLE_ID must be an approved non-template reverse-DNS identifier" >&2
  exit 2
fi
if [[ ! "$PUBLIC_IOS_DEVELOPMENT_TEAM" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "PUBLIC_IOS_DEVELOPMENT_TEAM must be a 10-character Apple Team ID" >&2
  exit 2
fi
if [[ ! "$PUBLIC_DEPLOYMENT_ID" =~ ^[A-Za-z0-9._-]{1,96}$ ]]; then
  echo "PUBLIC_DEPLOYMENT_ID must be an approved public deployment identifier" >&2
  exit 2
fi
private_bundle_id="$(awk -F= '/^TRANSLATION_IOS_BUNDLE_ID=/{print $2; exit}' "$MOBILE_DIR/ios/Flutter/Release.xcconfig")"
if [[ -n "$private_bundle_id" && "$PUBLIC_IOS_BUNDLE_ID" == "$private_bundle_id" ]]; then
  echo "PUBLIC_IOS_BUNDLE_ID must not reuse the private 1.0 bundle identifier" >&2
  exit 2
fi
if [[ ! "$SOURCE_LANGUAGE" =~ ^(auto|[a-z]{2,3}(-Hant)?)$ ]] ||
   [[ ! "$TARGET_LANGUAGE" =~ ^[a-z]{2,3}(-Hant)?$ ]] ||
   [[ "$AUTO_REVERSE_TARGET_LANGUAGE" != true && "$AUTO_REVERSE_TARGET_LANGUAGE" != false ]]; then
  echo "SOURCE_LANGUAGE, TARGET_LANGUAGE, or AUTO_REVERSE_TARGET_LANGUAGE is invalid" >&2
  exit 2
fi
if [[ "$SOURCE_LANGUAGE" == auto || "$AUTO_REVERSE_TARGET_LANGUAGE" == true ]]; then
  if [[ ! "$AUTOMATIC_LANGUAGE_PAIR" =~ ^[a-z]{2,3}(-Hant)?,[a-z]{2,3}(-Hant)?$ ]]; then
    echo "AUTOMATIC_LANGUAGE_PAIR=source,target is required for automatic language or reverse" >&2
    exit 2
  fi
  IFS=, read -r automatic_pair_source automatic_pair_target <<< "$AUTOMATIC_LANGUAGE_PAIR"
  if [[ "$automatic_pair_source" == "$automatic_pair_target" ]] ||
     [[ "$TARGET_LANGUAGE" != "$automatic_pair_source" && "$TARGET_LANGUAGE" != "$automatic_pair_target" ]]; then
    echo "AUTOMATIC_LANGUAGE_PAIR must be distinct and contain TARGET_LANGUAGE" >&2
    exit 2
  fi
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

# Online public sessions still perform VAD on the phone. The CoreML bundle is
# intentionally staged outside Git, so a clean source checkout alone cannot
# prove that the installable candidate contains it. Fail before compiling if
# this verified resource is absent or changed; never replace it by a download.
VAD_ROOT="$MOBILE_DIR/ios/Runner/Models/vad/silero-vad-unified-256ms-v6.0.0.mlmodelc"
VAD_HASHES=(
  '30945d54e32c3f15ec35dc6ee32128a27a6cdc03b0a12ffab04434069c49dfb5 analytics/coremldata.bin'
  '0c3063bd09ba71c26ede0308d7c33591d0770e971a3fcc603ccad7ba1e8fb88d coremldata.bin'
  'e00405801b86542dbb722a2ec2fff285e539836990f4fdc6aa321ce1105eb32c metadata.json'
  '4f93e2b5920e851fbc0be1c21a2a76e170124467ed7b01125190aa32e795f8af model.mil'
  '853cf34740d3f5061f977ebe2976f7c921b064261c9c4753b3a1196f2dba42b4 weights/weight.bin'
)
verify_vad_resource() {
  local root="$1" item expected relative actual
  for item in "${VAD_HASHES[@]}"; do
    expected="${item%% *}"
    relative="${item#* }"
    actual="$(shasum -a 256 "$root/$relative" 2>/dev/null | awk '{print $1}')"
    if [[ "$actual" != "$expected" ]]; then
      echo "Verified public VAD resource is missing or has an unexpected hash: $relative" >&2
      exit 2
    fi
  done
}
verify_vad_resource "$VAD_ROOT"

cd "$MOBILE_DIR"
TRANSLATION_IOS_BUNDLE_ID="$PUBLIC_IOS_BUNDLE_ID" \
TRANSLATION_IOS_DEVELOPMENT_TEAM="$PUBLIC_IOS_DEVELOPMENT_TEAM" \
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
  --dart-define="PUBLIC_DEPLOYMENT_ID=$PUBLIC_DEPLOYMENT_ID" \
  --dart-define="SOURCE_LANGUAGE=$SOURCE_LANGUAGE" \
  --dart-define="TARGET_LANGUAGE=$TARGET_LANGUAGE" \
  --dart-define="AUTO_REVERSE_TARGET_LANGUAGE=$AUTO_REVERSE_TARGET_LANGUAGE" \
  --dart-define="AUTOMATIC_LANGUAGE_PAIR=$AUTOMATIC_LANGUAGE_PAIR" \
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
verify_vad_resource "$APP_PATH/Models/vad/silero-vad-unified-256ms-v6.0.0.mlmodelc"
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
verify_vad_resource "$ARCHIVED_APP/Models/vad/silero-vad-unified-256ms-v6.0.0.mlmodelc"

APP_SHA256="$(find "$ARCHIVED_APP" -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')"
SIGNING_DETAILS="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
SIGNING_IDENTITY="$(awk -F= '/^Authority=/{if (!found) {print $2; found=1}}' <<< "$SIGNING_DETAILS")"
CANDIDATE_ID="$CANDIDATE_ID" SOURCE_COMMIT="$SOURCE_COMMIT" \
SOURCE_TREE="$SOURCE_TREE" BUNDLE_ID="$BUNDLE_ID" \
APP_VERSION="$ACTUAL_VERSION" BUILD_NUMBER="$ACTUAL_BUILD" \
BUILD_MODE="$BUILD_MODE" SERVER_BASE_URL="$SERVER_BASE_URL" \
PRODUCT_PROFILE="$PRODUCT_PROFILE" \
PUBLIC_DEPLOYMENT_ID="$PUBLIC_DEPLOYMENT_ID" \
SOURCE_LANGUAGE="$SOURCE_LANGUAGE" TARGET_LANGUAGE="$TARGET_LANGUAGE" \
AUTO_REVERSE_TARGET_LANGUAGE="$AUTO_REVERSE_TARGET_LANGUAGE" \
AUTOMATIC_LANGUAGE_PAIR="$AUTOMATIC_LANGUAGE_PAIR" \
APP_SHA256="$APP_SHA256" SIGNING_IDENTITY="$SIGNING_IDENTITY" \
node "$ROOT_DIR/scripts/lib/write_ios_candidate_manifest.mjs" \
  "$OUTPUT_ROOT/candidate-manifest.json"
chmod 600 "$OUTPUT_ROOT/candidate-manifest.json"

echo "$OUTPUT_ROOT/candidate-manifest.json"
