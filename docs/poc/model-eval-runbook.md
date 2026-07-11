# Model Eval Runbook

Version: v0.4  
Date: 2026-07-05

## Goal

Use one fixture format to compare ASR, translation and TTS candidates before
replacing the current iOS CoreML/Nemotron mobile ASR path.

The product optimization plan is `docs/domestic-edition-optimization-plan.md`.
Use RTranslator, LiveKit Agents, Pot Desktop and Translumo only as product and
engineering references; do not copy code, assets or models with unclear
commercial terms.

## Default Smoke

```bash
npm run model:evaluate -- --json --no-save
```

The default fixture is:

```text
model-eval/fixtures/cn-en-smoke.json
```

It records captured outputs and scores:

- ASR character error rate.
- ASR word error rate.
- ASR language match.
- ASR language confidence.
- ASR latency.
- Translation similarity.
- Translation protected term retention.
- Translation latency.
- TTS first audio latency.
- TTS audio availability.
- TTS phone-band intelligibility.

The default fixture must cover all `requiredGroups`; missing groups fail the
gate even if the existing cases pass.

## Comprehensive Mode Test

Use this before final model selection:

```bash
npm run check:comprehensive-models -- --json
```

This command combines local on-device checks, cross-platform/call media-loop
checks, Beelink model artifacts and the real candidate fixture:

```text
model-eval/fixtures/cn-en-comprehensive-real.json
```

The comprehensive fixture is allowed to be `not_ready` while gray candidates
are still under evaluation. Treat its failures as the current candidate
optimization list, not as a broken smoke test.

## iPhone 14 On-Device Small Models

Use this plan before promoting any custom on-device model to the iPhone 14
local mode:

```text
docs/poc/iphone14-on-device-small-model-test-plan.md
```

The iPhone 14 local mode should treat Apple Speech or the current iOS
CoreML/Nemotron ASR, iOS Translation framework, NaturalLanguage and
AVSpeechSynthesizer as the baseline. Custom VAD, language ID, ASR,
diarization, translation and TTS candidates must beat or complement that
baseline without causing crashes, thermal throttling or unacceptable battery
drain.

## Adding A Candidate

1. Run the candidate model with the same test sentence or audio.
2. Add one result object to the fixture with `provider`, `model`,
   expected output and actual output.
3. Rerun:

```bash
npm run model:evaluate -- --fixture model-eval/fixtures/cn-en-smoke.json --json
```

## Candidate Priority

Recommended first comparison:

- ASR: current iOS Nemotron, FluidInference/qwen3-asr-0.6b-coreml, Qwen3-ASR server, FireRedASR2, FunASR/SenseVoice.
- Translation: Qwen, Hy-MT2, LMT-60, MADLAD400, SeamlessM4T and current LM Studio route.
- TTS: Qwen3-TTS, CosyVoice, system TTS.

### Translation Product-Fit Batch

Use this batch to decide whether a self-hosted translation provider can replace
or supplement the Qwen commercial quality route for call translation.

Remote data root:

```text
/data/models/translation-model-eval/data/translation-product-fit
```

Candidate order:

| Priority | Model | Test purpose |
| --- | --- | --- |
| P0 | `tencent/Hy-MT2-1.8B-GGUF` | Practical self-hosted deployment candidate for llama.cpp or LM Studio |
| P0 | `tencent/Hy-MT2-1.8B` | Domestic server-side translation main model |
| P0 | `NiuTrans/LMT-60-1.7B-Base` | Larger LMT candidate versus the current `LMT-60-0.6B` |
| P1 | `google/madlad400-3b-mt` | Broad multilingual MT baseline, especially for non-Chinese expansion |
| P1 | `facebook/seamless-m4t-v2-large` | Speech/text translation research baseline, not a commercial default |
| Baseline | `NiuTrans/LMT-60-0.6B` | Current low-latency open-source translation baseline |
| Baseline | `qwen-plus` | Commercial quality fallback |

