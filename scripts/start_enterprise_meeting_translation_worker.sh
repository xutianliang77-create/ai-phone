#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-dev}"

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/start_enterprise_meeting_translation_worker.sh [dev|start]

Starts a dedicated LiveKit Agent cell for Enterprise meeting captions.
The API signs tenant/session/cell/generation tickets; this process never
receives PostgreSQL credentials and never enables meeting TTS.

Required:
  API_BASE_URL
  INTERNAL_API_SECRET              at least 16 bytes
  LIVEKIT_WORKER_URL               ws:// or wss:// Agent endpoint
  LIVEKIT_API_KEY
  LIVEKIT_API_SECRET

Optional:
  LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME (default enterprise-translation-runtime)
  ENTERPRISE_MEETING_MAX_AUDIO_TRACKS       (default 32)
  MODEL_ROUTING_FILE / MODEL_ROUTING_PROFILE
  ASR_* / TRANSLATION_* provider settings
USAGE
  exit 0
fi

if [[ "$MODE" != "dev" && "$MODE" != "start" ]]; then
  echo "Mode must be dev or start." >&2
  exit 2
fi

API_BASE_URL="${API_BASE_URL:-}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-}"
LIVEKIT_WORKER_URL="${LIVEKIT_WORKER_URL:-}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-}"
LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME="${LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME:-enterprise-translation-runtime}"

for name in API_BASE_URL LIVEKIT_WORKER_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  if [[ -z "${!name}" ]]; then
    echo "$name is required." >&2
    exit 2
  fi
done
if (( ${#INTERNAL_API_SECRET} < 16 )); then
  echo "INTERNAL_API_SECRET must be at least 16 bytes." >&2
  exit 2
fi
if [[ ! "$LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME" =~ ^[a-z0-9][a-z0-9_-]{2,63}$ ]]; then
  echo "LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME is invalid." >&2
  exit 2
fi

cd "$ROOT_DIR"
export API_BASE_URL INTERNAL_API_SECRET LIVEKIT_WORKER_URL
export LIVEKIT_API_KEY LIVEKIT_API_SECRET
export LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME

if [[ "$MODE" == "start" ]]; then
  exec npm run start:livekit-agent -w @translation/translation-worker
fi
exec npm run dev:livekit-agent -w @translation/translation-worker
