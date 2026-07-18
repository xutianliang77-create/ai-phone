#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEELINK_HOST="${BEELINK_HOST:-beelink@100.110.127.117}"
BEELINK_IP="${BEELINK_TAILSCALE_IP:-100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/translation-model-eval}"
REMOTE_PYTHON="${REMOTE_PYTHON:-$REMOTE_ROOT/.venv/bin/python}"
SPEAKER_REMOTE_PYTHON="${SPEAKER_REMOTE_PYTHON:-$REMOTE_ROOT/.venv-speaker/bin/python}"
SPEAKER_SERVICE_ENABLED="${SPEAKER_SERVICE_ENABLED:-false}"
VOICE_IDENTITY_ENABLED="${VOICE_IDENTITY_ENABLED:-false}"

ASR_SERVICE_PROVIDER="${ASR_SERVICE_PROVIDER:-qwen3_asr}"
if [ "$ASR_SERVICE_PROVIDER" = "qwen3_asr" ]; then
  DEFAULT_ASR_PORT=8021
  DEFAULT_ASR_SERVICE_DIR="$REMOTE_ROOT/services/asr-service-qwen3"
  DEFAULT_ASR_MODEL_DIR="$REMOTE_ROOT/models/qwen3_asr_0_6b"
  DEFAULT_ASR_MODEL_VERSION="Qwen3-ASR-0.6B-original-tuned-v3"
else
  DEFAULT_ASR_PORT=8001
  DEFAULT_ASR_SERVICE_DIR="$REMOTE_ROOT/services/asr-service"
  DEFAULT_ASR_MODEL_DIR="$REMOTE_ROOT/models/fireredasr2_aed"
  DEFAULT_ASR_MODEL_VERSION="FireRedASR2-AED"
fi

ASR_MODEL_VERSION="${ASR_MODEL_VERSION:-$DEFAULT_ASR_MODEL_VERSION}"
ASR_PORT="${ASR_PORT:-$DEFAULT_ASR_PORT}"
TRANSLATION_PORT="${TRANSLATION_PORT:-8003}"
TTS_PORT="${TTS_PORT:-8002}"
SPEAKER_PORT="${SPEAKER_PORT:-8022}"

ASR_SERVICE_DIR="${ASR_SERVICE_DIR:-$DEFAULT_ASR_SERVICE_DIR}"
TRANSLATION_SERVICE_DIR="$REMOTE_ROOT/services/translation-service"
TTS_SERVICE_DIR="$REMOTE_ROOT/services/tts-service"
SPEAKER_SERVICE_DIR="$REMOTE_ROOT/services/speaker-service"

ASR_MODEL_DIR="${ASR_MODEL_DIR:-$DEFAULT_ASR_MODEL_DIR}"
TRANSLATION_MODEL_DIR="${TRANSLATION_MODEL_DIR:-$REMOTE_ROOT/data/translation-product-fit/models/hymt2_1_8b}"
TTS_MODEL_DIR="${TTS_MODEL_DIR:-$REMOTE_ROOT/data/tts-product-fit/models/openbmb_voxcpm2}"
TTS_VOICE_REFERENCE_DIR="${TTS_VOICE_REFERENCE_DIR:-/data/models/ai-phone-server/runtime/data/voice-references}"
TTS_VOICE_PRESET_MANIFEST="${TTS_VOICE_PRESET_MANIFEST:-$TTS_SERVICE_DIR/voice-presets.json}"

ASR_SERVICE_API_KEY="${ASR_SERVICE_API_KEY:-local-asr-service-api-key}"
TRANSLATION_SERVICE_API_KEY="${TRANSLATION_SERVICE_API_KEY:-local-translation-service-api-key}"
TTS_SERVICE_API_KEY="${TTS_SERVICE_API_KEY:-local-tts-service-api-key}"
SPEAKER_SERVICE_API_KEY="${SPEAKER_SERVICE_API_KEY:-local-speaker-service-api-key}"
SPEAKER_MODEL_PROVIDER="${SPEAKER_MODEL_PROVIDER:-sortformer_shadow}"
SPEAKER_MODEL_ID="${SPEAKER_MODEL_ID:-$REMOTE_ROOT/models/sortformer/diar_streaming_sortformer_4spk-v2.1.nemo}"
VOICE_IDENTITY_MODEL_ID="${VOICE_IDENTITY_MODEL_ID:-$REMOTE_ROOT/models/titanet/speakerverification_en_titanet_large.nemo}"
VOICE_IDENTITY_STORE_DIR="${VOICE_IDENTITY_STORE_DIR:-/data/ai-phone/speaker-identities}"

