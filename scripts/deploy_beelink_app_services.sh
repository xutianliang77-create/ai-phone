#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-beelink@100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/ai-phone-server}"
REMOTE_SOURCE="$REMOTE_ROOT/source"
REMOTE_RUNTIME="$REMOTE_ROOT/runtime"
PUBLIC_HOST="${PUBLIC_HOST:-100.110.127.117}"
MODE="${1:-deploy}"
IMAGE_TAG="${AI_PHONE_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"

case "$MODE" in
  sync|deploy|status) ;;
  *) echo "Usage: $0 [sync|deploy|status]" >&2; exit 2 ;;
esac

remote_compose() {
  ssh "$REMOTE_HOST" \
    "AI_PHONE_ENV_FILE='$REMOTE_RUNTIME/server.env' \
     AI_PHONE_DATA_DIR='$REMOTE_RUNTIME/data' \
     AI_PHONE_IMAGE_TAG='$IMAGE_TAG' \
     docker compose -p ai-phone -f '$REMOTE_SOURCE/infra/ai-phone-server/docker-compose.yaml' $*"
}

status() {
  remote_compose "ps"
  local api_health gateway_health
  api_health="$(curl -fsS "http://$PUBLIC_HOST:3110/health")"
  gateway_health="$(curl -fsS "http://$PUBLIC_HOST:3111/health")"
  EXPECTED_WS="ws://$PUBLIC_HOST:3111/realtime" \
  API_HEALTH="$api_health" \
  GATEWAY_HEALTH="$gateway_health" \
    node <<'NODE'
const api = JSON.parse(process.env.API_HEALTH);
const gateway = JSON.parse(process.env.GATEWAY_HEALTH);
const expected = {
  apiStatus: "ok",
  realtimeWsEndpoint: process.env.EXPECTED_WS,
  gatewayStatus: "ok",
  provider: "hymt2_self_hosted",
  asrProvider: "http",
  speakerProvider: "http",
  sessionEventSink: "api",
};
const actual = {
  apiStatus: api.status,
  realtimeWsEndpoint: api.realtimeWsEndpoint,
  gatewayStatus: gateway.status,
  provider: gateway.provider,
  asrProvider: gateway.asrProvider,
  speakerProvider: gateway.speakerProvider,
  sessionEventSink: gateway.sessionEventSink,
};
for (const [key, value] of Object.entries(expected)) {
  if (actual[key] !== value) {
    throw new Error(`${key} expected ${value}, got ${actual[key] ?? "missing"}`);
  }
}
if (gateway.releaseReadiness?.status !== "ready") {
  throw new Error("Gateway release readiness is not ready");
}
NODE
  echo "ai phone API/Gateway ready on $PUBLIC_HOST:3110/3111"
}

if [[ "$MODE" == "status" ]]; then
  status
  exit 0
fi

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_SOURCE' '$REMOTE_RUNTIME/data/voice-references'"
rsync -az --delete \
  --exclude='.git/' \
  --exclude='.cache/' \
  --exclude='.data/' \
  --exclude='apps/' \
  --exclude='data/' \
  --exclude='docs/' \
  --exclude='model-eval/' \
  --exclude='node_modules/' \
  --exclude='test-apps/' \
  --exclude='test-audio/' \
  --exclude='services/model-services/' \
  "$ROOT_DIR/" "$REMOTE_HOST:$REMOTE_SOURCE/"

if [[ "${MIGRATE_LOCAL_DATA:-false}" == "true" ]]; then
  rsync -az "$ROOT_DIR/services/api-server/.data/" \
    "$REMOTE_HOST:$REMOTE_RUNTIME/data/"
fi

ssh "$REMOTE_HOST" "REMOTE_RUNTIME='$REMOTE_RUNTIME' PUBLIC_HOST='$PUBLIC_HOST' bash -s" <<'REMOTE'
set -euo pipefail
env_file="$REMOTE_RUNTIME/server.env"
if [[ -f "$env_file" ]]; then
  exit 0
fi

