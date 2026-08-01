#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-status}"
REMOTE_HOST="${REMOTE_HOST:-beelink@100.110.127.117}"
PUBLIC_HOST="${PUBLIC_HOST:-100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/translation-model-eval/candidates/qwen17-moss-listening-20260724}"
REMOTE_SOURCE="$REMOTE_ROOT/source"
REMOTE_ENV="$REMOTE_ROOT/runtime.env"
MOSS_REMOTE_ENV="$REMOTE_ROOT/moss-runtime.env"
ROLLBACK_ENV="$REMOTE_ROOT/rollback.env"
SERVICE_NAME="${SERVICE_NAME:-ai-phone-asr-listening-candidate.service}"
MOSS_SERVICE_NAME="${MOSS_SERVICE_NAME:-ai-phone-moss-revision-candidate.service}"
ASR_PORT="${ASR_PORT:-8121}"
MOSS_PORT="${MOSS_PORT:-8122}"
REMOTE_PYTHON="${REMOTE_PYTHON:-/data/models/translation-model-eval/data/unified-multilingual-eval/experiments/asr-replacement-ab-v1-20260723/runtime/qwen-asr-vllm014/bin/python}"
MOSS_REMOTE_PYTHON="${MOSS_REMOTE_PYTHON:-/data/models/translation-model-eval/isolated/moss-transcribe-diarize/runtime/venv/bin/python}"
QWEN17_MODEL_PATH="${QWEN17_MODEL_PATH:-/data/models/translation-model-eval/data/unified-multilingual-eval/experiments/asr-replacement-ab-v1-20260723/models/qwen3_asr_1_7b_modelscope}"
MOSS_MODEL_PATH="${MOSS_MODEL_PATH:-/data/models/translation-model-eval/isolated/moss-transcribe-diarize/models/MOSS-Transcribe-Diarize}"
MOSS_SOURCE_ROOT="${MOSS_SOURCE_ROOT:-/data/models/translation-model-eval/isolated/moss-transcribe-diarize/sources/MOSS-Transcribe-Diarize}"
VAD_MODEL_PATH="${VAD_MODEL_PATH:-/data/models/translation-model-eval/models/frame_vad_multilingual_marblenet_v2/frame_vad_multilingual_marblenet_v2.0.onnx}"
VAD_ASSETS_PATH="${VAD_ASSETS_PATH:-/data/models/translation-model-eval/models/frame_vad_multilingual_marblenet_v2/frame_vad_multilingual_marblenet_v2.0.preprocessor.npz}"
ONNXRUNTIME_SITE_PACKAGES="${ONNXRUNTIME_SITE_PACKAGES:-/data/models/translation-model-eval/.venv/lib/python3.12/site-packages}"
DIAGNOSTIC_CAPTURE_DIR="${DIAGNOSTIC_CAPTURE_DIR:-}"
DIAGNOSTIC_CAPTURE_MAX_SESSIONS="${DIAGNOSTIC_CAPTURE_MAX_SESSIONS:-0}"
DIAGNOSTIC_CAPTURE_MAX_SECONDS="${DIAGNOSTIC_CAPTURE_MAX_SECONDS:-60}"
OCR_SERVICE="${OCR_SERVICE:-engineering-kb-unlimited-ocr.service}"
LM_MODEL_VARIANT="${LM_MODEL_VARIANT:-qwen/qwen3.5-9b@q6_k}"
LM_MODEL_IDENTIFIER="${LM_MODEL_IDENTIFIER:-qwen/qwen3.5-9b}"
LM_CONTEXT_LENGTH="${LM_CONTEXT_LENGTH:-16384}"
LM_PARALLEL="${LM_PARALLEL:-1}"

case "$MODE" in
  preflight|deploy|status|rollback) ;;
  *) echo "Usage: $0 [preflight|deploy|status|rollback]" >&2; exit 2 ;;
esac

