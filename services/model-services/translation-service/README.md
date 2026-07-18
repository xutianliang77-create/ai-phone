# Translation Model Service

OpenAI-compatible HTTP service for server-side translation.

Default production route:

- Provider: `hymt2_self_hosted`
- Model: `tencent/Hy-MT2-1.8B`
- Endpoint: `/v1/chat/completions`

Local mock:

```bash
cd services/model-services/translation-service
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

Hy-MT2:

```bash
pip install -e '.[hymt2]'
TRANSLATION_SERVICE_PROVIDER=hymt2 \
TRANSLATION_MODEL_VERSION=tencent/Hy-MT2-1.8B \
TRANSLATION_HYMT2_MODEL_DIR=/data/models/translation-model-eval/data/translation-product-fit/models/hymt2_1_8b \
uvicorn app.main:app --host 0.0.0.0 --port 8003
```

Production admission defaults are one concurrent model execution, a bounded queue of 64,
a 2-second queue timeout, and non-streaming micro-batches of up to four requests collected
for 8 ms. Configure them with `TRANSLATION_MAX_CONCURRENCY`,
`TRANSLATION_MAX_QUEUE_SIZE`, `TRANSLATION_QUEUE_TIMEOUT_MS`,
`TRANSLATION_MICRO_BATCH_SIZE`, and `TRANSLATION_MICRO_BATCH_WINDOW_MS`.
Streaming requests share the same execution limit but are never mixed into a batch.

Then point Gateway and Translation Worker at it:

```bash
REALTIME_PROVIDER=hymt2_self_hosted
TRANSLATION_BASE_URL=http://127.0.0.1:8003/v1
TRANSLATION_MODEL=tencent/Hy-MT2-1.8B
```

Hy-MT2 reference: https://huggingface.co/tencent/Hy-MT2-1.8B
