#!/usr/bin/env bash
set -euo pipefail

BEELINK_HOST="${BEELINK_HOST:-beelink@100.110.127.117}"
LLM_BIND_ADDRESS="${LLM_BIND_ADDRESS:-${BEELINK_TAILSCALE_IP:-100.110.127.117}}"
LLM_PORT="${LLM_PORT:-1234}"
LLM_MODEL_ALIAS="${LLM_MODEL_ALIAS:-qwen/qwen3.5-9b}"
LLM_MODEL_PATH="${LLM_MODEL_PATH:-/data/models/lmstudio-community/lmstudio-community/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q6_K.gguf}"
LMSTUDIO_BACKEND_ROOT="${LMSTUDIO_BACKEND_ROOT:-/home/beelink/.lmstudio/extensions/backends}"
LLAMA_SERVER_PATH="${LLAMA_SERVER_PATH:-$LMSTUDIO_BACKEND_ROOT/llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.23.1/llama-server}"
LLAMA_LIBRARY_PATH="${LLAMA_LIBRARY_PATH:-$LMSTUDIO_BACKEND_ROOT/llama.cpp-linux-x86_64-nvidia-cuda12-avx2-2.23.1:$LMSTUDIO_BACKEND_ROOT/vendor/linux-llama-cuda12-vendor-v1}"
LLM_CONTEXT_SIZE="${LLM_CONTEXT_SIZE:-8192}"
LLM_PARALLEL="${LLM_PARALLEL:-2}"
LLM_GPU_LAYERS="${LLM_GPU_LAYERS:-99}"

for value in "$LLM_PORT" "$LLM_CONTEXT_SIZE" "$LLM_PARALLEL" "$LLM_GPU_LAYERS"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "LLM numeric settings are invalid" >&2; exit 2; }
done
[[ "$LLM_MODEL_ALIAS" =~ ^[A-Za-z0-9._/-]+$ ]] || {
  echo "LLM_MODEL_ALIAS is invalid" >&2
  exit 2
}
[[ "$LLM_BIND_ADDRESS" =~ ^[A-Za-z0-9._:-]+$ ]] || {
  echo "LLM_BIND_ADDRESS is invalid" >&2
  exit 2
}
case "$LLM_BIND_ADDRESS" in
  127.*|localhost|::1)
    echo "LLM_BIND_ADDRESS must be a server-reachable non-loopback address" >&2
    exit 2
    ;;
esac

ssh "$BEELINK_HOST" \
  "LLM_BIND_ADDRESS='$LLM_BIND_ADDRESS' \
   LLM_PORT='$LLM_PORT' \
   LLM_MODEL_ALIAS='$LLM_MODEL_ALIAS' \
   LLM_MODEL_PATH='$LLM_MODEL_PATH' \
   LLAMA_SERVER_PATH='$LLAMA_SERVER_PATH' \
   LLAMA_LIBRARY_PATH='$LLAMA_LIBRARY_PATH' \
   LLM_CONTEXT_SIZE='$LLM_CONTEXT_SIZE' \
   LLM_PARALLEL='$LLM_PARALLEL' \
   LLM_GPU_LAYERS='$LLM_GPU_LAYERS' \
   bash -s" <<'REMOTE'
set -euo pipefail

test -x "$LLAMA_SERVER_PATH"
test -f "$LLM_MODEL_PATH"
unit="ai-phone-staging-llm.service"
unit_dir="$HOME/.config/systemd/user"
unit_path="$unit_dir/$unit"
mkdir -p "$unit_dir"

if ss -ltn 2>/dev/null | grep -q ":$LLM_PORT "; then
  existing_pid="$(ss -ltnp 2>/dev/null | sed -nE "s/.*:$LLM_PORT .*pid=([0-9]+).*/\1/p" | head -1)"
  unit_pid="$(systemctl --user show "$unit" -p MainPID --value 2>/dev/null || true)"
  if [ -z "$existing_pid" ] || [ "$existing_pid" != "$unit_pid" ]; then
    echo "Port $LLM_PORT is occupied by an unmanaged process" >&2
    exit 1
  fi
fi

tmp_unit="$(mktemp "$unit_dir/.ai-phone-staging-llm.XXXXXX")"
cat >"$tmp_unit" <<EOF
[Unit]
Description=ai phone staging Qwen3.5 LLM
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
Environment=LD_LIBRARY_PATH=$LLAMA_LIBRARY_PATH
Environment=CUDA_VISIBLE_DEVICES=0
ExecStart=$LLAMA_SERVER_PATH --model $LLM_MODEL_PATH --alias $LLM_MODEL_ALIAS --host $LLM_BIND_ADDRESS --port $LLM_PORT --ctx-size $LLM_CONTEXT_SIZE --parallel $LLM_PARALLEL --gpu-layers $LLM_GPU_LAYERS --metrics --no-ui
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGINT
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF
mv "$tmp_unit" "$unit_path"
chmod 600 "$unit_path"
systemctl --user daemon-reload
systemctl --user enable "$unit" >/dev/null
systemctl --user restart "$unit"

for _ in $(seq 1 180); do
  if curl -fsS --max-time 3 "http://$LLM_BIND_ADDRESS:$LLM_PORT/v1/models" >/dev/null 2>&1; then
    break
  fi
  if ! systemctl --user is-active --quiet "$unit"; then
    journalctl --user -u "$unit" -n 120 --no-pager >&2 || true
    exit 1
  fi
  sleep 1
done
curl -fsS --max-time 3 "http://$LLM_BIND_ADDRESS:$LLM_PORT/v1/models" >/dev/null

smoke="$(curl -fsS --max-time 120 \
  -H 'content-type: application/json' \
  --data "{\"model\":\"$LLM_MODEL_ALIAS\",\"temperature\":0,\"max_tokens\":16,\"reasoning_effort\":\"none\",\"enable_thinking\":false,\"chat_template_kwargs\":{\"enable_thinking\":false},\"messages\":[{\"role\":\"system\",\"content\":\"Reply with READY only.\"},{\"role\":\"user\",\"content\":\"readiness\"}]}" \
  "http://$LLM_BIND_ADDRESS:$LLM_PORT/v1/chat/completions")"
LLM_SMOKE_RESPONSE="$smoke" python3 -c '
import json, os
body = json.loads(os.environ["LLM_SMOKE_RESPONSE"])
content = body.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
if not content:
    raise SystemExit("LLM smoke returned empty final content")
print(f"LLM_SMOKE_OK|content={content[:40]}")
'
systemctl --user show "$unit" -p MainPID -p NRestarts -p ActiveState --no-pager
REMOTE
