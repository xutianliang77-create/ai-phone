#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-preflight}"
CANDIDATE_ENV_FILE="${CANDIDATE_ENV_FILE:-$ROOT_DIR/release/domestic/release.env}"
REMOTE_HOST="${REMOTE_HOST:-beelink@100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/ai-phone-server-candidates/core-translation}"
REMOTE_SOURCE="$REMOTE_ROOT/source"
REMOTE_RUNTIME="$REMOTE_ROOT/runtime"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ai-phone-core-candidate}"
AI_PHONE_CONTAINER_PREFIX="${AI_PHONE_CONTAINER_PREFIX:-$COMPOSE_PROJECT_NAME}"
AI_PHONE_IMAGE_TAG="${AI_PHONE_IMAGE_TAG:-core-candidate-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
PUBLIC_HOST="${PUBLIC_HOST:-100.110.127.117}"
API_PORT="${API_PORT:-3320}"
REALTIME_PORT="${REALTIME_PORT:-3321}"
LIVEKIT_AGENT_PORT="${LIVEKIT_AGENT_PORT:-8381}"
CANDIDATE_RESERVED_PORTS="${CANDIDATE_RESERVED_PORTS:-3110,3111,3210,3211,8081,8082,3310}"
SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$ROOT_DIR" rev-parse 'HEAD^{tree}')"
RUNTIME_CANDIDATE_ID="${WUJIE_RUNTIME_CANDIDATE_ID:-wujie-core-${SOURCE_COMMIT:0:12}-$(date -u +%Y%m%dT%H%M%SZ)}"
API_STATUS_URL="http://$PUBLIC_HOST:$API_PORT/health"
GATEWAY_STATUS_URL="http://$PUBLIC_HOST:$REALTIME_PORT/health"
AGENT_STATUS_URL="http://$PUBLIC_HOST:$LIVEKIT_AGENT_PORT/worker"

case "$MODE" in
  preflight|deploy|status|down) ;;
  *) echo "Usage: $0 [preflight|deploy|status|down]" >&2; exit 2 ;;
esac

[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.:-]+$ ]] || {
  echo "PUBLIC_HOST contains unsafe characters" >&2
  exit 2
}
[[ "$AI_PHONE_IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "AI_PHONE_IMAGE_TAG contains unsafe characters" >&2
  exit 2
}
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ && "$SOURCE_TREE" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Candidate source commit/tree identity is invalid" >&2
  exit 2
}
[[ "$RUNTIME_CANDIDATE_ID" =~ ^[A-Za-z0-9._-]{1,96}$ ]] || {
  echo "WUJIE_RUNTIME_CANDIDATE_ID is invalid" >&2
  exit 2
}
for name in "$COMPOSE_PROJECT_NAME" "$AI_PHONE_CONTAINER_PREFIX"; do
  [[ "$name" =~ ^[a-z0-9][a-z0-9_-]{2,62}$ && "$name" != "ai-phone" ]] || {
    echo "Candidate Compose/container name is unsafe or not isolated" >&2
    exit 2
  }