[[ "$REMOTE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ &&
   "$REMOTE_ROOT" == *candidate* ]] || {
  echo "REMOTE_ROOT must be an isolated candidate path" >&2
  exit 2
}
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9@_.-]+\.service$ &&
   "$SERVICE_NAME" == *candidate* ]] || {
  echo "SERVICE_NAME must be an isolated candidate unit" >&2
  exit 2
}
[[ "$MOSS_SERVICE_NAME" =~ ^[A-Za-z0-9@_.-]+\.service$ &&
   "$MOSS_SERVICE_NAME" == *candidate* ]] || {
  echo "MOSS_SERVICE_NAME must be an isolated candidate unit" >&2
  exit 2
}
[[ "$ASR_PORT" =~ ^[0-9]+$ ]] && (( ASR_PORT >= 1024 && ASR_PORT <= 65535 )) || {
  echo "ASR_PORT must be an unprivileged TCP port" >&2
  exit 2
}
[[ "$MOSS_PORT" =~ ^[0-9]+$ ]] && (( MOSS_PORT >= 1024 && MOSS_PORT <= 65535 )) || {
  echo "MOSS_PORT must be an unprivileged TCP port" >&2
  exit 2
}
[[ "$ASR_PORT" != "$MOSS_PORT" ]] || {
  echo "ASR_PORT and MOSS_PORT must be distinct" >&2
  exit 2
}
case "$ASR_PORT" in
  1234|8002|8003|8021) echo "ASR_PORT conflicts with a protected service" >&2; exit 2 ;;
esac
case "$MOSS_PORT" in
  1234|8002|8003|8021) echo "MOSS_PORT conflicts with a protected service" >&2; exit 2 ;;
