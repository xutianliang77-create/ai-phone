# Speaker Service

Internal speaker-attribution service for ai phone.

- `mock`: protocol and integration tests only.
- `sortformer`: production-enabled NVIDIA Streaming Sortformer v2.1 with persistent per-session streaming state and anonymous speaker spans.
- `sortformer_shadow`: runs the same engine for evaluation without claiming user-visible production readiness.

Use `sortformer` only after the fixed Chinese, mixed-language, noisy, overlap, four-speaker, and 30-minute gates pass.

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest
```

For Sortformer, install NeMo according to NVIDIA's model card, then run:

```bash
SPEAKER_MODEL_PROVIDER=sortformer \
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

For human recordings, first convert the annotation from RTTM to a suite with
`scripts/rttm_to_speaker_suite.py`. Recordings without RTTM must use
`scripts/summarize_speaker_shadow.py`; that report deliberately leaves DER as
`null` and cannot pass a quality gate.
