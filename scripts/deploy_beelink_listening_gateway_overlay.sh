#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-preflight}"
REMOTE_HOST="${REMOTE_HOST:-beelink@100.110.127.117}"
PUBLIC_HOST="${PUBLIC_HOST:-100.110.127.117}"
PUBLIC_DNS="${PUBLIC_DNS:-beelink.tail1e9cec.ts.net}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/ai-phone-server-candidates/listening-gateway-20260724}"
REMOTE_SOURCE="$REMOTE_ROOT/source"
REMOTE_RUNTIME="$REMOTE_ROOT/runtime"
OLD_RUNTIME_ENV="${OLD_RUNTIME_ENV:-/data/models/ai-phone-server-candidates/core-translation-20260721/runtime/server.env}"
ASR_RUNTIME_ENV="${ASR_RUNTIME_ENV:-/data/models/translation-model-eval/candidates/qwen17-moss-listening-20260724/runtime.env}"
CONTAINER_NAME="${CONTAINER_NAME:-ai-phone-listening-gateway-20260724}"
IMAGE_TAG="${IMAGE_TAG:-listening-gateway-20260724-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
OLD_API_PORT="${OLD_API_PORT:-3320}"
OLD_GATEWAY_PORT="${OLD_GATEWAY_PORT:-3321}"
OVERLAY_GATEWAY_PORT="${OVERLAY_GATEWAY_PORT:-3421}"
ASR_PORT="${ASR_PORT:-8121}"
OLD_ASR_ENDPOINT="${OLD_ASR_ENDPOINT:-http://100.110.127.117:8021/asr/transcribe}"
TRANSLATION_SERVICE_URL="${TRANSLATION_SERVICE_URL:-http://127.0.0.1:8003}"
SPEAKER_SERVICE_URL="${SPEAKER_SERVICE_URL:-http://127.0.0.1:8022}"
REQUIRE_SPEAKER="${REQUIRE_SPEAKER:-true}"
LLM_SERVICE_URL="${LLM_SERVICE_URL:-http://127.0.0.1:1234/v1}"
LLM_CORRECTION_MODEL="${LLM_CORRECTION_MODEL:-qwen/qwen3.5-9b}"
REQUIRE_LLM_REVISION="${REQUIRE_LLM_REVISION:-true}"
TAILSCALE_HTTPS_PORT="${TAILSCALE_HTTPS_PORT:-8446}"
OVERLAY_HEALTH_URL="http://$PUBLIC_HOST:$OVERLAY_GATEWAY_PORT/health"
OLD_GATEWAY_HEALTH_URL="http://$PUBLIC_HOST:$OLD_GATEWAY_PORT/health"
PUBLIC_HEALTH_URL="https://$PUBLIC_DNS:$TAILSCALE_HTTPS_PORT/health"

case "$MODE" in
  preflight|deploy|status|rollback) ;;
  *) echo "Usage: $0 [preflight|deploy|status|rollback]" >&2; exit 2 ;;
esac

for value in "$PUBLIC_HOST" "$PUBLIC_DNS"; do
  [[ "$value" =~ ^[A-Za-z0-9.:-]+$ ]] || {
    echo "Public host value contains unsafe characters" >&2
    exit 2
  }
done
[[ "$OLD_ASR_ENDPOINT" =~ ^https?://[A-Za-z0-9.:-]+/[A-Za-z0-9._/-]+$ ]] || {
  echo "OLD_ASR_ENDPOINT must be a simple http(s) URL" >&2
  exit 2
}
for value in "$TRANSLATION_SERVICE_URL" "$SPEAKER_SERVICE_URL"; do
  [[ "$value" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || {
    echo "Model service URL must be a simple http(s) origin: $value" >&2
    exit 2
  }
done
[[ "$LLM_SERVICE_URL" =~ ^https?://[A-Za-z0-9.:-]+/v1$ ]] || {
  echo "LLM_SERVICE_URL must be a simple http(s) /v1 URL" >&2
  exit 2
}
[[ "$REQUIRE_SPEAKER" == "true" || "$REQUIRE_SPEAKER" == "false" ]] || {
  echo "REQUIRE_SPEAKER must be true or false" >&2
  exit 2
}
[[ "$REQUIRE_LLM_REVISION" == "true" ||
   "$REQUIRE_LLM_REVISION" == "false" ]] || {
  echo "REQUIRE_LLM_REVISION must be true or false" >&2
  exit 2
}
[[ "$LLM_CORRECTION_MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]+$ ]] || {
  echo "LLM_CORRECTION_MODEL contains unsafe characters" >&2
  exit 2
}
for value in "$REMOTE_ROOT" "$OLD_RUNTIME_ENV" "$ASR_RUNTIME_ENV"; do
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ && "$value" == *candidate* ]] || {
    echo "Remote path must be an isolated absolute candidate path: $value" >&2
    exit 2
  }
done
for value in "$CONTAINER_NAME" "$IMAGE_TAG"; do
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]+$ ]] || {
    echo "Container/image value contains unsafe characters" >&2
    exit 2
  }
