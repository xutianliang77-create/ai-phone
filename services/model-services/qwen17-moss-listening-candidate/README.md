# Qwen 1.7 + MOSS listening candidate

This service is an isolated, non-release candidate for real-device validation.
It implements the frozen listening strategy:

- Qwen3-ASR-1.7B vLLM streaming with `500/700/900/1000ms` decode totals,
  then 1000ms steady decoding.
- A partial is returned only after two consecutive decodes share a readable
  prefix of at least two Unicode letter/number units.
- Qwen final text is returned before revision.
- MOSS runs only when the Qwen final contains an adjacent duplicate word.
- MOSS receives up to 1500ms of leading audio while Qwen keeps the evaluated
  400ms recognition preroll; this preserves revision context without delaying
  the first stable Qwen partial.
- The full MOSS transcript is never applied. MOSS may only confirm deletion of
  the second adjacent duplicate while all Qwen numeric and protected Latin
  surfaces remain unchanged.
- Listening VAD uses the multilingual MarbleNet v2 ONNX model with a 0.05
  probability threshold, 1000ms window, and three-frame smoothing. The
  fixed PCM RMS gate is retained only as a visible runtime-failure fallback.
- The endpoint rejects modes other than `listening`.

For an explicitly authorized real-device diagnosis, a bounded one-shot PCM WAV
capture can be enabled under the isolated candidate root. It is disabled by
default, limits both session count and seconds, and creates mode-0600 files.

The model paths are runtime configuration. Model weights and isolated
evaluation data are not copied into this source tree or release assets.
