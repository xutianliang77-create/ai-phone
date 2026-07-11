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
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8022
```
