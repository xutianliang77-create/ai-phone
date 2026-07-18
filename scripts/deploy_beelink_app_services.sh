#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-beelink@100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/ai-phone-server}"
REMOTE_SOURCE="$REMOTE_ROOT/source"
REMOTE_RUNTIME="$REMOTE_ROOT/runtime"
PUBLIC_HOST="${PUBLIC_HOST:-100.110.127.117}"
CALL_HTTPS_DOMAIN="${CALL_HTTPS_DOMAIN:-beelink.tail1e9cec.ts.net}"
CALL_PUBLIC_BASE_URL="${CALL_PUBLIC_BASE_URL:-https://$CALL_HTTPS_DOMAIN}"
CALL_LIVEKIT_URL="${CALL_LIVEKIT_URL:-wss://$CALL_HTTPS_DOMAIN}"
MODE="${1:-deploy}"
IMAGE_TAG="${AI_PHONE_IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
CALL_FULL_DUPLEX_ENABLED="${CALL_FULL_DUPLEX_ENABLED:-false}"
AI_PHONE_COMPOSE_PROFILES="${AI_PHONE_COMPOSE_PROFILES:-}"

if [[ "$MODE" != "status" ]]; then
  npm --prefix "$ROOT_DIR" run check:source-build -- --json
fi

case "$MODE" in
  sync|deploy|status) ;;
  *) echo "Usage: $0 [sync|deploy|status]" >&2; exit 2 ;;
esac

remote_compose() {
  ssh "$REMOTE_HOST" \
    "AI_PHONE_ENV_FILE='$REMOTE_RUNTIME/server.env' \
     AI_PHONE_DATA_DIR='$REMOTE_RUNTIME/data' \
     AI_PHONE_IMAGE_TAG='$IMAGE_TAG' \
     COMPOSE_PROFILES='$AI_PHONE_COMPOSE_PROFILES' \
     docker compose -p ai-phone -f '$REMOTE_SOURCE/infra/ai-phone-server/docker-compose.yaml' $*"
}