done
[[ "$REMOTE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ &&
   "$REMOTE_ROOT" == *candidate* &&
   "$REMOTE_ROOT" != "/data/models/ai-phone-server" ]] || {
  echo "REMOTE_ROOT is unsafe or not isolated" >&2
  exit 2
}
[[ "$CANDIDATE_RESERVED_PORTS" =~ ^[0-9]+(,[0-9]+)*$ ]] || {
  echo "CANDIDATE_RESERVED_PORTS must be comma-separated integers" >&2
  exit 2
}
for port in "$API_PORT" "$REALTIME_PORT" "$LIVEKIT_AGENT_PORT"; do
  [[ "$port" =~ ^[0-9]+$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || {
    echo "Candidate ports must be integers from 1 to 65535" >&2
    exit 2
  }
  [[ ",$CANDIDATE_RESERVED_PORTS," != *",$port,"* ]] || {
    echo "Candidate port $port conflicts with a reserved service" >&2
    exit 2
  }
done
[[ "$API_PORT" != "$REALTIME_PORT" &&
   "$API_PORT" != "$LIVEKIT_AGENT_PORT" &&
   "$REALTIME_PORT" != "$LIVEKIT_AGENT_PORT" ]] || {
  echo "Candidate ports must be unique" >&2
  exit 2
}

preflight() {
  node "$ROOT_DIR/scripts/check_core_translation_candidate_deploy.mjs" \
    --env-file "$CANDIDATE_ENV_FILE" \
    --compose-project "$COMPOSE_PROJECT_NAME" \
    --container-prefix "$AI_PHONE_CONTAINER_PREFIX" \
    --remote-root "$REMOTE_ROOT" \
    --api-port "$API_PORT" \
    --realtime-port "$REALTIME_PORT" \
    --translation-agent-port "$LIVEKIT_AGENT_PORT" \
    --reserved-ports "$CANDIDATE_RESERVED_PORTS"
}

require_clean_source() {
  local dirty
  dirty="$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)"
  [[ -z "$dirty" ]] || {
    echo "Core candidate deploy requires a clean source checkout" >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  }
}

remote_compose() {
  ssh "$REMOTE_HOST" \
    "AI_PHONE_ENV_FILE='$REMOTE_RUNTIME/server.env' \
     AI_PHONE_DATA_DIR='$REMOTE_RUNTIME/data' \
     AI_PHONE_IMAGE_TAG='$AI_PHONE_IMAGE_TAG' \
     AI_PHONE_CONTAINER_PREFIX='$AI_PHONE_CONTAINER_PREFIX' \
     docker compose -p '$COMPOSE_PROJECT_NAME' \
       -f '$REMOTE_SOURCE/infra/ai-phone-server/docker-compose.yaml' $*"
}

status() {
  remote_compose "ps"
  local api_health gateway_health agent_health runtime_manifest
  api_health="$(curl -fsS --max-time 5 "$API_STATUS_URL")"
  gateway_health="$(curl -fsS --max-time 5 "$GATEWAY_STATUS_URL")"
  agent_health="$(curl -fsS --max-time 5 "$AGENT_STATUS_URL")"
  runtime_manifest="$(ssh "$REMOTE_HOST" \
    "cat '$REMOTE_RUNTIME/candidate-manifest.json'")"
  API_HEALTH="$api_health" GATEWAY_HEALTH="$gateway_health" \
    AGENT_HEALTH="$agent_health" RUNTIME_MANIFEST="$runtime_manifest" node <<'NODE'
const api = JSON.parse(process.env.API_HEALTH);
const gateway = JSON.parse(process.env.GATEWAY_HEALTH);
const agent = JSON.parse(process.env.AGENT_HEALTH);
const manifest = JSON.parse(process.env.RUNTIME_MANIFEST);
if (api.status !== "ok") throw new Error("candidate API is not healthy");
if (gateway.status !== "ok") throw new Error("candidate Gateway is not healthy");
const profile = api.capabilityProfileReadiness;
if (profile?.status !== "ready" || profile.profile !== "core_translation" ||
    profile.explicit !== true) {
  throw new Error("candidate core_translation profile is not ready");
}
if (!String(agent.agent_name ?? "").includes("core-candidate")) {
  throw new Error("candidate Translation Agent identity is not isolated");
}
const runtime = gateway.runtimeIdentity;
if (runtime?.traceable !== true) {
  throw new Error("candidate Gateway runtime identity is not traceable");
}
for (const [runtimeKey, manifestKey] of [
  ["candidateId", "candidateId"],
  ["sourceCommit", "sourceCommit"],
  ["sourceTree", "sourceTree"],
  ["imageId", "imageId"],
  ["configSha256", "configSha256"],
]) {
  if (runtime[runtimeKey] !== manifest[manifestKey]) {
    throw new Error(`candidate runtime ${runtimeKey} does not match manifest`);
  }
}
NODE
  echo "Core candidate ready on $PUBLIC_HOST:$API_PORT/$REALTIME_PORT/$LIVEKIT_AGENT_PORT"
}

if [[ "$MODE" == "preflight" ]]; then
  preflight
  exit 0
fi
if [[ "$MODE" == "status" ]]; then
  status
  exit 0
fi
if [[ "$MODE" == "down" ]]; then
  remote_compose "down"
  echo "Core candidate stopped; image, private env, and isolated data retained."
  exit 0
fi

preflight
require_clean_source
npm --prefix "$ROOT_DIR" run check:source-build -- --json
require_clean_source
ssh "$REMOTE_HOST" \
  "mkdir -p '$REMOTE_SOURCE' '$REMOTE_RUNTIME/data/voice-references'"
rsync -az --delete \
  --exclude='.git/' \
  --exclude='.cache/' \
  --exclude='.data/' \
  --exclude='apps/' \
  --exclude='data/' \
  --exclude='docs/' \
  --exclude='model-eval/' \
  --exclude='node_modules/' \
  --exclude='outputs/' \
  --exclude='PROGRESS_LOG.md' \
  --exclude='release/domestic/release.env' \
  --exclude='test-apps/' \
  --exclude='test-audio/' \
  --exclude='services/model-services/' \
  "$ROOT_DIR/" "$REMOTE_HOST:$REMOTE_SOURCE/"
rsync -a --chmod=F600 "$CANDIDATE_ENV_FILE" \
  "$REMOTE_HOST:$REMOTE_RUNTIME/release.env.incoming"

ssh "$REMOTE_HOST" \
  "REMOTE_RUNTIME='$REMOTE_RUNTIME' \
   COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME' \
   RUNTIME_CANDIDATE_ID='$RUNTIME_CANDIDATE_ID' \
   SOURCE_COMMIT='$SOURCE_COMMIT' SOURCE_TREE='$SOURCE_TREE' \
   PUBLIC_HOST='$PUBLIC_HOST' API_PORT='$API_PORT' \
   REALTIME_PORT='$REALTIME_PORT' LIVEKIT_AGENT_PORT='$LIVEKIT_AGENT_PORT' \
   bash -s" <<'REMOTE'
set -euo pipefail
umask 077
incoming="$REMOTE_RUNTIME/release.env.incoming"
next="$REMOTE_RUNTIME/server.env.next"
target="$REMOTE_RUNTIME/server.env"
test "$(stat -c '%a' "$incoming")" = "600"
install -m 600 "$incoming" "$next"
rm -f "$incoming"
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$next"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$next"
  else
    printf '%s=%s\n' "$key" "$value" >>"$next"
  fi
}
set_env NODE_ENV production
set_env DOMESTIC_RELEASE_CAPABILITY_PROFILE core_translation
set_env API_TEST_AUTO_ACCOUNT false
set_env AUTH_DEBUG_OTP false
set_env CALL_PROVIDER_POLICY call_link_only
set_env AGENT_CALL_WORKER_ENABLED false
set_env VOICE_AGENT_ENABLED false
set_env VOICE_AGENT_ASSIST_ENABLED false
set_env VOICE_AGENT_AUTONOMOUS_ENABLED false
set_env VOICE_AGENT_OPERATOR_CONSULT_ENABLED false
set_env LIVEKIT_EGRESS_ENABLED false
set_env LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED false
set_env API_BIND_HOST 0.0.0.0
set_env API_PORT "$API_PORT"
set_env REALTIME_BIND_HOST 0.0.0.0
set_env REALTIME_PORT "$REALTIME_PORT"
set_env LIVEKIT_AGENT_BIND_HOST 0.0.0.0
set_env LIVEKIT_AGENT_PORT "$LIVEKIT_AGENT_PORT"
set_env API_BASE_URL "http://127.0.0.1:$API_PORT"
set_env API_HEALTH_URL "http://127.0.0.1:$API_PORT/health"
set_env REALTIME_WS_ENDPOINT "ws://$PUBLIC_HOST:$REALTIME_PORT/realtime"
set_env GATEWAY_HEALTH_URL "http://127.0.0.1:$REALTIME_PORT/health"
set_env TRANSLATION_AGENT_HEALTH_URL \
  "http://127.0.0.1:$LIVEKIT_AGENT_PORT/worker"
set_env LIVEKIT_TRANSLATION_AGENT_NAME \
  "translation-runtime-core-candidate-$COMPOSE_PROJECT_NAME"
set_env API_STORAGE_DRIVER sqlite
set_env API_DATA_FILE /data/ai-phone/api-store.json
set_env API_SQLITE_FILE /data/ai-phone/api-store.sqlite
set_env VOICE_PROFILE_REFERENCE_DIR /data/ai-phone/voice-references
set_env PUBLIC_RATE_LIMIT_KEY_PREFIX \
  "wujie:candidate:$COMPOSE_PROJECT_NAME:public"
set_env DEPLOYMENT_ENVIRONMENT staging-core-candidate
set_env WUJIE_REQUIRE_TRACEABLE_RUNTIME true
set_env WUJIE_RUNTIME_CANDIDATE_ID "$RUNTIME_CANDIDATE_ID"
set_env WUJIE_RUNTIME_SOURCE_COMMIT "$SOURCE_COMMIT"
set_env WUJIE_RUNTIME_SOURCE_TREE "$SOURCE_TREE"
sed -i '/^WUJIE_RUNTIME_IMAGE_ID=/d;/^WUJIE_RUNTIME_CONFIG_SHA256=/d' "$next"
chmod 600 "$next"
if [[ -f "$target" ]]; then
  install -m 600 "$target" "$REMOTE_RUNTIME/server.env.rollback"
fi
mv -f "$next" "$target"
REMOTE

remote_compose "build"
ssh "$REMOTE_HOST" \
  "REMOTE_RUNTIME='$REMOTE_RUNTIME' \
   COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME' \
   AI_PHONE_IMAGE_TAG='$AI_PHONE_IMAGE_TAG' \
   RUNTIME_CANDIDATE_ID='$RUNTIME_CANDIDATE_ID' \
   SOURCE_COMMIT='$SOURCE_COMMIT' SOURCE_TREE='$SOURCE_TREE' \
   bash -s" <<'REMOTE'
set -euo pipefail
umask 077
target="$REMOTE_RUNTIME/server.env"
manifest="$REMOTE_RUNTIME/candidate-manifest.json"
image_id="$(docker image inspect "ai-phone-server:$AI_PHONE_IMAGE_TAG" \
  --format '{{.Id}}')"
[[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$target"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$target"
  else
    printf '%s=%s\n' "$key" "$value" >>"$target"
  fi
}
set_env WUJIE_RUNTIME_IMAGE_ID "$image_id"
hash_input="$(mktemp "$REMOTE_RUNTIME/.runtime-config.XXXXXX")"
trap 'rm -f "$hash_input"' EXIT
grep -v '^WUJIE_RUNTIME_CONFIG_SHA256=' "$target" >"$hash_input"
config_sha256="$(sha256sum "$hash_input" | awk '{print $1}')"
set_env WUJIE_RUNTIME_CONFIG_SHA256 "$config_sha256"
chmod 600 "$target"
env_file_sha256="$(sha256sum "$target" | awk '{print $1}')"
MANIFEST="$manifest" CANDIDATE_ID="$RUNTIME_CANDIDATE_ID" \
  SOURCE_COMMIT="$SOURCE_COMMIT" SOURCE_TREE="$SOURCE_TREE" \
  IMAGE_TAG="$AI_PHONE_IMAGE_TAG" IMAGE_ID="$image_id" \
  CONFIG_SHA256="$config_sha256" ENV_FILE_SHA256="$env_file_sha256" \
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

manifest = {
    "schemaVersion": 1,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "candidateId": os.environ["CANDIDATE_ID"],
    "sourceCommit": os.environ["SOURCE_COMMIT"],
    "sourceTree": os.environ["SOURCE_TREE"],
    "imageTag": os.environ["IMAGE_TAG"],
    "imageId": os.environ["IMAGE_ID"],
    "configSha256": os.environ["CONFIG_SHA256"],
    "environmentFileSha256": os.environ["ENV_FILE_SHA256"],
    "composeProject": os.environ["COMPOSE_PROJECT_NAME"],
}
with open(os.environ["MANIFEST"], "w", encoding="utf-8") as output:
    json.dump(manifest, output, ensure_ascii=False, indent=2)
    output.write("\n")
os.chmod(os.environ["MANIFEST"], 0o600)
PY
REMOTE
remote_compose "up -d --no-build --remove-orphans"
for _ in {1..60}; do
  if curl -fsS --max-time 3 "$API_STATUS_URL" >/dev/null 2>&1 &&
     curl -fsS --max-time 3 "$GATEWAY_STATUS_URL" >/dev/null 2>&1 &&
     curl -fsS --max-time 3 "$AGENT_STATUS_URL" >/dev/null 2>&1; then
    status
    exit 0
  fi
  sleep 2
done
remote_compose "ps"
remote_compose "logs --tail=120 wujie-ai"
echo "Core candidate deployment did not become healthy" >&2
exit 1
