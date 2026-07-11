# ASR Service

HTTP ASR service used by `services/realtime-gateway` when `ASR_PROVIDER=http`.

## Run

```bash
cd services/model-services/asr-service
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[test]"
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

## Endpoints

- `GET /health`
- `POST /asr/transcribe`
- `POST /asr/sessions/{sessionId}/flush`

`POST /asr/transcribe` returns `204 No Content` when no final transcript is ready yet.
`POST /asr/sessions/{sessionId}/flush` forces the active speech buffer to be
recognized, which is useful before pause or end.
The default provider is `mock`; SenseVoice can be added behind the same engine interface.

## FireRedASR2-AED

```bash
python -m pip install -e ".[firered,test]"
ASR_SERVICE_PROVIDER=fireredasr2_aed \
ASR_MODEL_VERSION=FireRedASR2-AED \
ASR_FIRERED_MODEL_DIR=/data/models/translation-model-eval/models/fireredasr2_aed \
ASR_FIRERED_USE_GPU=true \
ASR_FIRERED_BEAM_SIZE=1 \
ASR_FIRERED_MIN_AUDIO_MS=1200 \
ASR_FIRERED_ENDPOINT_SILENCE_MS=600 \
ASR_FIRERED_MAX_AUDIO_MS=8000 \
ASR_FIRERED_PREROLL_MS=200 \
ASR_FIRERED_VAD_ENERGY_THRESHOLD=350 \
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

The FireRedASR2-AED provider uses the same PCM16 segmentation behavior as the
other ASR engines. Its local checkpoint loader allows compatible extra CTC keys
in the released AED checkpoint, which keeps the runtime tied to the checked
model directory instead of downloading from ModelScope at service start.

## SenseVoice

```bash
python -m pip install -e ".[sensevoice,test]"
ASR_SERVICE_PROVIDER=sensevoice \
ASR_MODEL_VERSION=iic/SenseVoiceSmall \
ASR_SENSEVOICE_MODEL=iic/SenseVoiceSmall \
ASR_SENSEVOICE_DEVICE=cpu \
ASR_SENSEVOICE_MIN_AUDIO_MS=1200 \
ASR_SENSEVOICE_ENDPOINT_SILENCE_MS=600 \
ASR_SENSEVOICE_MAX_AUDIO_MS=8000 \
ASR_SENSEVOICE_PREROLL_MS=200 \
ASR_SENSEVOICE_VAD_ENERGY_THRESHOLD=350 \
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

The SenseVoice provider buffers incoming 24 kHz PCM16 frames, ignores leading
silence with a simple RMS VAD, emits a segment after endpoint silence, flushes
long speech at `ASR_SENSEVOICE_MAX_AUDIO_MS`, and suppresses adjacent duplicate
transcripts.

For local POC, use Python 3.10 or 3.11 if FunASR or Torch wheels are not
available for the system Python version.
