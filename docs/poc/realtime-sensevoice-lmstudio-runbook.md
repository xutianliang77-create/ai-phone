# Realtime SenseVoice + LM Studio Runbook

This runbook starts the local MVP chain:

Flutter App -> API Server -> Realtime Gateway -> ASR Service -> LM Studio.

## 1. Start ASR Service

```bash
cd services/model-services/asr-service
ASR_SERVICE_PROVIDER=sensevoice \
ASR_MODEL_VERSION=iic/SenseVoiceSmall \
ASR_SENSEVOICE_MODEL=iic/SenseVoiceSmall \
ASR_SENSEVOICE_DEVICE=cpu \
ASR_SENSEVOICE_MIN_AUDIO_MS=1200 \
ASR_SENSEVOICE_ENDPOINT_SILENCE_MS=600 \
ASR_SENSEVOICE_MAX_AUDIO_MS=8000 \
ASR_SENSEVOICE_PREROLL_MS=200 \
ASR_SENSEVOICE_VAD_ENERGY_THRESHOLD=350 \
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001
```

## 2. Start API Server

Use the Mac LAN IP for `REALTIME_WS_ENDPOINT` when testing on a physical phone.

```bash
API_PORT=3100 \
REALTIME_TOKEN_SECRET=test-secret \
REALTIME_WS_ENDPOINT=ws://YOUR_MAC_LAN_IP:3201/realtime \
npm run dev -w @translation/api-server
```

## 3. Start Realtime Gateway

For the current domestic server route, prefer loading the Gateway group from
`release/domestic/model-routing.json`:

```bash
MODEL_ROUTING_PROFILE=domestic_server_qwen3_hymt2_voxcpm2 \
REALTIME_PORT=3201 \
REALTIME_TOKEN_SECRET=test-secret \
SESSION_EVENT_SINK=api \
API_BASE_URL=http://127.0.0.1:3100 \
npm run dev -w @translation/realtime-gateway
```

For the older SenseVoice + LM Studio manual route:

```bash
REALTIME_PORT=3201 \
REALTIME_TOKEN_SECRET=test-secret \
REALTIME_PROVIDER=lmstudio \
SESSION_EVENT_SINK=api \
API_BASE_URL=http://127.0.0.1:3100 \
LMSTUDIO_BASE_URL=http://222.128.62.139:1234/v1 \
LMSTUDIO_MODEL=qwen/qwen3.5-9b \
LMSTUDIO_TIMEOUT_MS=60000 \
LMSTUDIO_MAX_TOKENS=512 \
ASR_PROVIDER=http \
ASR_HTTP_ENDPOINT=http://127.0.0.1:8001/asr/transcribe \
ASR_HTTP_FLUSH_ENDPOINT=http://127.0.0.1:8001/asr/sessions/:sessionId/flush \
ASR_HTTP_HEALTH_URL=http://127.0.0.1:8001/health \
ASR_HTTP_TIMEOUT_MS=120000 \
npm run dev -w @translation/realtime-gateway
```

## 4. Run Flutter

For iOS simulator on the same Mac:

```bash
cd apps/mobile
flutter run -d "iPhone 17 Pro" \
  --dart-define=API_BASE_URL=http://127.0.0.1:3100
```

For a physical iPhone or Android device on the same Wi-Fi:

```bash
cd apps/mobile
flutter run -d DEVICE_ID \
  --dart-define=API_BASE_URL=http://YOUR_MAC_LAN_IP:3100
```

## Expected Signals

- API creates a realtime session.
- Gateway logs `Realtime audio frame received`.
- App receives `transcript.final`.
- App receives `translation.final`.
- Tapping End flushes tail audio before `session.ended`.
- Gateway syncs final transcript/translation events to API when `SESSION_EVENT_SINK=api`.
- History shows the ended session even if the App does not upload its local subtitle copy.
