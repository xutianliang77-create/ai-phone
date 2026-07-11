# Beelink TTS Product Fit Report

Test time: 2026-07-05 00:13 +0800

Data root: `/data/models/translation-model-eval/data/tts-product-fit`

## Scope

Product-fit TTS smoke for local/cross-platform/call mode:

- Chinese meeting sentence
- English call sentence
- Chinese amount + SKU/domain term sentence
- Qwen3-ASR proxy check under `wideband16k`, `phone8k_up16k`, `phone8k_up16k_snr15`

## Results

| Rank | Model | Runtime result | Streaming | First audio | RTF | ASR proxy pass | Product judgment |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | VoxCPM2 | OK | audio chunks | 22-32ms | 0.191-0.193 | 6/9 | Best realtime candidate. Very fast, good Chinese/English, SKU still needs term handling. |
| 2 | Chatterbox Multilingual V3 | OK | no public Python streaming API | 608-1206ms | 0.222-0.413 | 6/9 | Good quality fallback/offline batch candidate, but less suitable for live call streaming. |
| 3 | Qwen3-TTS CustomVoice | OK | simulated only | 2478-3203ms | 0.482-0.563 | 3/9 | Stable ordinary Chinese, weak English phrase and SKU, not true streaming in current Python path. |
| 4 | Fun-CosyVoice3 0.5B | OK | audio chunks | 1030-1267ms | 0.288-0.313 | 0/9 | Runtime works, but short zero-shot product sentences are not intelligible with current prompt/runtime. |

## Notes

- VoxCPM2 required an explicit `model.safetensors` download; normal snapshot initially missed the large Xet/LFS weight.
- Chatterbox required explicit `ve.pt`, `t3_mtl23ls_v2.safetensors`, and `s3gen.pt` downloads.
- CosyVoice3 required `x-transformers`; after installation it ran, but ASR proxy showed severe intelligibility failure for short sentences.
- Domain/SKU handling remains a common weak point. VoxCPM2 produced `A幺二零`, which is understandable but does not match the current expected normalization `A一百二十`.

## Recommendation

Use VoxCPM2 as the next server-side realtime TTS candidate for call mode. Keep Chatterbox as quality fallback for non-streaming or less latency-sensitive output. Keep Qwen3-TTS only as baseline. Do not use CosyVoice3 for this product path unless we build a better prompt/reference strategy and retest.

