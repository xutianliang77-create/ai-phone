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
when processed concurrently. The deployment defaults use 600, 1400, 600, and
1100 ms endpoint silence respectively. The 600 ms conversation/call-link
candidate retained 26/27 accuracy in three repeated RTX 5090 runs on 2026-07-23;
listening and PSTN keep their longer safety windows. Tune them only through the
corresponding `ASR_QWEN3_*_ENDPOINT_SILENCE_MS` variables.

All modes inherit `ASR_VAD_THRESHOLD=0.5` unless a mode-specific override is
set. `ASR_QWEN3_LISTENING_VAD_THRESHOLD=0.05` is the isolated low-volume
listening/meeting candidate; it does not change `conversation`, `call_link`, or
`pstn`. Leaving the variable unset keeps the global threshold. The effective
per-mode thresholds are included in the runtime and endpoint-policy
fingerprints and in session diagnostics.

`ASR_QWEN3_LISTENING_STABLE_PARTIAL_ENABLED=false` keeps the production-safe
default. When enabled on the vLLM provider, only `listening` sessions with
explicit Chinese or auto-detected Chinese can emit stable partials. The frozen
decode schedule is 500/700/900/1000 ms, followed by one-second updates. A
partial is published only when adjacent model decodes share at least two
effective letters or numbers; single-character `嗯/啊/呃/哦` fillers are ignored
only for the comparison. Batch final remains authoritative and reuses the same
segment ID with a newer revision. Other modes and non-Chinese auto detections
continue to emit final transcripts only. Streaming pushes use one in-flight
decode per session: audio intake never waits for a partial, frames received
during inference are coalesced into the next push, and endpoint finalization
invalidates pending partial work before the batch final takes the model lock.
Session diagnostics expose only bounded scheduler counters and latency values;
they never persist pending audio or candidate text.

`ASR_QWEN3_MIXED_LANGUAGE_RETRY_ENABLED=false` remains off by default. In an
isolated A/B run it can retry an `auto` segment with the English route when the
first result contains only Chinese. The retry is accepted only when it restores
an English prefix while preserving the complete Chinese suffix. Do not enable
it in production until mixed-language accuracy and ASR latency both pass their
staging gates, because eligible segments require a second inference.

## Qwen3-ASR 1.7B vLLM resident provider

`qwen3_asr_vllm` keeps the evaluated Qwen3-ASR 1.7B vLLM 0.14 runtime isolated
from the shared model-service environment. Uvicorn starts immediately, while
`GET /health` and `GET /ready` return `503` during model loading and warmup.
Readiness is published only after one-second Chinese and auto-language warmups.
The default admission limit is one active session; excess sessions receive
`429` instead of being silently queued.

```bash
VLLM_ENABLE_V1_MULTIPROCESSING=0 \
ASR_SERVICE_PROVIDER=qwen3_asr_vllm \
ASR_MODEL_VERSION=Qwen3-ASR-1.7B-vLLM0.14 \
ASR_QWEN3_MODEL_DIR=/data/models/translation-model-eval/data/unified-multilingual-eval/experiments/asr-replacement-ab-v1-20260723/models/qwen3_asr_1_7b_modelscope \
ASR_QWEN3_DTYPE=bfloat16 \
ASR_QWEN3_LISTENING_STABLE_PARTIAL_ENABLED=false \
ASR_QWEN3_VLLM_GPU_MEMORY_UTILIZATION=0.35 \
ASR_QWEN3_VLLM_MAX_MODEL_LEN=8192 \
ASR_QWEN3_VLLM_MAX_NUM_SEQS=1 \
ASR_QWEN3_VLLM_ENFORCE_EAGER=true \
ASR_QWEN3_VLLM_UNFIXED_CHUNK_NUM=7 \
ASR_QWEN3_VLLM_UNFIXED_TOKEN_NUM=5 \
ASR_QWEN3_STARTUP_TIMEOUT_MS=30000 \
ASR_QWEN3_MAX_ACTIVE_SESSIONS=1 \
uvicorn app.main:app --host 127.0.0.1 --port 8021
```

If the isolated vLLM environment does not include ONNX Runtime, point
`ASR_ONNXRUNTIME_SITE_PACKAGES` at the existing pinned ONNX Runtime
site-packages directory. The path is appended only after a direct import fails;
the vLLM environment remains authoritative for all other packages.

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
