# Speaker Service

Internal speaker-attribution service for ai phone.

- `mock`: protocol and integration tests only.
- `sortformer_shadow`: runs NVIDIA Streaming Sortformer v2.1 with persistent per-session streaming state and returns anonymous spans.

The shadow provider is not a production claim. Enable user-visible labels only after the fixed Chinese, mixed-language, noisy, overlap, four-speaker, and 30-minute gates pass.

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest
```

For Sortformer, install NeMo according to NVIDIA's model card, then run:

```bash
SPEAKER_MODEL_PROVIDER=sortformer_shadow \
  SPEAKER_MODEL_ID=/data/models/translation-model-eval/models/sortformer/diar_streaming_sortformer_4spk-v2.1.nemo \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8022
```

The shadow runtime uses NeMo's low-latency profile, preserves AOSC/FIFO state for
the life of a session, and continuously resamples 24 kHz mobile PCM to the
model's 16 kHz input. Active spans are provisional (`final=false`) until the
speaker becomes inactive or the session is flushed.

Keep the Gateway provider disabled until the natural-speech suite, 30-minute
stability run, and a real-device multi-speaker run all pass.

Use `scripts/stream_speaker_service_eval.py --realtime` when the acceptance
requires wall-clock pacing instead of accelerated audio replay.

Score a captured prediction with pyannote's diarization metric:

```bash
python scripts/evaluate_speaker_predictions.py \
  --suite eval/suite.json \
  --predictions eval/predictions.json \
  --output eval/report.json
```