done
for port in \
  "$OLD_API_PORT" "$OLD_GATEWAY_PORT" "$OVERLAY_GATEWAY_PORT" \
  "$ASR_PORT" "$TAILSCALE_HTTPS_PORT"; do
  [[ "$port" =~ ^[0-9]+$ ]] &&
    ((10#$port >= 1 && 10#$port <= 65535)) || {
      echo "Ports must be integers from 1 to 65535" >&2
      exit 2
    }
done

assert_health() {
  local health_url="$1" expected_asr_endpoint="$2"
  local payload
  payload="$(
    curl --noproxy '*' -fsS --retry 3 --retry-all-errors --retry-delay 1 \
      --max-time 8 "$health_url"
  )"
  HEALTH_PAYLOAD="$payload" EXPECTED_ASR_ENDPOINT="$expected_asr_endpoint" \
    node <<'NODE'
const health = JSON.parse(process.env.HEALTH_PAYLOAD);
if (health.status !== "ok" || health.service !== "realtime-gateway") {
  throw new Error("realtime gateway is not healthy");
}
if (health.asrProvider !== "http") {
  throw new Error(`unexpected ASR provider: ${health.asrProvider}`);
}
if (health.asrEndpoint !== process.env.EXPECTED_ASR_ENDPOINT) {
  throw new Error(`unexpected ASR endpoint: ${health.asrEndpoint}`);
}
if (health.sessionEventSink !== "api") {
  throw new Error(`unexpected session event sink: ${health.sessionEventSink}`);
}
NODE
}