ASR_QWEN3_CONTEXT="${ASR_QWEN3_CONTEXT:-}"
ASR_QWEN3_ENGLISH_CONTEXT="${ASR_QWEN3_ENGLISH_CONTEXT:-}"
ASR_VAD_PROVIDER="${ASR_VAD_PROVIDER:-marblenet}"
ASR_VAD_THRESHOLD="${ASR_VAD_THRESHOLD:-0.5}"
ASR_VAD_WINDOW_MS="${ASR_VAD_WINDOW_MS:-1000}"
ASR_VAD_SMOOTHING_FRAMES="${ASR_VAD_SMOOTHING_FRAMES:-3}"
VAD_MODEL_DIR="${VAD_MODEL_DIR:-$REMOTE_ROOT/models/frame_vad_multilingual_marblenet_v2}"
VAD_NEMO_PATH="${VAD_NEMO_PATH:-$VAD_MODEL_DIR/frame_vad_multilingual_marblenet_v2.0.nemo}"
VAD_ONNX_PATH="${VAD_ONNX_PATH:-$VAD_MODEL_DIR/frame_vad_multilingual_marblenet_v2.0.onnx}"
VAD_ASSETS_PATH="${VAD_ASSETS_PATH:-$VAD_MODEL_DIR/frame_vad_multilingual_marblenet_v2.0.preprocessor.npz}"

sync_service() {
  local name="$1"
  local source="$2"
  local target="$3"
  echo "Syncing $name to $BEELINK_HOST:$target"
  ssh "$BEELINK_HOST" "mkdir -p '$target' '$REMOTE_ROOT/logs'"
  rsync -az --delete \
    --exclude .venv \
    --exclude __pycache__ \
    --exclude .pytest_cache \
    --exclude .env \
    --exclude '*.pid' \
    "$source/" \
    "$BEELINK_HOST:$target/"
}

sync_service "asr-service" "$ROOT_DIR/services/model-services/asr-service" "$ASR_SERVICE_DIR"
sync_service "translation-service" "$ROOT_DIR/services/model-services/translation-service" "$TRANSLATION_SERVICE_DIR"
sync_service "tts-service" "$ROOT_DIR/services/model-services/tts-service" "$TTS_SERVICE_DIR"
sync_service "speaker-service" "$ROOT_DIR/services/model-services/speaker-service" "$SPEAKER_SERVICE_DIR"

ssh "$BEELINK_HOST" \
  "REMOTE_ROOT='$REMOTE_ROOT' \
   REMOTE_PYTHON='$REMOTE_PYTHON' \
   SPEAKER_REMOTE_PYTHON='$SPEAKER_REMOTE_PYTHON' \
   ASR_SERVICE_DIR='$ASR_SERVICE_DIR' \
   TRANSLATION_SERVICE_DIR='$TRANSLATION_SERVICE_DIR' \
   TTS_SERVICE_DIR='$TTS_SERVICE_DIR' \
   SPEAKER_SERVICE_DIR='$SPEAKER_SERVICE_DIR' \
   SPEAKER_SERVICE_ENABLED='$SPEAKER_SERVICE_ENABLED' \
   VOICE_IDENTITY_ENABLED='$VOICE_IDENTITY_ENABLED' \
   ASR_SERVICE_PROVIDER='$ASR_SERVICE_PROVIDER' \
   ASR_MODEL_VERSION='$ASR_MODEL_VERSION' \
   ASR_PORT='$ASR_PORT' \
   TRANSLATION_PORT='$TRANSLATION_PORT' \
   TTS_PORT='$TTS_PORT' \
   SPEAKER_PORT='$SPEAKER_PORT' \
   ASR_MODEL_DIR='$ASR_MODEL_DIR' \
   TRANSLATION_MODEL_DIR='$TRANSLATION_MODEL_DIR' \
   TTS_MODEL_DIR='$TTS_MODEL_DIR' \
   TTS_VOICE_REFERENCE_DIR='$TTS_VOICE_REFERENCE_DIR' \
   TTS_VOICE_PRESET_MANIFEST='$TTS_VOICE_PRESET_MANIFEST' \
   ASR_SERVICE_API_KEY='$ASR_SERVICE_API_KEY' \
   TRANSLATION_SERVICE_API_KEY='$TRANSLATION_SERVICE_API_KEY' \
   TTS_SERVICE_API_KEY='$TTS_SERVICE_API_KEY' \
   SPEAKER_SERVICE_API_KEY='$SPEAKER_SERVICE_API_KEY' \
   SPEAKER_MODEL_PROVIDER='$SPEAKER_MODEL_PROVIDER' \
   SPEAKER_MODEL_ID='$SPEAKER_MODEL_ID' \
   VOICE_IDENTITY_MODEL_ID='$VOICE_IDENTITY_MODEL_ID' \
   VOICE_IDENTITY_STORE_DIR='$VOICE_IDENTITY_STORE_DIR' \
   ASR_QWEN3_CONTEXT='$ASR_QWEN3_CONTEXT' \
   ASR_QWEN3_ENGLISH_CONTEXT='$ASR_QWEN3_ENGLISH_CONTEXT' \
   ASR_VAD_PROVIDER='$ASR_VAD_PROVIDER' \
   ASR_VAD_THRESHOLD='$ASR_VAD_THRESHOLD' \
   ASR_VAD_WINDOW_MS='$ASR_VAD_WINDOW_MS' \
   ASR_VAD_SMOOTHING_FRAMES='$ASR_VAD_SMOOTHING_FRAMES' \
   VAD_NEMO_PATH='$VAD_NEMO_PATH' \
   VAD_ONNX_PATH='$VAD_ONNX_PATH' \
   VAD_ASSETS_PATH='$VAD_ASSETS_PATH' \
   bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$REMOTE_ROOT/logs"
