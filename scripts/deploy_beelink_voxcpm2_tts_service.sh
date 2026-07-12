#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEELINK_HOST="${BEELINK_HOST:-beelink@100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/translation-model-eval}"
REMOTE_SERVICE_DIR="${REMOTE_SERVICE_DIR:-$REMOTE_ROOT/services/tts-service}"
REMOTE_MODEL_DIR="${REMOTE_MODEL_DIR:-$REMOTE_ROOT/data/tts-product-fit/models/openbmb_voxcpm2}"
REMOTE_PYTHON="${REMOTE_PYTHON:-$REMOTE_ROOT/.venv/bin/python}"
TTS_SERVICE_PORT="${TTS_SERVICE_PORT:-8002}"
LOCAL_SERVICE_DIR="$ROOT_DIR/services/model-services/tts-service"

echo "Deploying TTS service to $BEELINK_HOST:$REMOTE_SERVICE_DIR"
ssh "$BEELINK_HOST" "mkdir -p '$REMOTE_SERVICE_DIR' '$REMOTE_ROOT/logs'"
rsync -az --delete \
  --exclude .venv \
  --exclude __pycache__ \
  --exclude .pytest_cache \
  --exclude .env \
  --exclude tts-service.pid \
  "$LOCAL_SERVICE_DIR/" \
  "$BEELINK_HOST:$REMOTE_SERVICE_DIR/"

ssh "$BEELINK_HOST" \
  "REMOTE_SERVICE_DIR='$REMOTE_SERVICE_DIR' \
   REMOTE_ROOT='$REMOTE_ROOT' \
   REMOTE_MODEL_DIR='$REMOTE_MODEL_DIR' \
   REMOTE_PYTHON='$REMOTE_PYTHON' \
   TTS_SERVICE_PORT='$TTS_SERVICE_PORT' \
   TTS_SERVICE_API_KEY='${TTS_SERVICE_API_KEY:-}' \
   bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_SERVICE_DIR"
umask 077

"$REMOTE_PYTHON" -c "import numpy; from scipy.signal import resample_poly"

if [ -z "${TTS_SERVICE_API_KEY:-}" ] && [ -f .env ]; then
  TTS_SERVICE_API_KEY="$(awk -F= '/^TTS_SERVICE_API_KEY=/{print $2}' .env)"
fi
if [ -z "${TTS_SERVICE_API_KEY:-}" ]; then
  TTS_SERVICE_API_KEY="$(openssl rand -hex 24)"
fi

tmp_env="$(mktemp)"
cat > "$tmp_env" <<EOF
TTS_SERVICE_PROVIDER=voxcpm2
TTS_MODEL_VERSION=VoxCPM2
TTS_SERVICE_API_KEY=$TTS_SERVICE_API_KEY
TTS_VOXCPM2_MODEL_DIR=$REMOTE_MODEL_DIR
TTS_VOXCPM2_CFG_VALUE=2.0
TTS_VOXCPM2_INFERENCE_TIMESTEPS=10
TTS_VOXCPM2_LOAD_DENOISER=false
EOF
mv "$tmp_env" .env
chmod 600 .env

pid_file="$REMOTE_SERVICE_DIR/tts-service.pid"
if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  kill "$(cat "$pid_file")"
  for _ in $(seq 1 20); do
    kill -0 "$(cat "$pid_file")" 2>/dev/null || break
    sleep 0.5
  done
fi

if ss -ltn 2>/dev/null | grep -q ":$TTS_SERVICE_PORT "; then
  port_pid="$(ss -ltnp 2>/dev/null | sed -nE "s/.*:$TTS_SERVICE_PORT .*pid=([0-9]+).*/\1/p" | head -1)"
  if [ -n "$port_pid" ] && ps -p "$port_pid" -o args= | grep -q "uvicorn app.main:app"; then
    kill "$port_pid"
    for _ in $(seq 1 20); do
      kill -0 "$port_pid" 2>/dev/null || break
      sleep 0.5
    done
  else
    echo "Port $TTS_SERVICE_PORT is already in use by another process." >&2
    exit 1
  fi
fi

set -a
. ./.env
set +a
nohup "$REMOTE_PYTHON" -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$TTS_SERVICE_PORT" \
  > "$REMOTE_ROOT/logs/tts-service.log" 2>&1 &
echo $! > "$pid_file"
sleep 2
ss -ltnp 2>/dev/null | grep ":$TTS_SERVICE_PORT" >/dev/null
echo "started pid $(cat "$pid_file") on port $TTS_SERVICE_PORT"
REMOTE

echo "Health:"
curl -sS "http://${BEELINK_TAILSCALE_IP:-100.110.127.117}:$TTS_SERVICE_PORT/health"
echo