assert_model_dependencies() {
  local run_smoke="$1"
  ssh "$REMOTE_HOST" \
    "OLD_RUNTIME_ENV='$OLD_RUNTIME_ENV' \
     TRANSLATION_SERVICE_URL='$TRANSLATION_SERVICE_URL' \
     SPEAKER_SERVICE_URL='$SPEAKER_SERVICE_URL' \
     REQUIRE_SPEAKER='$REQUIRE_SPEAKER' \
     LLM_SERVICE_URL='$LLM_SERVICE_URL' \
     LLM_CORRECTION_MODEL='$LLM_CORRECTION_MODEL' \
     REQUIRE_LLM_REVISION='$REQUIRE_LLM_REVISION' \
     RUN_SMOKE='$run_smoke' \
     python3 -" <<'PYTHON'
import json
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def read_env(path):
    values = {}
    with open(path, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.removeprefix("export ").split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def request_json(url, *, api_key="", payload=None, expected_status=200):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    request = Request(
        url,
        data=body,
        headers=headers,
        method="POST" if body is not None else "GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            if response.status != expected_status:
                raise RuntimeError(f"{url} returned HTTP {response.status}")
            content = response.read()
    except HTTPError as error:
        raise RuntimeError(f"{url} returned HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"{url} is unreachable: {error.reason}") from error
    return json.loads(content) if content else None


def delete(url, *, api_key):
    request = Request(
        url,
        headers={"authorization": f"Bearer {api_key}"},
        method="DELETE",
    )
    try:
        with urlopen(request, timeout=10) as response:
            if response.status != 204:
                raise RuntimeError(f"{url} returned HTTP {response.status}")
    except HTTPError as error:
        raise RuntimeError(f"{url} returned HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"{url} is unreachable: {error.reason}") from error


env = read_env(os.environ["OLD_RUNTIME_ENV"])
translation_url = os.environ["TRANSLATION_SERVICE_URL"].rstrip("/")
speaker_url = os.environ["SPEAKER_SERVICE_URL"].rstrip("/")
require_speaker = os.environ["REQUIRE_SPEAKER"] == "true"
llm_url = os.environ["LLM_SERVICE_URL"].rstrip("/")
llm_model = os.environ["LLM_CORRECTION_MODEL"]
require_llm = os.environ["REQUIRE_LLM_REVISION"] == "true"
run_smoke = os.environ["RUN_SMOKE"] == "true"
translation_model = env.get("TRANSLATION_MODEL", "")
translation_key = env.get("TRANSLATION_API_KEY", "")
speaker_key = env.get("SPEAKER_HTTP_API_KEY", "")

if not translation_model:
    raise RuntimeError("TRANSLATION_MODEL is missing from the gateway runtime env")
if not translation_key:
    raise RuntimeError("TRANSLATION_API_KEY is missing from the gateway runtime env")
if require_speaker and not speaker_key:
    raise RuntimeError("SPEAKER_HTTP_API_KEY is missing from the gateway runtime env")

translation_health = request_json(f"{translation_url}/health")
if (
    translation_health.get("status") != "ok"
    or translation_health.get("available") is not True
    or translation_health.get("modelVersion") != translation_model
):
    raise RuntimeError("Hy-MT2 translation health contract did not pass")

speaker_health = None
if require_speaker:
    speaker_health = request_json(f"{speaker_url}/health")
    if (
        speaker_health.get("status") != "ok"
        or speaker_health.get("mode") not in {"active", "shadow"}
        or speaker_health.get("provider") in {"", "mock"}
    ):
        raise RuntimeError("meeting speaker health contract did not pass")

summary = {
    "translation": {
        "status": "pass",
        "model": translation_model,
        "provider": translation_health.get("provider"),
    },
    "speaker": (
        {
            "status": "pass",
            "provider": speaker_health.get("provider"),
            "mode": speaker_health.get("mode"),
        }
        if speaker_health
        else {"status": "not-required"}
    ),
    "llmRevision": {"status": "not-required"},
    "smoke": "skipped",
}

if require_llm:
    llm_models = request_json(f"{llm_url}/models")
    llm_model_ids = {
        model.get("id")
        for model in llm_models.get("data", [])
        if isinstance(model, dict)
    }
    if llm_model not in llm_model_ids:
        raise RuntimeError("configured LLM revision model is absent from /v1/models")
    revision_source = "预算是二十万元，型号 A-120。"
    revision_started = time.monotonic()
    revision_completion = request_json(
        f"{llm_url}/chat/completions",
        payload={
            "model": llm_model,
            "temperature": 0,
            "max_tokens": 128,
            "reasoning_effort": "none",
            "enable_thinking": False,
            "chat_template_kwargs": {"enable_thinking": False},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是 ASR 文本纠错器。只输出 JSON 对象，字段为 "
                        "optimizedText, confidence, operations, "
                        "protectedTermsKept, warnings。不得改动数字、金额或型号。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"rawText": revision_source},
                        ensure_ascii=False,
                    ),
                },
            ],
        },
    )
    try:
        revision_content = revision_completion["choices"][0]["message"]["content"]
        revision = json.loads(revision_content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise RuntimeError("LLM revision smoke returned invalid JSON") from error
    if revision.get("optimizedText") != revision_source:
        raise RuntimeError("LLM revision smoke changed protected numeric entities")
    summary["llmRevision"] = {
        "status": "pass",
        "model": llm_model,
        "latencyMs": round((time.monotonic() - revision_started) * 1000, 3),
    }

if run_smoke:
    models = request_json(f"{translation_url}/v1/models", api_key=translation_key)
    model_ids = {
        model.get("id")
        for model in models.get("data", [])
        if isinstance(model, dict)
    }
    if translation_model not in model_ids:
        raise RuntimeError("configured Hy-MT2 model is absent from /v1/models")

    source = "API 订单 A-120 的金额是 20,000 元。"
    started = time.monotonic()
    completion = request_json(
        f"{translation_url}/v1/chat/completions",
        api_key=translation_key,
        payload={
            "model": translation_model,
            "temperature": 0,
            "max_tokens": 128,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Translate the user text into English. "
                        "Return only the translation."
                    ),
                },
                {"role": "user", "content": source},
            ],
        },
    )
    try:
        translated = completion["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, AttributeError) as error:
        raise RuntimeError("Hy-MT2 smoke returned no translation text") from error
    if not translated or translated == source:
        raise RuntimeError("Hy-MT2 smoke returned an empty or untranslated result")
    for entity in ("API", "A-120", "20,000"):
        if re.search(re.escape(entity), translated, re.IGNORECASE) is None:
            raise RuntimeError(f"Hy-MT2 smoke lost protected entity {entity}")

    if require_speaker:
        session_id = f"deploy-gate-{int(time.time() * 1000)}"
        try:
            request_json(
                f"{speaker_url}/speaker/sessions",
                api_key=speaker_key,
                payload={
                    "sessionId": session_id,
                    "options": {
                        "mode": "diarization",
                        "maxSpeakers": 4,
                        "allowVoiceIdentity": False,
                    },
                },
                expected_status=204,
            )
        finally:
            delete(
                f"{speaker_url}/speaker/sessions/{session_id}",
                api_key=speaker_key,
            )

    summary["smoke"] = "pass"
    summary["translation"]["latencyMs"] = round(
        (time.monotonic() - started) * 1000,
        3,
    )
    summary["translation"]["text"] = translated

print(json.dumps(summary, ensure_ascii=False))
PYTHON
}