mkdir -p "$TTS_VOICE_REFERENCE_DIR"
mkdir -p "$VOICE_IDENTITY_STORE_DIR"

start_service() {
  local name="$1"
  local dir="$2"
  local port="$3"
  local log="$REMOTE_ROOT/logs/$name.log"
  local pid_file="$dir/$name.pid"
  local python="${4:-$REMOTE_PYTHON}"
  local unit="ai-phone-$name.service"
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="$unit_dir/$unit"

  cd "$dir"
  systemctl --user stop "$unit" 2>/dev/null || true
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    kill "$(cat "$pid_file")"
    wait_for_stop "$(cat "$pid_file")"
  fi

  if ss -ltn 2>/dev/null | grep -q ":$port "; then
    port_pid="$(ss -ltnp 2>/dev/null | sed -nE "s/.*:$port .*pid=([0-9]+).*/\1/p" | head -1)"
    if [ -n "$port_pid" ] && ps -p "$port_pid" -o args= | grep -q "uvicorn app.main:app"; then
      kill "$port_pid"
      wait_for_stop "$port_pid"
    else
      echo "Port $port is already in use by a non-managed process." >&2
      exit 1
    fi
  fi

  mkdir -p "$unit_dir"
  cat > "$unit_path" <<EOF
[Unit]
Description=ai phone $name
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$dir
EnvironmentFile=$dir/.env
Environment=PYTHONUNBUFFERED=1
ExecStart=$python -m uvicorn app.main:app --host 0.0.0.0 --port $port
Restart=always
RestartSec=3
TimeoutStopSec=20
KillMode=mixed
StandardOutput=append:$log
StandardError=append:$log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable "$unit" >/dev/null
  systemctl --user restart "$unit"
  for _ in $(seq 1 240); do
    if ss -ltnp 2>/dev/null | grep ":$port" >/dev/null; then
      systemctl --user show "$unit" --property=MainPID --value > "$pid_file"
      return 0
    fi
    sleep 0.5
  done
  echo "$name did not start listening on $port. Last log lines:" >&2
  journalctl --user -u "$unit" -n 80 --no-pager >&2 || true
  exit 1
}

wait_for_stop() {
  local pid="$1"
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
}

existing_secret() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 0
  awk -F= -v k="$key" '$1 == k { print $2; exit }' "$file"
}

strong_secret() {
  local provided="$1"
  local file="$2"
  local key="$3"
  if [ -n "$provided" ]; then
    printf "%s" "$provided"
    return
  fi
  old="$(existing_secret "$file" "$key")"
  if [ -n "$old" ]; then
    printf "%s" "$old"
    return
  fi
  openssl rand -hex 24
}