set -a
source /data/models/translation-model-eval/services/asr-service-qwen3/.env
source /data/models/translation-model-eval/services/translation-service/.env
source /data/models/translation-model-eval/services/speaker-service/.env
source /data/models/translation-model-eval/services/tts-service/.env
source /home/beelink/livekit-qkxy/release.env.snippet
set +a
umask 077
token_secret="$(openssl rand -hex 32)"
internal_secret="$(openssl rand -hex 32)"
otp_secret="$(openssl rand -hex 32)"
cat >"$env_file" <<EOF
NODE_ENV=development
API_PORT=3110
REALTIME_PORT=3111
API_BASE_URL=http://127.0.0.1:3110
REALTIME_WS_ENDPOINT=ws://$PUBLIC_HOST:3111/realtime
API_DATA_FILE=/data/ai-phone/api-store.json
VOICE_PROFILE_REFERENCE_DIR=/data/ai-phone/voice-references
REALTIME_TOKEN_SECRET=$token_secret
INTERNAL_API_SECRET=$internal_secret
AUTH_OTP_SECRET=$otp_secret
API_TEST_AUTO_ACCOUNT=true
AUTH_TEST_PHONE=13800000000
AUTH_TEST_CODE=123456
REGION_EDITION=domestic
DATA_REGION=cn
CALL_PROVIDER_POLICY=call_link_only
COMPLIANCE_PROFILE=pipl
ACTIVE_PLAN_CODE=premium
REALTIME_PROVIDER=hymt2_self_hosted
SESSION_EVENT_SINK=api
ASR_PROVIDER=http
ASR_HTTP_ENDPOINT=http://127.0.0.1:8021/asr/transcribe
ASR_HTTP_FLUSH_ENDPOINT=http://127.0.0.1:8021/asr/sessions/:sessionId/flush
ASR_HTTP_HEALTH_URL=http://127.0.0.1:8021/health
ASR_HTTP_API_KEY=$ASR_SERVICE_API_KEY
ASR_HTTP_TIMEOUT_MS=120000
SPEAKER_PROVIDER=http
SPEAKER_HTTP_BASE_URL=http://127.0.0.1:8022
SPEAKER_HTTP_API_KEY=$SPEAKER_SERVICE_API_KEY
SPEAKER_HTTP_TIMEOUT_MS=2000
TRANSLATION_BASE_URL=http://127.0.0.1:8003/v1
TRANSLATION_MODEL=tencent/Hy-MT2-1.8B
TRANSLATION_API_KEY=$TRANSLATION_SERVICE_API_KEY
TRANSLATION_TIMEOUT_MS=20000
TRANSLATION_MAX_TOKENS=512
TTS_HTTP_ENDPOINT=http://127.0.0.1:8002/tts/synthesize
TTS_HTTP_API_KEY=$TTS_SERVICE_API_KEY
TTS_HTTP_TIMEOUT_MS=30000
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_CORRECTION_MODEL=qwen/qwen3.5-9b
LLM_REVIEW_MODEL=qwen/qwen3.5-9b
LLM_REFINEMENT_ENABLED=true
LLM_REVIEW_ENABLED=true
LLM_REASONING_EFFORT=none
DOMAIN_LEXICON_PACKS=business,technology,medical,tourism,restaurant,entertainment
CALL_ROOM_PROVIDER=livekit
LIVEKIT_URL=$LIVEKIT_URL
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
CALL_ROOM_TOKEN_TTL_SECONDS=${CALL_ROOM_TOKEN_TTL_SECONDS:-3600}
EOF
chmod 600 "$env_file"
REMOTE

if [[ "$MODE" == "sync" ]]; then
  echo "Synced ai phone server source to $REMOTE_HOST:$REMOTE_SOURCE"
  exit 0
fi

remote_compose "up -d --build --remove-orphans"
for _ in {1..60}; do
  if curl -fsS "http://$PUBLIC_HOST:3110/health" >/dev/null 2>&1 &&
     curl -fsS "http://$PUBLIC_HOST:3111/health" >/dev/null 2>&1; then
    status
    exit 0
  fi
  sleep 2
done
remote_compose "ps"
remote_compose "logs --tail=120 api gateway"
echo "ai phone server deployment did not become healthy" >&2
exit 1