Latest completed report:

```text
docs/poc/translation-product-fit-beelink-report.md
```

Minimum test groups:

- Normal Chinese to English and English to Chinese short utterances.
- Long meeting sentences and phone-support sentences.
- Mixed Chinese-English turns with auto direction detection.
- ASR dirty text: missing punctuation, duplicate fragments and homophones.
- Domain terms: names, addresses, SKU, money, dates and product terms.
- Formatting: JSON-like fields, table rows and subtitle segments.

Pass targets for call translation:

| Metric | Target |
| --- | --- |
| Short sentence P50 latency | `<= 500ms` |
| Short sentence P95 latency | `<= 1200ms` |
| Long sentence P95 latency | `<= 2500ms` |
| Protected term retention | `>= 98%` |
| Usable translation rate | `>= 90%` |
| No extra explanation | `>= 98%` |
| Mixed-language direction accuracy | `>= 90%` |

Do not change `release/domestic/model-selection-report.json` until this batch
has real generation outputs, latency data and an error-case review.

Required fixture groups:

- Chinese fast speech and long sentences.
- English short dialogue.
- Chinese-English code switching.
- Meeting, logistics, address, number, name and product terminology.
- Movie speaker playback, noisy room and song/BGM samples.

### iPhone Qwen3-ASR CoreML Batch

Use this batch to evaluate `FluidInference/qwen3-asr-0.6b-coreml` without
touching the production app.

Detailed task plan:

```text
docs/poc/qwen3-asr-coreml-iphone14-test-tasks.md
```

Provider and model naming:

| Field | Value |
| --- | --- |
| `providerId` | `coreml_qwen3_asr` |
| `modelId` | `qwen3_asr_0_6b_coreml_int8` first, then `qwen3_asr_0_6b_coreml_f32` |
| Repo | `FluidInference/qwen3-asr-0.6b-coreml` |
| Test app | `test-apps/iphone14_model_tester` |
| Test set | `data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl` |

Execution order:

1. Stage `int8/` to the independent test app sandbox.
2. Smoke `zh_short_001`, `en_short_001` and `mixed_001`.
3. Run the full P0 ASR set.
4. Compare against Apple Speech, CoreML/Nemotron 2240ms and server
   Qwen3-ASR-0.6B tuned v3 fixed score.
5. Only stage `f32/` after `int8` proves stable.

Result requirements:

- Write JSONL under `data/model-eval/iphone14-small-models/results/device-pulls/single`.
- Generate a `summary.json` and `summary.md` under a model-specific result folder.
- Do not promote the provider to product code until the independent tester has
  completed P0 without crashes.

## Release Rule

Do not replace the current iOS mobile ASR unless the candidate has better
accuracy on Chinese fast speech and mixed Chinese-English cases without worse
latency in the same fixture set.

For Call Link or PSTN release, TTS candidates must also pass first-audio
latency and phone-band intelligibility checks.

Current model selection status is selected for the domestic MVP defaults. The
formal report is:

```text
release/domestic/model-selection-report.json
```

Keep this report focused on product defaults. Do not promote gray candidates to
defaults until the comprehensive fixture and real media tests pass.

After changing ASR, translation or TTS defaults, update:

```text
release/domestic/model-selection-report.json
```

Use `release/domestic/model-selection-report.example.json` as the schema
reference, then run:

```bash
npm run check:model-selection-ready -- --json
```

## Case Fields

Common:

- `id`, `type`, `group`, `provider`, `model`.
- `latencyMs` for ASR and translation.

ASR:

- `expectedLanguage`, `actualLanguage`, `languageConfidence`.
- `expectedText`, `actualText`.

Translation:

- `expectedText`, `actualText`.
- `protectedTerms` for numbers, names, addresses, SKUs and domain terms.

TTS:

- `producedAudio`, `firstAudioMs`, `audioDurationMs`.
- `phoneBandScore`, scored from 1 to 5 after narrow-band playback.