write_env() {
  local target="$1"
  shift
  umask 077
  tmp="$(mktemp)"
  printf "%s\n" "$@" > "$tmp"
  mv "$tmp" "$target"
  chmod 600 "$target"
}

shell_quote() {
  printf "%s" "$1" | sed "s/'/'\"'\"'/g; s/^/'/; s/$/'/"
}

asr_key="$(strong_secret "$ASR_SERVICE_API_KEY" "$ASR_SERVICE_DIR/.env" ASR_SERVICE_API_KEY)"
translation_key="$(strong_secret "$TRANSLATION_SERVICE_API_KEY" "$TRANSLATION_SERVICE_DIR/.env" TRANSLATION_SERVICE_API_KEY)"
tts_key="$(strong_secret "$TTS_SERVICE_API_KEY" "$TTS_SERVICE_DIR/.env" TTS_SERVICE_API_KEY)"
speaker_key="$(strong_secret "$SPEAKER_SERVICE_API_KEY" "$SPEAKER_SERVICE_DIR/.env" SPEAKER_SERVICE_API_KEY)"
voice_identity_key=""
voice_identity_provider="off"
if [ "$VOICE_IDENTITY_ENABLED" = "true" ]; then
  if [ ! -f "$VOICE_IDENTITY_MODEL_ID" ]; then
    echo "Voice identity checkpoint is missing: $VOICE_IDENTITY_MODEL_ID" >&2
    exit 1
  fi
  voice_identity_provider="nemo_titanet"
  voice_identity_key="$(awk -F= '/^VOICE_IDENTITY_ENCRYPTION_KEY=/{print $2}' \
    "$SPEAKER_SERVICE_DIR/.env" 2>/dev/null | tail -1)"
  if [ -n "$voice_identity_key" ] && ! "$SPEAKER_REMOTE_PYTHON" -c \
    "from cryptography.fernet import Fernet; Fernet('$voice_identity_key'.encode())" \
    >/dev/null 2>&1; then
    voice_identity_key=""
  fi
  if [ -z "$voice_identity_key" ]; then
    voice_identity_key="$($SPEAKER_REMOTE_PYTHON -c \
      'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  fi
fi

if [ "$ASR_VAD_PROVIDER" = "marblenet" ]; then
  if [ ! -x "$SPEAKER_REMOTE_PYTHON" ]; then
    echo "NeMo export runtime is missing: $SPEAKER_REMOTE_PYTHON" >&2
    exit 1
  fi
  if [ ! -f "$VAD_NEMO_PATH" ]; then
    echo "MarbleNet VAD checkpoint is missing: $VAD_NEMO_PATH" >&2
    exit 1
  fi
  "$SPEAKER_REMOTE_PYTHON" "$ASR_SERVICE_DIR/tools/export_marblenet_assets.py" \
    --model "$VAD_NEMO_PATH" \
    --onnx "$VAD_ONNX_PATH" \
    --assets "$VAD_ASSETS_PATH"
fi

