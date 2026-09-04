# TTS Service

HTTP TTS service used by `services/translation-worker` when `TTS_PROVIDER=http`.

## Run Mock

```bash
cd services/model-services/tts-service
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[test]"
TTS_SERVICE_API_KEY=local-dev-tts-secret \
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

## Endpoints

- `GET /health`
- `POST /tts/synthesize`

The default provider is `mock`. It emits deterministic PCM16 audio for local
contract tests only.

## VoxCPM2

```bash
python -m pip install -e ".[test,voxcpm2]"
TTS_SERVICE_PROVIDER=voxcpm2 \
TTS_MODEL_VERSION=VoxCPM2 \
TTS_SERVICE_API_KEY=replace-with-strong-tts-key \
TTS_VOXCPM2_MODEL_DIR=/data/models/translation-model-eval/data/tts-product-fit/models/openbmb_voxcpm2 \
TTS_VOXCPM2_REQUIRE_STREAMING=true \
TTS_VOXCPM2_INFERENCE_WAIT_MS=15000 \
TTS_VOICE_REFERENCE_DIR=/data/ai-phone/voice-references \
uvicorn app.main:app --host 0.0.0.0 --port 8002
```

`GET /health` returns `degraded` until the VoxCPM2 runtime and model directory
are available. `POST /tts/synthesize` returns `503` instead of fake audio when
VoxCPM2 cannot load.

VoxCPM2 currently emits 48 kHz PCM. The service uses polyphase resampling to
produce the 24 kHz realtime protocol payload; it never relabels 48 kHz samples
as 24 kHz. Health and synthesis responses expose `modelSampleRate` and
`outputSampleRate` so this invariant can be monitored.

The VoxCPM2 model instance is single-flight because its KV cache is mutable.
Whole-response and streaming inference share the same gate. Concurrent callers
wait up to `TTS_VOXCPM2_INFERENCE_WAIT_MS` before receiving `503`; cancellation
releases the gate without allowing another request to overlap the active model.

## Local Contract Smoke

```bash
TTS_HTTP_ENDPOINT=http://127.0.0.1:8002/tts/synthesize \
TTS_HTTP_API_KEY=local-dev-tts-secret \
npm run check:tts-provider -- \
  --provider mock \
  --model mock-tts-v0.1.0 \
  --json
```

The P1 streaming and warmup endpoints are `POST /tts/stream` (NDJSON PCM
chunks) and `POST /tts/warmup` (single-flight, cached after the first
synthesis). VoxCPM2 streaming calls the model's `generate_streaming()` iterator;
it does not synthesize a complete payload before emitting chunks. Disconnects
close the iterator after the in-flight model chunk returns. The Worker keeps the
stream endpoint opt-in so the whole-response path remains a one-variable
rollback. A VoxCPM2 runtime without `generate_streaming()` fails the stream
request instead of silently returning pseudo-streamed audio.

Run the staging latency gate after the service is warm and before promotion:

```bash
python scripts/tts_latency_gate.py \
  --base-url http://127.0.0.1:8002 \
  --api-key "$TTS_HTTP_API_KEY"
```

The gate keeps the whole-response latency metrics for compatibility, but its
first-audio release threshold is applied to the client-observed arrival of the
first playable PCM chunk from `/tts/stream`. `streamModelFirstAudioMs` records
the model-reported value separately so transport buffering cannot be hidden.

For release readiness, use the real VoxCPM2 endpoint and keep the default
`provider=voxcpm2` and `model=VoxCPM2`. Set `TTS_SERVICE_API_KEY` on the
service and use the same secret as `TTS_HTTP_API_KEY` in the Worker/release
environment.

## Voice simulation

`POST /tts/synthesize` accepts an optional `voice` object:

```json
{
  "mode": "personal_clone",
  "voiceProfileId": "my_voice",
  "referenceAudioId": "my_voice",
  "controlPrompt": "clear and calm"
}
```

Supported modes:

- `preset`: normal VoxCPM2 voice prompt.
- `voice_design`: no reference audio; uses `controlPrompt` for voice style.
- `personal_clone`: uses `referenceAudioId`.
- `ultimate_clone`: uses `referenceAudioId` and `referenceTranscript`.

For cloning modes, `referenceAudioId` resolves to
`$TTS_VOICE_REFERENCE_DIR/<referenceAudioId>.wav`. The API intentionally does
not accept arbitrary file paths.