esac
for path in \
  "$VAD_MODEL_PATH" "$VAD_ASSETS_PATH" "$ONNXRUNTIME_SITE_PACKAGES"; do
  [[ "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || {
    echo "VAD runtime paths must be simple absolute paths" >&2
    exit 2
  }
done
if [[ -n "$DIAGNOSTIC_CAPTURE_DIR" ]]; then
  [[ "$DIAGNOSTIC_CAPTURE_DIR" =~ ^/[A-Za-z0-9._/-]+$ &&
     "$DIAGNOSTIC_CAPTURE_DIR" == "$REMOTE_ROOT"/diagnostic-captures/* ]] || {
    echo "DIAGNOSTIC_CAPTURE_DIR must stay under the candidate root" >&2
    exit 2
  }
fi
[[ "$DIAGNOSTIC_CAPTURE_MAX_SESSIONS" =~ ^[0-9]+$ ]] &&
  (( DIAGNOSTIC_CAPTURE_MAX_SESSIONS <= 10 )) || {
    echo "DIAGNOSTIC_CAPTURE_MAX_SESSIONS must be between 0 and 10" >&2
    exit 2
  }
[[ "$DIAGNOSTIC_CAPTURE_MAX_SECONDS" =~ ^[0-9]+$ ]] &&
  (( DIAGNOSTIC_CAPTURE_MAX_SECONDS >= 1 &&
     DIAGNOSTIC_CAPTURE_MAX_SECONDS <= 120 )) || {
    echo "DIAGNOSTIC_CAPTURE_MAX_SECONDS must be between 1 and 120" >&2
    exit 2
  }

preflight() {
  test -d "$ROOT_DIR/services/model-services/qwen17-moss-listening-candidate"
  ssh "$REMOTE_HOST" \
    "test -x '$REMOTE_PYTHON' &&
     test -x '$MOSS_REMOTE_PYTHON' &&
     test -d '$QWEN17_MODEL_PATH' &&
     test -d '$MOSS_MODEL_PATH' &&
     test -d '$MOSS_SOURCE_ROOT' &&
     test -f '$VAD_MODEL_PATH' &&
     test -f '$VAD_ASSETS_PATH' &&
     test -d '$ONNXRUNTIME_SITE_PACKAGES' &&
     '$REMOTE_PYTHON' -c \"import sys; sys.path.append('$ONNXRUNTIME_SITE_PACKAGES'); import onnxruntime\" &&
     for spec in '$ASR_PORT:$SERVICE_NAME' '$MOSS_PORT:$MOSS_SERVICE_NAME'; do
       port=\"\${spec%%:*}\"; unit=\"\${spec#*:}\"
       if ss -ltn | grep -q \":\$port \"; then
         systemctl --user is-active --quiet \"\$unit\"
       fi
     done"
}

status() {
  ssh "$REMOTE_HOST" \
    "systemctl --user --no-pager --full status '$SERVICE_NAME' | sed -n '1,16p';
     systemctl --user --no-pager --full status '$MOSS_SERVICE_NAME' | sed -n '1,16p'"
  curl -fsS --max-time 5 "http://$PUBLIC_HOST:$ASR_PORT/health"
  echo
  ssh "$REMOTE_HOST" \
    "nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv,noheader;
     systemctl --user is-active '$OCR_SERVICE' || true;
     ~/.lmstudio/bin/lms ps --json 2>/dev/null || true"
}

rollback() {
  ssh "$REMOTE_HOST" \
    "SERVICE_NAME='$SERVICE_NAME' MOSS_SERVICE_NAME='$MOSS_SERVICE_NAME' \
     ROLLBACK_ENV='$ROLLBACK_ENV' \
     OCR_SERVICE='$OCR_SERVICE' LM_MODEL_VARIANT='$LM_MODEL_VARIANT' \
     LM_MODEL_IDENTIFIER='$LM_MODEL_IDENTIFIER' \
     LM_CONTEXT_LENGTH='$LM_CONTEXT_LENGTH' LM_PARALLEL='$LM_PARALLEL' \
     bash -s" <<'REMOTE'
set -euo pipefail
systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable --now "$MOSS_SERVICE_NAME" 2>/dev/null || true
if [ -f "$ROLLBACK_ENV" ]; then
  # shellcheck disable=SC1090
  source "$ROLLBACK_ENV"
  if [ "${OCR_WAS_ACTIVE:-false}" = "true" ]; then
    systemctl --user start "$OCR_SERVICE"
  fi
  if [ "${LM_MODEL_WAS_LOADED:-false}" = "true" ]; then
    ~/.lmstudio/bin/lms load "$LM_MODEL_VARIANT" \
      --identifier "$LM_MODEL_IDENTIFIER" \
      --context-length "$LM_CONTEXT_LENGTH" \
      --parallel "$LM_PARALLEL" \
      --gpu max --yes
  fi
fi
REMOTE
  echo "Candidate stopped; prior OCR and LM Studio state restored when recorded."
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
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_SOURCE' '$REMOTE_ROOT'"
rsync -az --delete \
  --exclude='__pycache__/' \
  --exclude='.pytest_cache/' \
  "$ROOT_DIR/services/model-services/qwen17-moss-listening-candidate/" \
  "$REMOTE_HOST:$REMOTE_SOURCE/"

ssh "$REMOTE_HOST" \
  "REMOTE_ROOT='$REMOTE_ROOT' REMOTE_SOURCE='$REMOTE_SOURCE' \
   REMOTE_ENV='$REMOTE_ENV' MOSS_REMOTE_ENV='$MOSS_REMOTE_ENV' \
   ROLLBACK_ENV='$ROLLBACK_ENV' REMOTE_PYTHON='$REMOTE_PYTHON' \
   MOSS_REMOTE_PYTHON='$MOSS_REMOTE_PYTHON' SERVICE_NAME='$SERVICE_NAME' \
   MOSS_SERVICE_NAME='$MOSS_SERVICE_NAME' ASR_PORT='$ASR_PORT' \
   MOSS_PORT='$MOSS_PORT' QWEN17_MODEL_PATH='$QWEN17_MODEL_PATH' \
   MOSS_MODEL_PATH='$MOSS_MODEL_PATH' MOSS_SOURCE_ROOT='$MOSS_SOURCE_ROOT' \
   VAD_MODEL_PATH='$VAD_MODEL_PATH' VAD_ASSETS_PATH='$VAD_ASSETS_PATH' \
   ONNXRUNTIME_SITE_PACKAGES='$ONNXRUNTIME_SITE_PACKAGES' \
   DIAGNOSTIC_CAPTURE_DIR='$DIAGNOSTIC_CAPTURE_DIR' \
   DIAGNOSTIC_CAPTURE_MAX_SESSIONS='$DIAGNOSTIC_CAPTURE_MAX_SESSIONS' \
   DIAGNOSTIC_CAPTURE_MAX_SECONDS='$DIAGNOSTIC_CAPTURE_MAX_SECONDS' \
   OCR_SERVICE='$OCR_SERVICE' \
   bash -s" <<'REMOTE'
set -euo pipefail
unit_dir="$HOME/.config/systemd/user"
unit_path="$unit_dir/$SERVICE_NAME"
moss_unit_path="$unit_dir/$MOSS_SERVICE_NAME"
mkdir -p "$unit_dir"
umask 077
if [ -n "$DIAGNOSTIC_CAPTURE_DIR" ]; then
  mkdir -p "$DIAGNOSTIC_CAPTURE_DIR"
  chmod 700 "$DIAGNOSTIC_CAPTURE_DIR"
fi

if [ ! -f "$ROLLBACK_ENV" ]; then
  ocr_active=false
  systemctl --user is-active --quiet "$OCR_SERVICE" && ocr_active=true
  lm_loaded=false
  if ~/.lmstudio/bin/lms ps --json 2>/dev/null |
    grep -q '"identifier":"qwen/qwen3.5-9b"'; then
    lm_loaded=true
  fi
  printf 'OCR_WAS_ACTIVE=%s\nLM_MODEL_WAS_LOADED=%s\n' \
    "$ocr_active" "$lm_loaded" >"$ROLLBACK_ENV"
  chmod 600 "$ROLLBACK_ENV"
fi

systemctl --user stop "$OCR_SERVICE" 2>/dev/null || true
~/.lmstudio/bin/lms unload qwen/qwen3.5-9b >/dev/null 2>&1 || true

asr_key=""
if [ -f "$REMOTE_ENV" ]; then
  asr_key="$(
    awk -F= '$1 == "ASR_SERVICE_API_KEY" { print substr($0, index($0, "=") + 1); exit }' \
      "$REMOTE_ENV"
  )"
fi
if [ -z "$asr_key" ]; then
  asr_key="$(openssl rand -hex 24)"
fi
moss_key=""
if [ -f "$MOSS_REMOTE_ENV" ]; then
  moss_key="$(
    awk -F= '$1 == "MOSS_WORKER_API_KEY" { print substr($0, index($0, "=") + 1); exit }' \
      "$MOSS_REMOTE_ENV"
  )"
fi
if [ -z "$moss_key" ]; then
  moss_key="$(openssl rand -hex 24)"
fi
cat >"$REMOTE_ENV" <<EOF
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
CUDA_VISIBLE_DEVICES=0
ASR_SERVICE_API_KEY=$asr_key
QWEN17_MODEL_PATH=$QWEN17_MODEL_PATH
QWEN17_GPU_MEMORY_UTILIZATION=0.5
QWEN17_MAX_MODEL_LEN=8192
QWEN17_MAX_NEW_TOKENS=64
QWEN17_FINAL_MAX_NEW_TOKENS=256
QWEN17_UNFIXED_CHUNK_NUM=7
QWEN17_UNFIXED_TOKEN_NUM=5
MOSS_WORKER_URL=http://127.0.0.1:$MOSS_PORT/revision
MOSS_WORKER_API_KEY=$moss_key
MOSS_WORKER_TIMEOUT_SECONDS=15
ASR_LISTENING_ENDPOINT_SILENCE_MS=1400
ASR_LISTENING_MAX_AUDIO_MS=10000
ASR_LISTENING_PREROLL_MS=400
ASR_LISTENING_REVISION_PREROLL_MS=1500
ASR_LISTENING_VAD_PROVIDER=marblenet
ASR_LISTENING_VAD_MODEL_PATH=$VAD_MODEL_PATH
ASR_LISTENING_VAD_ASSETS_PATH=$VAD_ASSETS_PATH
ASR_LISTENING_ONNXRUNTIME_SITE_PACKAGES=$ONNXRUNTIME_SITE_PACKAGES
ASR_LISTENING_VAD_THRESHOLD=0.05
ASR_LISTENING_VAD_WINDOW_MS=1000
ASR_LISTENING_VAD_SMOOTHING_FRAMES=3
ASR_LISTENING_VAD_RMS_THRESHOLD=20
ASR_LISTENING_DIAGNOSTIC_CAPTURE_DIR=$DIAGNOSTIC_CAPTURE_DIR
ASR_LISTENING_DIAGNOSTIC_CAPTURE_MAX_SESSIONS=$DIAGNOSTIC_CAPTURE_MAX_SESSIONS
ASR_LISTENING_DIAGNOSTIC_CAPTURE_MAX_SECONDS=$DIAGNOSTIC_CAPTURE_MAX_SECONDS
EOF
chmod 600 "$REMOTE_ENV"
cat >"$MOSS_REMOTE_ENV" <<EOF
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
CUDA_VISIBLE_DEVICES=0
MOSS_WORKER_API_KEY=$moss_key
MOSS_MODEL_PATH=$MOSS_MODEL_PATH
MOSS_SOURCE_ROOT=$MOSS_SOURCE_ROOT
EOF
chmod 600 "$MOSS_REMOTE_ENV"

cat >"$unit_path" <<EOF
[Unit]
Description=AI phone isolated Qwen 1.7 plus MOSS listening candidate
After=network-online.target
Wants=network-online.target
Requires=$MOSS_SERVICE_NAME
After=$MOSS_SERVICE_NAME

[Service]
Type=simple
WorkingDirectory=$REMOTE_SOURCE
EnvironmentFile=$REMOTE_ENV
Environment=PYTHONUNBUFFERED=1
ExecStart=$REMOTE_PYTHON -m uvicorn candidate_service.app:app --host 0.0.0.0 --port $ASR_PORT
Restart=on-failure
RestartSec=3
TimeoutStartSec=300
TimeoutStopSec=30
KillMode=mixed
StandardOutput=append:$REMOTE_ROOT/service.log
StandardError=append:$REMOTE_ROOT/service.log

[Install]
WantedBy=default.target
EOF
cat >"$moss_unit_path" <<EOF
[Unit]
Description=AI phone isolated MOSS revision candidate worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_SOURCE
EnvironmentFile=$MOSS_REMOTE_ENV
Environment=PYTHONUNBUFFERED=1
ExecStart=$MOSS_REMOTE_PYTHON -m uvicorn candidate_service.moss_worker_app:app --host 127.0.0.1 --port $MOSS_PORT
Restart=on-failure
RestartSec=3
TimeoutStartSec=300
TimeoutStopSec=30
KillMode=mixed
StandardOutput=append:$REMOTE_ROOT/moss-worker.log
StandardError=append:$REMOTE_ROOT/moss-worker.log

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$MOSS_SERVICE_NAME"
systemctl --user restart "$MOSS_SERVICE_NAME"
REMOTE

for _ in {1..150}; do
  if ssh "$REMOTE_HOST" \
    "curl -fsS --max-time 3 http://127.0.0.1:$MOSS_PORT/health" |
    python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("ready") is True else 1)' \
    2>/dev/null; then
    break
  fi
  sleep 2
done
ssh "$REMOTE_HOST" \
  "curl -fsS --max-time 3 http://127.0.0.1:$MOSS_PORT/health" >/dev/null
ssh "$REMOTE_HOST" \
  "systemctl --user enable '$SERVICE_NAME' &&
   systemctl --user restart '$SERVICE_NAME'"

for _ in {1..150}; do
  if health="$(curl -fsS --max-time 3 "http://$PUBLIC_HOST:$ASR_PORT/health" 2>/dev/null)" &&
     HEALTH="$health" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ["HEALTH"])
vad = payload.get("vad") or {}
raise SystemExit(
    0
    if payload.get("ready") is True
    and vad.get("configuredProvider") == "marblenet"
    and vad.get("activeProvider") == "marblenet"
    else 1
)
PY
  then
    status
    exit 0
  fi
  sleep 2
done
ssh "$REMOTE_HOST" \
  "journalctl --user -u '$SERVICE_NAME' -u '$MOSS_SERVICE_NAME' -n 160 --no-pager" >&2
exit 1