case "$ASR_SERVICE_PROVIDER" in
  qwen3_asr)
    write_env "$ASR_SERVICE_DIR/.env" \
      "ASR_SERVICE_PROVIDER=qwen3_asr" \
      "ASR_MODEL_VERSION=$ASR_MODEL_VERSION" \
      "ASR_SERVICE_API_KEY=$asr_key" \
      "ASR_QWEN3_MODEL_DIR=$ASR_MODEL_DIR" \
      "ASR_QWEN3_DTYPE=bfloat16" \
      "ASR_QWEN3_DEVICE_MAP=cuda:0" \
      "ASR_QWEN3_MAX_INFERENCE_BATCH_SIZE=1" \
      "ASR_QWEN3_MAX_NEW_TOKENS=256" \
      "ASR_QWEN3_MIN_AUDIO_MS=1800" \
      "ASR_QWEN3_ENDPOINT_SILENCE_MS=1100" \
      "ASR_QWEN3_CONVERSATION_ENDPOINT_SILENCE_MS=900" \
      "ASR_QWEN3_LISTENING_ENDPOINT_SILENCE_MS=1400" \
      "ASR_QWEN3_CALL_LINK_ENDPOINT_SILENCE_MS=900" \
      "ASR_QWEN3_PSTN_ENDPOINT_SILENCE_MS=1100" \
      "ASR_QWEN3_MAX_AUDIO_MS=10000" \
      "ASR_QWEN3_PREROLL_MS=400" \
      "ASR_QWEN3_VAD_ENERGY_THRESHOLD=350" \
      "ASR_VAD_PROVIDER=$ASR_VAD_PROVIDER" \
      "ASR_VAD_MODEL_PATH=$VAD_ONNX_PATH" \
      "ASR_VAD_ASSETS_PATH=$VAD_ASSETS_PATH" \
      "ASR_VAD_THRESHOLD=$ASR_VAD_THRESHOLD" \
      "ASR_VAD_WINDOW_MS=$ASR_VAD_WINDOW_MS" \
      "ASR_VAD_SMOOTHING_FRAMES=$ASR_VAD_SMOOTHING_FRAMES" \
      "ASR_QWEN3_CONTEXT=$(shell_quote "$ASR_QWEN3_CONTEXT")" \
      "ASR_QWEN3_ENGLISH_CONTEXT=$(shell_quote "$ASR_QWEN3_ENGLISH_CONTEXT")"
    ;;
  fireredasr2_aed)
    write_env "$ASR_SERVICE_DIR/.env" \
      "ASR_SERVICE_PROVIDER=fireredasr2_aed" \
      "ASR_MODEL_VERSION=${ASR_MODEL_VERSION:-FireRedASR2-AED}" \
      "ASR_SERVICE_API_KEY=$asr_key" \
      "ASR_FIRERED_MODEL_DIR=$ASR_MODEL_DIR" \
      "ASR_FIRERED_USE_GPU=true" \
      "ASR_FIRERED_BEAM_SIZE=1" \
      "ASR_FIRERED_MIN_AUDIO_MS=1200" \
      "ASR_FIRERED_ENDPOINT_SILENCE_MS=900" \
      "ASR_FIRERED_MAX_AUDIO_MS=8000" \
      "ASR_FIRERED_PREROLL_MS=300" \
      "ASR_FIRERED_VAD_ENERGY_THRESHOLD=350" \
      "ASR_VAD_PROVIDER=$ASR_VAD_PROVIDER" \
      "ASR_VAD_MODEL_PATH=$VAD_ONNX_PATH" \
      "ASR_VAD_ASSETS_PATH=$VAD_ASSETS_PATH" \
      "ASR_VAD_THRESHOLD=$ASR_VAD_THRESHOLD" \
      "ASR_VAD_WINDOW_MS=$ASR_VAD_WINDOW_MS" \
      "ASR_VAD_SMOOTHING_FRAMES=$ASR_VAD_SMOOTHING_FRAMES"
    ;;
  *)
    echo "Unsupported ASR_SERVICE_PROVIDER: $ASR_SERVICE_PROVIDER" >&2
    exit 1
    ;;
esac

write_env "$TRANSLATION_SERVICE_DIR/.env" \
  "TRANSLATION_SERVICE_PROVIDER=hymt2" \
  "TRANSLATION_MODEL_VERSION=tencent/Hy-MT2-1.8B" \
  "TRANSLATION_SERVICE_API_KEY=$translation_key" \
  "TRANSLATION_HYMT2_MODEL_DIR=$TRANSLATION_MODEL_DIR" \
  "TRANSLATION_HYMT2_DTYPE=bfloat16" \
  "TRANSLATION_HYMT2_DEVICE_MAP=auto" \
  "TRANSLATION_MAX_NEW_TOKENS=1024" \
  "TRANSLATION_TEMPERATURE=0.1" \
  "TRANSLATION_TOP_P=0.6" \
  "TRANSLATION_TOP_K=20" \
  "TRANSLATION_REPETITION_PENALTY=1.05"

write_env "$TTS_SERVICE_DIR/.env" \
  "TTS_SERVICE_PROVIDER=voxcpm2" \
  "TTS_MODEL_VERSION=VoxCPM2" \
  "TTS_SERVICE_API_KEY=$tts_key" \
  "TTS_VOXCPM2_MODEL_DIR=$TTS_MODEL_DIR" \
  "TTS_VOXCPM2_CFG_VALUE=2.0" \
  "TTS_VOXCPM2_INFERENCE_TIMESTEPS=10" \
  "TTS_VOXCPM2_HIFI_INFERENCE_TIMESTEPS=15" \
  "TTS_VOXCPM2_LOAD_DENOISER=false" \
  "TTS_VOICE_REFERENCE_DIR=$TTS_VOICE_REFERENCE_DIR" \
  "TTS_VOICE_PRESET_MANIFEST=$TTS_VOICE_PRESET_MANIFEST"

