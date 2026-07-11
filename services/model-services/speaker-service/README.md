# Speaker Service

Internal speaker-attribution service for ai phone.

- `mock`: protocol and integration tests only.
- `sortformer_shadow`: runs NVIDIA Streaming Sortformer v2.1 over the current session context and returns stabilized anonymous spans.

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

The shadow runtime uses a bounded rolling context and aligns anonymous labels
across overlapping windows. Keep the Gateway provider disabled until the fixed
suite and a real-device multi-speaker run both pass.

Use `scripts/stream_speaker_service_eval.py --realtime` when the acceptance
requires wall-clock pacing instead of accelerated audio replay.
