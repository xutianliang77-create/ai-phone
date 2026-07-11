# Beelink VoxCPM2 TTS Service Deployment

Date: 2026-07-05

## Status

Beelink Tailscale deployment is running and ready for internal Call Link/PSTN
testing.

- Host: `beelink@100.110.127.117`
- Service port: `8002`
- Endpoint: `http://100.110.127.117:8002/tts/synthesize`
- Health: `http://100.110.127.117:8002/health`
- Remote service dir: `/data/models/translation-model-eval/services/tts-service`
- Remote model dir: `/data/models/translation-model-eval/data/tts-product-fit/models/openbmb_voxcpm2`
- Remote log: `/data/models/translation-model-eval/logs/tts-service.log`
- Remote env: `/data/models/translation-model-eval/services/tts-service/.env`

`POST /tts/synthesize` requires `Authorization: Bearer <TTS_SERVICE_API_KEY>`.
The key is stored only in the remote `.env`; use it as `TTS_HTTP_API_KEY` for
Worker and readiness checks.

## Deploy Or Restart

```bash
npm run deploy:beelink-tts
```

The deploy script rsyncs `services/model-services/tts-service`, preserves the
remote `.env`, starts `uvicorn` with the existing model-eval venv, and checks
`/health`.

Override defaults only when needed:

```bash
BEELINK_HOST=beelink@100.110.127.117 \
REMOTE_ROOT=/data/models/translation-model-eval \
TTS_SERVICE_PORT=8002 \
npm run deploy:beelink-tts
```

## Readiness Smoke

```bash
TTS_HTTP_ENDPOINT=http://100.110.127.117:8002/tts/synthesize \
TTS_HTTP_API_KEY=$(ssh beelink@100.110.127.117 "awk -F= '/^TTS_SERVICE_API_KEY=/{print \\$2}' /data/models/translation-model-eval/services/tts-service/.env") \
npm run check:tts-provider -- --json --timeout-ms 30000
```

Current warm result:

- `status=ready`
- `provider=voxcpm2`
- `model=VoxCPM2`
- `sampleRate=24000`
- warm HTTP latency about `990ms`
- `firstAudioMs=22ms`

Cold start after process restart loads the model first. The latest cold smoke
returned ready with about `12s` total latency and `firstAudioMs=27ms`.

## Remaining Release Work

- Expose the service through reviewed HTTPS if it must be used outside
  Tailscale.
- Feed this endpoint into Call Link Worker and PSTN Bridge playback tests.
- Run long sentence, fast speech, English, noisy audio, concurrent calls, and
  8 kHz phone-band playback acceptance.