if [ "$SPEAKER_SERVICE_ENABLED" = "true" ]; then
  if [ ! -x "$SPEAKER_REMOTE_PYTHON" ]; then
    echo "Speaker Python runtime is missing: $SPEAKER_REMOTE_PYTHON" >&2
    echo "Install services/model-services/speaker-service with the sortformer extra before enabling it." >&2
    exit 1
  fi
  if [ "$SPEAKER_MODEL_PROVIDER" = "sortformer_shadow" ] && [ ! -f "$SPEAKER_MODEL_ID" ]; then
    echo "Pinned speaker model is missing: $SPEAKER_MODEL_ID" >&2
    exit 1
  fi
  if [ "$VOICE_IDENTITY_ENABLED" = "true" ]; then
    "$SPEAKER_REMOTE_PYTHON" -c \
      "from cryptography.fernet import Fernet; Fernet('$voice_identity_key'.encode())"
  fi
  write_env "$SPEAKER_SERVICE_DIR/.env" \
    "SPEAKER_MODEL_PROVIDER=$SPEAKER_MODEL_PROVIDER" \
    "SPEAKER_MODEL_ID=$SPEAKER_MODEL_ID" \
    "SPEAKER_SERVICE_API_KEY=$speaker_key" \
    "SPEAKER_CHUNK_LEN=6" \
    "SPEAKER_CHUNK_LEFT_CONTEXT=1" \
    "SPEAKER_CHUNK_RIGHT_CONTEXT=7" \
    "SPEAKER_FIFO_LEN=188" \
    "SPEAKER_CACHE_UPDATE_PERIOD=144" \
    "SPEAKER_CACHE_LEN=188" \
    "SPEAKER_ONSET=0.5" \
    "SPEAKER_OFFSET=0.5" \
    "VOICE_IDENTITY_PROVIDER=$voice_identity_provider" \
    "VOICE_IDENTITY_MODEL_ID=$VOICE_IDENTITY_MODEL_ID" \
    "VOICE_IDENTITY_STORE_DIR=$VOICE_IDENTITY_STORE_DIR" \
    "VOICE_IDENTITY_ENCRYPTION_KEY=$voice_identity_key"
fi

start_service asr-service "$ASR_SERVICE_DIR" "$ASR_PORT"
start_service translation-service "$TRANSLATION_SERVICE_DIR" "$TRANSLATION_PORT"
"$REMOTE_PYTHON" -c "import numpy; from scipy.signal import resample_poly"
start_service tts-service "$TTS_SERVICE_DIR" "$TTS_PORT"
if [ "$SPEAKER_SERVICE_ENABLED" = "true" ]; then
  start_service speaker-service "$SPEAKER_SERVICE_DIR" "$SPEAKER_PORT" "$SPEAKER_REMOTE_PYTHON"
fi

echo "services started"
REMOTE

echo "Health checks:"
check_health() {
  local url="$1"
  local require_available="$2"
  local require_voice_identity="${3:-false}"
  local body
  body="$(curl -fsS "$url")"
  printf "%s\n" "$body"
  HEALTH_BODY="$body" python3 - "$require_available" "$require_voice_identity" <<'PY'
import json
import os
import sys

require_available = sys.argv[1] == "true"
require_voice_identity = sys.argv[2] == "true"
payload = json.loads(os.environ["HEALTH_BODY"])
if payload.get("status") not in {"ok", "ready"}:
    raise SystemExit(f"health status is not ok: {payload.get('status')}")
if require_available and payload.get("available") is not True:
    raise SystemExit(f"model is not available: {payload.get('reason')}")
if require_voice_identity and payload.get("voiceIdentityAvailable") is not True:
    raise SystemExit("voice identity model is not loaded")
PY
}

check_health "http://$BEELINK_IP:$ASR_PORT/health" false
check_health "http://$BEELINK_IP:$TRANSLATION_PORT/health" true
check_health "http://$BEELINK_IP:$TTS_PORT/health" true
if [ "$SPEAKER_SERVICE_ENABLED" = "true" ]; then
  check_health "http://$BEELINK_IP:$SPEAKER_PORT/health" false "$VOICE_IDENTITY_ENABLED"
fi
