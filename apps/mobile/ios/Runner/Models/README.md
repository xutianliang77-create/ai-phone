# iOS Core ML Nemotron ASR Model

Place one compiled Core ML model bundle here only for local device builds.

Supported split INT8 layout:

```text
NemotronASRStreaming/
  encoder.mlmodelc/
  decoder.mlmodelc/
  joint.mlmodelc/
  vocab.json
  languages.json
  config.json
```

Supported FluidInference tier layout:

```text
multilingual/2240ms/
  preprocessor.mlmodelc/
  encoder.mlmodelc/
  decoder.mlmodelc/
  joint.mlmodelc/
  decoder_joint.mlmodelc/
  metadata.json
  tokenizer.json
```

The app also checks this runtime path:

```text
Documents/Models/NemotronASRStreaming/
Documents/Models/multilingual/2240ms/
Documents/Models/latin/2240ms/
```

FluidAudio Silero VAD is staged separately for offline device startup:

```text
Runner/Models/vad/silero-vad-unified-256ms-v6.0.0.mlmodelc/
```

From the repository root:

```bash
HF_ENDPOINT=https://hf-mirror.com npm run ios:vad:stage
```

For development builds, the app can also ask FluidAudio to download and cache
the matching FluidInference variant at runtime:

```bash
--dart-define=DEVICE_ASR_AUTO_DOWNLOAD_MODEL=true
--dart-define=DEVICE_ASR_MODEL_CHUNK_MS=2240
```

The iPhone smoke script defaults runtime download to on. When you explicitly
run with `DEVICE_ASR_AUTO_DOWNLOAD_MODEL=false`, it validates this folder before
launching ASR modes. Use `DEVICE_ASR_SKIP_LOCAL_MODEL_PREFLIGHT=true` only when
the model is already present in the iPhone Documents model cache.

The model bundle is intentionally not committed because Core ML Nemotron ASR
exports are hundreds of MB to GB scale. The native bridge discovers the split
Core ML bundle, exposes model input/output inspection, and uses FluidAudio's
Nemotron multilingual streaming manager for RNNT decoding when the app is built
with the FluidAudio Swift package.

Validate a local bundle before building or copying it to a device:

```bash
scripts/validate_ios_nemotron_bundle.mjs \
  apps/mobile/ios/Runner/Models/multilingual/2240ms
```

Download, validate, and stage the default FluidInference tier:

```bash
scripts/download_ios_nemotron_bundle.mjs \
  --family multilingual \
  --tier 2240ms \
  --stage
```

The downloader supports `HF_TOKEN` / `HUGGINGFACE_TOKEN` and `HF_ENDPOINT` for a
Hugging Face mirror. Use `--dry-run` to inspect the file plan first.

Stage a downloaded FluidInference tier into the Runner bundle candidates:

```bash
scripts/stage_ios_nemotron_bundle.mjs \
  /path/to/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML/multilingual/2240ms \
  --family multilingual \
  --tier 2240ms
```

The staging script validates the source before copying and refuses to overwrite
an existing bundle unless `--force` is passed.

Inspect all default bundle candidates without failing when the model has not
been copied yet:

```bash
scripts/validate_ios_nemotron_bundle.mjs --json --allow-missing
```

The validator uses the same readiness rule as the iOS native bridge:
`preprocessor.mlmodelc`, `metadata.json`, and `tokenizer.json` or `vocab.json`
must exist in addition to the Core ML encoder/decoder components.
