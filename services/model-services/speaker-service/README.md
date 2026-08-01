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

The deployed meeting profile keeps NVIDIA's low-latency
`6/7/188/144/188` chunk and cache settings plus `onset=offset=0.5`.
`SPEAKER_MIN_DURATION_OFF_MS=320` merges only short gaps from the same
anonymous speaker; it does not delay a newly detected speaker.
`SPEAKER_MIN_DURATION_ON_MS=100` can keep a new anonymous slot pending until
two 80 ms model frames agree, while preserving the original onset when it is
confirmed. It remains `0` by default and requires the fixed speaker gates before
deployment.
`SPEAKER_PAD_OFFSET_MS=0` avoids the fast-switch false alarms observed with
the upstream CallHome padding profile.

Keep the Gateway provider disabled until the natural-speech suite, 30-minute
stability run, and a real-device multi-speaker run all pass.

## Session-local anonymous alias candidate

`SESSION_SPEAKER_ALIAS_PROVIDER=nemo_titanet` enables an isolated, default-off
candidate that compares at least 1.5 seconds of non-overlap audio from raw
Sortformer slots. Embeddings stay in memory for one speaker session and are
deleted when the session closes; they are not persisted and do not identify a
person across recordings.

The candidate endpoint returns raw-slot similarity evidence only:

```text
POST /speaker/sessions/{sessionId}/aliases/observe
```

The Gateway candidate keeps the raw `speaker_N`, applies the isolated
`cosine >= 0.60` policy, and can generate `speaker.updated` revisions. MOSS may
only veto a merge that would collapse a known multi-speaker session to one; it
must never initiate a merge. Overlap evidence is diagnostic-only. Do not enable
this candidate in the 8022 service or Gateway until the fixed AliMeeting
`40+10`, 8×90-second session, channel-shift, false-merge, revision-latency, and
real-device gates pass.

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
