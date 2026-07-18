#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEELINK_HOST="${BEELINK_HOST:-beelink@100.110.127.117}"
REMOTE_ROOT="${REMOTE_ROOT:-/data/models/translation-model-eval}"
REMOTE_SERVICE_DIR="${REMOTE_SERVICE_DIR:-$REMOTE_ROOT/services/tts-service}"
REMOTE_MODEL_DIR="${REMOTE_MODEL_DIR:-$REMOTE_ROOT/data/tts-product-fit/models/openbmb_voxcpm2}"
REMOTE_VOICE_REFERENCE_DIR="${REMOTE_VOICE_REFERENCE_DIR:-/data/models/ai-phone-server/runtime/data/voice-references}"
REMOTE_PYTHON="${REMOTE_PYTHON:-$REMOTE_ROOT/.venv/bin/python}"
TTS_SERVICE_PORT="${TTS_SERVICE_PORT:-8002}"
LOCAL_SERVICE_DIR="$ROOT_DIR/services/model-services/tts-service"

echo "Deploying TTS service to $BEELINK_HOST:$REMOTE_SERVICE_DIR"
ssh "$BEELINK_HOST" "mkdir -p '$REMOTE_SERVICE_DIR' '$REMOTE_ROOT/logs' '$REMOTE_VOICE_REFERENCE_DIR'"
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
   REMOTE_VOICE_REFERENCE_DIR='$REMOTE_VOICE_REFERENCE_DIR' \
   REMOTE_PYTHON='$REMOTE_PYTHON' \
   TTS_SERVICE_PORT='$TTS_SERVICE_PORT' \
   GENERATE_VOICE_PRESETS='${GENERATE_VOICE_PRESETS:-0}' \
   FORCE_VOICE_PRESETS='${FORCE_VOICE_PRESETS:-0}' \
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
TTS_VOICE_REFERENCE_DIR=$REMOTE_VOICE_REFERENCE_DIR
TTS_VOICE_PRESET_MANIFEST=$REMOTE_SERVICE_DIR/voice-presets.json
EOF
mv "$tmp_env" .env
chmod 600 .env

pid_file="$REMOTE_SERVICE_DIR/tts-service.pid"
unit="ai-phone-tts-service.service"
unit_dir="$HOME/.config/systemd/user"
unit_path="$unit_dir/$unit"
systemctl --user stop "$unit" 2>/dev/null || true
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

if [ "$GENERATE_VOICE_PRESETS" = "1" ]; then
  generate_args=(
    --model-dir "$REMOTE_MODEL_DIR"
    --manifest "$REMOTE_SERVICE_DIR/voice-presets.json"
    --output-dir "$REMOTE_VOICE_REFERENCE_DIR"
  )
  if [ "$FORCE_VOICE_PRESETS" = "1" ]; then
    generate_args+=(--force)
  fi
  "$REMOTE_PYTHON" scripts/generate_voice_presets.py "${generate_args[@]}"
fi

mkdir -p "$unit_dir"
cat > "$unit_path" <<EOF
[Unit]
Description=ai phone tts-service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_SERVICE_DIR
EnvironmentFile=$REMOTE_SERVICE_DIR/.env
Environment=PYTHONUNBUFFERED=1
ExecStart=$REMOTE_PYTHON -m uvicorn app.main:app --host 0.0.0.0 --port $TTS_SERVICE_PORT
Restart=always
RestartSec=3
TimeoutStopSec=20
KillMode=mixed
StandardOutput=append:$REMOTE_ROOT/logs/tts-service.log
StandardError=append:$REMOTE_ROOT/logs/tts-service.log

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$unit" >/dev/null
systemctl --user restart "$unit"
for _ in $(seq 1 240); do
  if ss -ltnp 2>/dev/null | grep ":$TTS_SERVICE_PORT" >/dev/null; then
    systemctl --user show "$unit" --property=MainPID --value > "$pid_file"
    echo "started pid $(cat "$pid_file") on port $TTS_SERVICE_PORT"
    exit 0
  fi
  sleep 0.5
done
journalctl --user -u "$unit" -n 80 --no-pager >&2 || true
exit 1
REMOTE

echo "Health:"
curl -sS "http://${BEELINK_TAILSCALE_IP:-100.110.127.117}:$TTS_SERVICE_PORT/health"
echo
