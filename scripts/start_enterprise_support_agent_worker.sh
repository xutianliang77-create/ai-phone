#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-dev}"

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/start_enterprise_support_agent_worker.sh [dev|start]

Starts the dedicated tenant-isolated Enterprise Support Agent Worker cell.
The Worker has no PostgreSQL credentials; every turn and TTS playout is
authorized through the API with a signed tenant/session/generation ticket.

Required:
  API_BASE_URL
  INTERNAL_API_SECRET
  ENTERPRISE_WORKER_CELL_ID
  LIVEKIT_WORKER_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
  ENTERPRISE_SUPPORT_AGENT_STT_MODEL
  ENTERPRISE_SUPPORT_AGENT_TTS_MODEL
  ENTERPRISE_SUPPORT_AGENT_TTS_VOICE
USAGE
  exit 0
fi
if [[ "$MODE" != "dev" && "$MODE" != "start" ]]; then
  echo "Mode must be dev or start." >&2
  exit 2
fi

required=(API_BASE_URL INTERNAL_API_SECRET ENTERPRISE_WORKER_CELL_ID
  LIVEKIT_WORKER_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET
  ENTERPRISE_SUPPORT_AGENT_STT_MODEL ENTERPRISE_SUPPORT_AGENT_TTS_MODEL
  ENTERPRISE_SUPPORT_AGENT_TTS_VOICE)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required." >&2
    exit 2
  fi
done
if (( ${#INTERNAL_API_SECRET} < 16 )); then
  echo "INTERNAL_API_SECRET must be at least 16 bytes." >&2
  exit 2
fi

export ENTERPRISE_SUPPORT_AGENT_WORKER_ENABLED=true
export ENTERPRISE_SUPPORT_AGENT_RUNTIME_PROVIDER=livekit_dispatch
cd "$ROOT_DIR"
if [[ "$MODE" == "start" ]]; then
  exec npm run start:support -w @translation/voice-agent-runtime
fi
exec npm run dev:support -w @translation/voice-agent-runtime