preflight() {
  ssh "$REMOTE_HOST" \
    "set -e
     test -f '$OLD_RUNTIME_ENV'
     test -f '$ASR_RUNTIME_ENV'
     systemctl --user is-active --quiet ai-phone-asr-listening-candidate.service
     systemctl --user is-active --quiet ai-phone-moss-revision-candidate.service
     curl -fsS --max-time 5 http://127.0.0.1:$ASR_PORT/health >/dev/null
     curl -fsS --max-time 5 http://127.0.0.1:$OLD_API_PORT/health >/dev/null
     curl -fsS --max-time 5 http://127.0.0.1:$OLD_GATEWAY_PORT/health >/dev/null
     if ss -lntH 'sport = :$OVERLAY_GATEWAY_PORT' | grep -q . &&
        ! docker ps --format '{{.Names}}' | grep -Fxq '$CONTAINER_NAME'; then
       echo 'Overlay port $OVERLAY_GATEWAY_PORT is owned by another process' >&2
       exit 1
     fi"
  assert_health \
    "$OLD_GATEWAY_HEALTH_URL" \
    "$OLD_ASR_ENDPOINT"
  assert_model_dependencies true
  echo "Listening gateway overlay preflight passed."
}

status() {
  ssh "$REMOTE_HOST" \
    "docker ps --filter name=^/$CONTAINER_NAME$ \
       --format '{{.Names}} {{.Image}} {{.Status}}'
     tailscale serve status"
  assert_health \
    "$OLD_GATEWAY_HEALTH_URL" \
    "$OLD_ASR_ENDPOINT"
  assert_health \
    "$OVERLAY_HEALTH_URL" \
    "http://127.0.0.1:$ASR_PORT/asr/transcribe"
  assert_health \
    "$PUBLIC_HEALTH_URL" \
    "http://127.0.0.1:$ASR_PORT/asr/transcribe"
  assert_model_dependencies false
  echo "Listening gateway overlay is live on $PUBLIC_HEALTH_URL"
}

rollback() {
  ssh "$REMOTE_HOST" \
    "set -e
     tailscale serve --yes --bg --https=$TAILSCALE_HTTPS_PORT \
       http://127.0.0.1:$OLD_GATEWAY_PORT
     curl -fsS --max-time 8 \
       https://$PUBLIC_DNS:$TAILSCALE_HTTPS_PORT/health >/dev/null
     if docker ps -a --format '{{.Names}}' | grep -Fxq '$CONTAINER_NAME'; then
       docker rm -f '$CONTAINER_NAME' >/dev/null
     fi"
  assert_health \
    "$PUBLIC_HEALTH_URL" \
    "$OLD_ASR_ENDPOINT"
  echo "8446 restored to the old gateway; overlay container removed."
}

if [[ "$MODE" == "preflight" ]]; then
  preflight
  exit 0
fi
if [[ "$MODE" == "status" ]]; then
  status
  exit 0
fi
if [[ "$MODE" == "rollback" ]]; then
  rollback
  exit 0
fi

preflight
npm --prefix "$ROOT_DIR" run check:source-build -- --json
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_SOURCE' '$REMOTE_RUNTIME'"
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

