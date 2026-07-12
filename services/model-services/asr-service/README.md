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
- `GET /asr/sessions/{sessionId}/diagnostics`

`POST /asr/transcribe` returns `204 No Content` when no final transcript is ready yet.
`POST /asr/sessions/{sessionId}/flush` forces the active speech buffer to be
recognized, which is useful before pause or end.
The default provider is `mock`; SenseVoice can be added behind the same engine interface.

## Server VAD

Production online ASR uses `nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0`
through an in-process ONNX CPU runtime. NeMo is required only to export the
ONNX network and its pinned Mel preprocessing assets. RMS remains an automatic
fallback when assets cannot load or inference fails.

Session diagnostics report the configured and active VAD provider, fallback
reason/count, speech-frame ratio, probability summary, model fingerprint, and
the frozen endpoint policy. They never include PCM or frame-level probability
arrays.

```bash
ASR_VAD_PROVIDER=marblenet \
ASR_VAD_MODEL_PATH=/data/models/translation-model-eval/models/frame_vad_multilingual_marblenet_v2/frame_vad_multilingual_marblenet_v2.0.onnx \
ASR_VAD_ASSETS_PATH=/data/models/translation-model-eval/models/frame_vad_multilingual_marblenet_v2/frame_vad_multilingual_marblenet_v2.0.preprocessor.npz \
ASR_VAD_THRESHOLD=0.5 \
ASR_VAD_WINDOW_MS=1000 \
ASR_VAD_SMOOTHING_FRAMES=3
```

Use `0.5` as the default threshold. `0.7` remains the stricter deployment
preset for later noisy-environment comparison. The App must still gate TTS
playback because VAD alone cannot distinguish device playback from live speech.

Qwen3 ASR freezes one endpoint policy per session. Realtime `conversation`,
`listening`, `call_link`, and `pstn` sessions therefore remain isolated even
when processed concurrently. The deployment defaults use 900, 1400, 900, and
1100 ms endpoint silence respectively; tune them only through the corresponding
`ASR_QWEN3_*_ENDPOINT_SILENCE_MS` variables.

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
silence with the configured VAD provider, emits a segment after endpoint silence, flushes
long speech at `ASR_SENSEVOICE_MAX_AUDIO_MS`, and suppresses adjacent duplicate
transcripts.

For local POC, use Python 3.10 or 3.11 if FunASR or Torch wheels are not
available for the system Python version.