status() {
  remote_compose "ps"
  local api_health gateway_health
  api_health="$(curl -fsS "http://$PUBLIC_HOST:3110/health")"
  gateway_health="$(curl -fsS "http://$PUBLIC_HOST:3111/health")"
  curl -fsS "http://$PUBLIC_HOST:8081/" >/dev/null
  local agent_info
  agent_info="$(curl -fsS "http://$PUBLIC_HOST:8081/worker")"
  if [[ ",$AI_PHONE_COMPOSE_PROFILES," == *",voice-agent,"* ]]; then
    curl -fsS "http://$PUBLIC_HOST:8082/" >/dev/null
  fi
  if [[ ",$AI_PHONE_COMPOSE_PROFILES," == *",srt-ingress,"* ]]; then
    ssh "$REMOTE_HOST" \
      "curl -fsS 'http://127.0.0.1:${SRT_INGRESS_PORT:-3310}/health' >/dev/null"
  fi
  EXPECTED_WS="ws://$PUBLIC_HOST:3111/realtime" \
  API_HEALTH="$api_health" \
  GATEWAY_HEALTH="$gateway_health" \
  AGENT_INFO="$agent_info" \
    node <<'NODE'
const api = JSON.parse(process.env.API_HEALTH);
const gateway = JSON.parse(process.env.GATEWAY_HEALTH);
const agent = JSON.parse(process.env.AGENT_INFO);
const expected = {
  apiStatus: "ok",
  realtimeWsEndpoint: process.env.EXPECTED_WS,
  gatewayStatus: "ok",
  provider: "hymt2_self_hosted",
  asrProvider: "http",
  speakerProvider: "http",
  sessionEventSink: "api",
  agentName: "translation-runtime",
};
const actual = {
  apiStatus: api.status,
  realtimeWsEndpoint: api.realtimeWsEndpoint,
  gatewayStatus: gateway.status,
  provider: gateway.provider,
  asrProvider: gateway.asrProvider,
  speakerProvider: gateway.speakerProvider,
  sessionEventSink: gateway.sessionEventSink,
  agentName: agent.agent_name,
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
  echo "ai phone API/Gateway/Translation Agent ready on $PUBLIC_HOST:3110/3111/8081"
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

ssh "$REMOTE_HOST" \
  "REMOTE_RUNTIME='$REMOTE_RUNTIME' \
   PUBLIC_HOST='$PUBLIC_HOST' \
   CALL_PUBLIC_BASE_URL='$CALL_PUBLIC_BASE_URL' \
   CALL_LIVEKIT_URL='$CALL_LIVEKIT_URL' bash -s" <<'REMOTE'
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
dispatch_secret="$(openssl rand -hex 32)"
voice_dispatch_secret="$(openssl rand -hex 32)"
srt_bridge_secret="$(openssl rand -hex 32)"
otp_secret="$(openssl rand -hex 32)"
cat >"$env_file" <<EOF
NODE_ENV=development
API_PORT=3110
REALTIME_PORT=3111
API_BASE_URL=http://127.0.0.1:3110
REALTIME_WS_ENDPOINT=ws://$PUBLIC_HOST:3111/realtime
PUBLIC_CALL_BASE_URL=$CALL_PUBLIC_BASE_URL
API_STORAGE_DRIVER=sqlite
API_DATA_FILE=/data/ai-phone/api-store.json
API_SQLITE_FILE=/data/ai-phone/api-store.sqlite
VOICE_PROFILE_REFERENCE_DIR=/data/ai-phone/voice-references
REALTIME_TOKEN_SECRET=$token_secret
REALTIME_ALLOW_QUERY_TOKEN=false
INTERNAL_API_SECRET=$internal_secret
TRANSLATION_WORKER_RUNTIME_PROVIDER=livekit_dispatch
LIVEKIT_DISPATCH_TICKET_SECRET=$dispatch_secret
LIVEKIT_TRANSLATION_AGENT_NAME=translation-runtime
LIVEKIT_DISPATCH_MAX_ACTIVE_JOBS=4
LIVEKIT_DISPATCH_LEASE_SECONDS=45
LIVEKIT_DISPATCH_HEARTBEAT_SECONDS=15
LIVEKIT_DISPATCH_READY_TIMEOUT_SECONDS=20
LIVEKIT_DISPATCH_REQUEST_TIMEOUT_SECONDS=10
LIVEKIT_DISPATCH_MAX_METADATA_BYTES=2048
LIVEKIT_AGENT_MAX_JOBS_PER_NODE=4
LIVEKIT_AGENT_IDLE_PROCESSES=2
LIVEKIT_AGENT_DRAIN_TIMEOUT_SECONDS=60
LIVEKIT_AGENT_SHUTDOWN_TIMEOUT_SECONDS=30
LIVEKIT_AGENT_INITIALIZE_TIMEOUT_SECONDS=20
LIVEKIT_AGENT_JOB_MEMORY_WARN_MB=768
LIVEKIT_AGENT_JOB_MEMORY_LIMIT_MB=1024
LIVEKIT_AGENT_PORT=8081
AGENT_CALL_WORKER_ENABLED=false
AGENT_CALL_WORKER_ID=
AGENT_CALL_PROVIDER_ADAPTER=
AGENT_CALL_WORKER_LEASE_SECONDS=45
AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS=7200
PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED=false
VOICE_AGENT_ENABLED=false
VOICE_AGENT_ASSIST_ENABLED=false
VOICE_AGENT_AUTONOMOUS_ENABLED=false
VOICE_AGENT_AUTONOMOUS_USER_IDS=
VOICE_AGENT_AUTONOMOUS_SCENARIOS=booking,customer_support,business_inquiry
VOICE_AGENT_POLICY_VERSION=voice-agent-v1
VOICE_AGENT_RUNTIME_PROVIDER=disabled
LIVEKIT_VOICE_AGENT_NAME=voice-agent-runtime
VOICE_AGENT_DISPATCH_TICKET_SECRET=$voice_dispatch_secret
VOICE_AGENT_DISPATCH_MAX_ACTIVE_JOBS=2
VOICE_AGENT_DISPATCH_LEASE_SECONDS=45
VOICE_AGENT_DISPATCH_HEARTBEAT_SECONDS=15
VOICE_AGENT_DISPATCH_READY_TIMEOUT_SECONDS=25
VOICE_AGENT_DISPATCH_REQUEST_TIMEOUT_SECONDS=10
VOICE_AGENT_MAX_JOBS_PER_NODE=2
VOICE_AGENT_IDLE_PROCESSES=1
VOICE_AGENT_DRAIN_TIMEOUT_SECONDS=90
VOICE_AGENT_SHUTDOWN_TIMEOUT_SECONDS=45
VOICE_AGENT_INITIALIZE_TIMEOUT_SECONDS=30
VOICE_AGENT_JOB_MEMORY_WARN_MB=768
VOICE_AGENT_JOB_MEMORY_LIMIT_MB=1024
VOICE_AGENT_PORT=8082
VOICE_AGENT_API_TIMEOUT_MS=10000
VOICE_AGENT_AMD_NO_SPEECH_TIMEOUT_MS=12000
VOICE_AGENT_AMD_DETECTION_TIMEOUT_MS=30000
VOICE_AGENT_VOICEMAIL_ENABLED=false
VOICE_AGENT_MAX_SESSION_SECONDS=7200
VOICE_AGENT_HANDOFF_TIMEOUT_SECONDS=120
VOICE_AGENT_OPERATOR_CONSULT_ENABLED=false
VOICE_AGENT_OPERATOR_CONSULT_TTL_SECONDS=180
VOICE_AGENT_OPERATOR_CONSULT_MAX_ATTEMPTS=3
LIVEKIT_EGRESS_ENABLED=false
LIVEKIT_EGRESS_REQUEST_TIMEOUT_SECONDS=10
LIVEKIT_EGRESS_OBJECT_PREFIX=recordings
LIVEKIT_EGRESS_MAX_RETENTION_DAYS=30
LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED=false
LIVEKIT_INGRESS_ENABLED=false
LIVEKIT_INGRESS_REQUEST_TIMEOUT_SECONDS=10
LIVEKIT_INGRESS_MAX_ACTIVE_PER_SESSION=1
LIVEKIT_INGRESS_MAX_ACTIVE_TOTAL=8
LIVEKIT_INGRESS_POLICY_VERSION=external-media-v1
LIVEKIT_INGRESS_URL_INPUT_ENABLED=false
LIVEKIT_INGRESS_PULL_URL_HOSTS=
LIVEKIT_INGRESS_PULL_NETWORK_POLICY_ENFORCED=false
LIVEKIT_INGRESS_SOURCE_PREFLIGHT_TIMEOUT_MS=3000
LIVEKIT_INGRESS_SOURCE_MAX_REDIRECTS=2
LIVEKIT_INGRESS_SRT_ENABLED=false
SRT_INGRESS_BRIDGE_BASE_URL=http://127.0.0.1:3310
SRT_INGRESS_BRIDGE_API_KEY=$srt_bridge_secret
SRT_INGRESS_PUBLIC_HOST=$PUBLIC_HOST
SRT_INGRESS_PORT=3310
SRT_INGRESS_PORT_MIN=10080
SRT_INGRESS_PORT_MAX=10179
SRT_INGRESS_MAX_JOBS=4
SRT_INGRESS_LATENCY_MS=200
SRT_INGRESS_MAX_DURATION_SECONDS=7200
SRT_INGRESS_SHUTDOWN_GRACE_MS=10000
SRT_INGRESS_RTMP_ALLOWED_HOSTS=
SRT_INGRESS_FFMPEG_PATH=/usr/bin/ffmpeg
AUTH_OTP_SECRET=$otp_secret
API_TEST_AUTO_ACCOUNT=true
AUTH_TEST_PHONE=13800000000
AUTH_TEST_CODE=123456
REGION_EDITION=domestic
DATA_REGION=cn
CALL_PROVIDER_POLICY=call_link_only
COMPLIANCE_PROFILE=pipl
ACTIVE_PLAN_CODE=premium
SPEECH_PIPELINE_MODE=cascade
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
VOICE_IDENTITY_HTTP_BASE_URL=http://127.0.0.1:8022
VOICE_IDENTITY_HTTP_TIMEOUT_MS=30000
TRANSLATION_BASE_URL=http://127.0.0.1:8003/v1
TRANSLATION_MODEL=tencent/Hy-MT2-1.8B
TRANSLATION_API_KEY=$TRANSLATION_SERVICE_API_KEY
TRANSLATION_TIMEOUT_MS=20000
TRANSLATION_MAX_TOKENS=512
TTS_HTTP_ENDPOINT=http://127.0.0.1:8002/tts/synthesize
TTS_HTTP_API_KEY=$TTS_SERVICE_API_KEY
TTS_HTTP_TIMEOUT_MS=30000
TTS_AGENT_PREWARM_TIMEOUT_MS=60000
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_CORRECTION_MODEL=qwen/qwen3.5-9b
LLM_REVIEW_MODEL=qwen/qwen3.5-9b
LLM_REFINEMENT_ENABLED=true
LLM_REVIEW_ENABLED=true
LLM_REASONING_EFFORT=none
DOMAIN_LEXICON_PACKS=business,technology,medical,travel,dining,entertainment
CALL_ROOM_PROVIDER=livekit
LIVEKIT_URL=$CALL_LIVEKIT_URL
LIVEKIT_WORKER_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
CALL_ROOM_TOKEN_TTL_SECONDS=${CALL_ROOM_TOKEN_TTL_SECONDS:-120}
CALL_GUEST_TICKET_TTL_SECONDS=${CALL_GUEST_TICKET_TTL_SECONDS:-300}
CALL_ROOM_MAX_PARTICIPANTS=${CALL_ROOM_MAX_PARTICIPANTS:-3}
CALL_ROOM_MAX_SESSION_SECONDS=${CALL_ROOM_MAX_SESSION_SECONDS:-3600}
CALL_ROOM_EMPTY_TIMEOUT_SECONDS=${CALL_ROOM_EMPTY_TIMEOUT_SECONDS:-300}
CALL_ROOM_MAX_DATA_PACKET_BYTES=${CALL_ROOM_MAX_DATA_PACKET_BYTES:-12288}
CALL_ROOM_MAX_EVENTS_PER_REQUEST=${CALL_ROOM_MAX_EVENTS_PER_REQUEST:-20}
CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND=${CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND:-40}
CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS=${CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS:-80}
EOF
chmod 600 "$env_file"
REMOTE

ssh "$REMOTE_HOST" \
  "ENV_FILE='$REMOTE_RUNTIME/server.env' \
   PUBLIC_HOST='$PUBLIC_HOST' \
   CALL_PUBLIC_BASE_URL='$CALL_PUBLIC_BASE_URL' \
   CALL_LIVEKIT_URL='$CALL_LIVEKIT_URL' \
   CALL_FULL_DUPLEX_ENABLED='$CALL_FULL_DUPLEX_ENABLED' bash -s" <<'REMOTE'
set -euo pipefail
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
set_env PUBLIC_CALL_BASE_URL "$CALL_PUBLIC_BASE_URL"
set_env LIVEKIT_URL "$CALL_LIVEKIT_URL"
set_env LIVEKIT_WORKER_URL "ws://127.0.0.1:7880"
set_env CALL_ROOM_TOKEN_TTL_SECONDS "120"
set_env CALL_FULL_DUPLEX_ENABLED "$CALL_FULL_DUPLEX_ENABLED"
set_env TRANSLATION_WORKER_RUNTIME_PROVIDER "livekit_dispatch"
set_env LIVEKIT_TRANSLATION_AGENT_NAME "translation-runtime"
set_env LIVEKIT_AGENT_PORT "8081"
if ! grep -q '^LIVEKIT_DISPATCH_TICKET_SECRET=' "$ENV_FILE"; then
  set_env LIVEKIT_DISPATCH_TICKET_SECRET "$(openssl rand -hex 32)"
fi
if ! grep -q '^VOICE_AGENT_DISPATCH_TICKET_SECRET=' "$ENV_FILE"; then
  set_env VOICE_AGENT_DISPATCH_TICKET_SECRET "$(openssl rand -hex 32)"
fi
if ! grep -q '^VOICE_AGENT_RUNTIME_PROVIDER=' "$ENV_FILE"; then
  set_env VOICE_AGENT_RUNTIME_PROVIDER "disabled"
fi
if ! grep -q '^SRT_INGRESS_BRIDGE_API_KEY=' "$ENV_FILE"; then
  set_env SRT_INGRESS_BRIDGE_API_KEY "$(openssl rand -hex 32)"
fi
if ! grep -q '^LIVEKIT_INGRESS_SRT_ENABLED=' "$ENV_FILE"; then
  set_env LIVEKIT_INGRESS_SRT_ENABLED "false"
fi
if ! grep -q '^SRT_INGRESS_RTMP_ALLOWED_HOSTS=' "$ENV_FILE"; then
  set_env SRT_INGRESS_RTMP_ALLOWED_HOSTS ""
fi
set_env SRT_INGRESS_BRIDGE_BASE_URL "http://127.0.0.1:3310"
set_env SRT_INGRESS_PUBLIC_HOST "$PUBLIC_HOST"
set_env SRT_INGRESS_PORT "3310"
set_env LIVEKIT_VOICE_AGENT_NAME "voice-agent-runtime"
set_env VOICE_AGENT_PORT "8082"
set_env CALL_BARGE_IN_MIN_SPEECH_MS "240"
set_env CALL_BARGE_IN_MIN_PROBABILITY "0.5"
set_env CALL_BARGE_IN_COOLDOWN_MS "800"
set_env CALL_BARGE_IN_PRE_ROLL_MS "400"
set_env VOICE_IDENTITY_HTTP_BASE_URL "http://127.0.0.1:8022"
set_env VOICE_IDENTITY_HTTP_TIMEOUT_MS "30000"
REMOTE

ssh "$REMOTE_HOST" "set -euo pipefail
tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3110
tailscale serve --bg --https=443 --set-path=/rtc http://127.0.0.1:7880/rtc
tailscale serve --bg --https=443 --set-path=/twirp http://127.0.0.1:7880/twirp"

if [[ "$MODE" == "sync" ]]; then
  echo "Synced ai phone server source to $REMOTE_HOST:$REMOTE_SOURCE"
  exit 0
fi

remote_compose "build"

if [[ "${MIGRATE_SQLITE:-false}" == "true" ]]; then
  backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  previous_driver="$(ssh "$REMOTE_HOST" \
    "awk -F= '/^API_STORAGE_DRIVER=/{print \$2}' '$REMOTE_RUNTIME/server.env' | tail -1")"
  remote_compose "stop gateway api"
  migration_services_stopped=true
  recover_migration_services() {
    if [[ "$migration_services_stopped" == "true" ]]; then
      remote_compose "start api gateway" || true
    fi
  }
  trap recover_migration_services ERR
  ssh "$REMOTE_HOST" \
    "set -euo pipefail; test -s '$REMOTE_RUNTIME/data/api-store.json'; \
     cp --reflink=auto '$REMOTE_RUNTIME/data/api-store.json' \
       '$REMOTE_RUNTIME/data/api-store.json.backup-$backup_stamp'"
  if [[ "$previous_driver" != "sqlite" ]]; then
    ssh "$REMOTE_HOST" \
      "if test -e '$REMOTE_RUNTIME/data/api-store.sqlite'; then \
         mv '$REMOTE_RUNTIME/data/api-store.sqlite' \
           '$REMOTE_RUNTIME/data/api-store.sqlite.pre-migration-$backup_stamp'; \
       fi"
    remote_compose \
      "run --rm --no-deps api npm run storage:migrate-json -- \
       /data/ai-phone/api-store.json /data/ai-phone/api-store.sqlite"
  fi
  remote_compose \
    "run --rm --no-deps api npm run storage:check -- \
     /data/ai-phone/api-store.sqlite"
  remote_compose \
    "run --rm --no-deps api npm run storage:backup -- \
     /data/ai-phone/api-store.sqlite \
     /data/ai-phone/api-store.sqlite.backup-$backup_stamp"
  ssh "$REMOTE_HOST" "ENV_FILE='$REMOTE_RUNTIME/server.env' bash -s" <<'REMOTE'
set -euo pipefail
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
set_env API_STORAGE_DRIVER sqlite
set_env API_SQLITE_FILE /data/ai-phone/api-store.sqlite
REMOTE
fi

remote_compose "up -d --no-build --remove-orphans"
if [[ "${MIGRATE_SQLITE:-false}" == "true" ]]; then
  migration_services_stopped=false
  trap - ERR
fi
for _ in {1..60}; do
  if curl -fsS "http://$PUBLIC_HOST:3110/health" >/dev/null 2>&1 &&
     curl -fsS "http://$PUBLIC_HOST:3111/health" >/dev/null 2>&1 &&
     NO_PROXY='*' no_proxy='*' curl -fsS "$CALL_PUBLIC_BASE_URL/health" >/dev/null 2>&1; then
    if [[ "${MIGRATE_SQLITE:-false}" == "true" ]]; then
      remote_compose "exec -T api npm run storage:check -- /data/ai-phone/api-store.sqlite"
    fi
    status
    exit 0
  fi
  sleep 2
done
remote_compose "ps"
remote_compose "logs --tail=120 api gateway"
echo "ai phone server deployment did not become healthy" >&2
exit 1