ssh "$REMOTE_HOST" \
  "REMOTE_ROOT='$REMOTE_ROOT' REMOTE_SOURCE='$REMOTE_SOURCE' \
   REMOTE_RUNTIME='$REMOTE_RUNTIME' OLD_RUNTIME_ENV='$OLD_RUNTIME_ENV' \
   ASR_RUNTIME_ENV='$ASR_RUNTIME_ENV' CONTAINER_NAME='$CONTAINER_NAME' \
   IMAGE_TAG='$IMAGE_TAG' OLD_API_PORT='$OLD_API_PORT' \
   OVERLAY_GATEWAY_PORT='$OVERLAY_GATEWAY_PORT' ASR_PORT='$ASR_PORT' \
   LLM_SERVICE_URL='$LLM_SERVICE_URL' \
   LLM_CORRECTION_MODEL='$LLM_CORRECTION_MODEL' \
   bash -s" <<'REMOTE'
set -euo pipefail
umask 077
next="$REMOTE_RUNTIME/server.env.next"
target="$REMOTE_RUNTIME/server.env"
install -m 600 "$OLD_RUNTIME_ENV" "$next"
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$next"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$next"
  else
    printf '%s=%s\n' "$key" "$value" >>"$next"
  fi
}
asr_api_key="$(
  awk -F= '$1 == "ASR_SERVICE_API_KEY" {
    print substr($0, index($0, "=") + 1)
    exit
  }' "$ASR_RUNTIME_ENV"
)"
test "${#asr_api_key}" -ge 16
set_env NODE_ENV production
set_env API_BASE_URL "http://127.0.0.1:$OLD_API_PORT"
set_env REALTIME_BIND_HOST 0.0.0.0
set_env REALTIME_PORT "$OVERLAY_GATEWAY_PORT"
set_env GATEWAY_HEALTH_URL "http://127.0.0.1:$OVERLAY_GATEWAY_PORT/health"
set_env ASR_PROVIDER http
set_env ASR_HTTP_ENDPOINT "http://127.0.0.1:$ASR_PORT/asr/transcribe"
set_env ASR_HTTP_FLUSH_ENDPOINT \
  "http://127.0.0.1:$ASR_PORT/asr/sessions/:sessionId/flush"
set_env ASR_HTTP_HEALTH_URL "http://127.0.0.1:$ASR_PORT/health"
set_env ASR_HTTP_API_KEY "$asr_api_key"
set_env ASR_HTTP_TIMEOUT_MS 30000
set_env LLM_BASE_URL "$LLM_SERVICE_URL"
set_env LLM_CORRECTION_MODEL "$LLM_CORRECTION_MODEL"
set_env SESSION_EVENT_SINK api
set_env DEPLOYMENT_ENVIRONMENT listening-gateway-overlay-candidate
chmod 600 "$next"
if [[ -f "$target" ]]; then
  install -m 600 "$target" "$REMOTE_RUNTIME/server.env.rollback"
fi
mv -f "$next" "$target"
if [[ ! -f "$REMOTE_RUNTIME/tailscale-serve.before.txt" ]]; then
  tailscale serve status >"$REMOTE_RUNTIME/tailscale-serve.before.txt"
  chmod 600 "$REMOTE_RUNTIME/tailscale-serve.before.txt"
fi
docker build \
  -f "$REMOTE_SOURCE/infra/ai-phone-server/Dockerfile" \
  -t "ai-phone-server:$IMAGE_TAG" \
  "$REMOTE_SOURCE"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi
docker run -d \
  --name "$CONTAINER_NAME" \
  --network host \
  --env-file "$REMOTE_RUNTIME/server.env" \
  --restart unless-stopped \
  "ai-phone-server:$IMAGE_TAG" \
  node services/realtime-gateway/dist/main.js >/dev/null
REMOTE

for _ in {1..60}; do
  if curl -fsS --max-time 3 "$OVERLAY_HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
assert_health \
  "$OVERLAY_HEALTH_URL" \
  "http://127.0.0.1:$ASR_PORT/asr/transcribe"

ssh "$REMOTE_HOST" \
  "tailscale serve --yes --bg --https=$TAILSCALE_HTTPS_PORT \
     http://127.0.0.1:$OVERLAY_GATEWAY_PORT"
for _ in {1..15}; do
  if curl -fsS --max-time 5 "$PUBLIC_HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
status
