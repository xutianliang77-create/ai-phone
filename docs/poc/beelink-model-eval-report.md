# Beelink 模型评测报告

更新时间：2026-07-05

## 目标

在 Beelink 机器上下载并初评 5 个候选模型，为中英同传 App 后续服务端模型选型提供证据：

- ASR：Qwen3-ASR-0.6B、FireRedASR2-AED
- 翻译：LMT-60-0.6B
- TTS：Qwen3-TTS-12Hz-0.6B-CustomVoice、CosyVoice2-0.5B

## 环境

- 机器：Beelink
- SSH：`beelink@100.110.127.117`
- GPU：RTX 5090 32GB
- 远端工作目录：`/data/models/translation-model-eval`
- 本地脚手架：`model-eval/beelink`
- 本地结果缓存：`.cache/model-eval/beelink-model-eval-summary.json`

## 下载结果

普通 `git lfs pull` 在 Hugging Face mirror 的 LFS CDN 解析上失败，因此改用 `hf-mirror.com/<repo>/resolve/main/<file>` 逐文件断点续传。下载完整性由 `scripts/inspect_downloads.py` 校验。

| 模型 | 任务 | 仓库 | 状态 | 大小 |
| --- | --- | --- | --- | --- |
| Qwen3-ASR-0.6B | ASR | `Qwen/Qwen3-ASR-0.6B` | 完整 | 1.88 GB |
| FireRedASR2-AED | ASR | `FireRedTeam/FireRedASR2-AED` | 完整 | 4.73 GB |
| LMT-60-0.6B | 翻译 | `NiuTrans/LMT-60-0.6B` | 完整 | 1.52 GB |
| Qwen3-TTS-12Hz-0.6B-CustomVoice | TTS | `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | 完整 | 2.50 GB |
| CosyVoice2-0.5B | TTS | `FunAudioLLM/CosyVoice2-0.5B` | 完整 | 4.86 GB |

总下载量约 15.49 GB。所有模型均无残留 LFS pointer。

## 翻译评测：LMT-60-0.6B

运行方式：本地 Transformers 加载模型到 CUDA，使用 5 条中英测试样本。

| 样本 | 方向 | 延迟 | 结果摘要 |
| --- | --- | --- | --- |
| 会议长句 | 中译英 | 426 ms | 语义正确，表达自然，会议室译为 conference room 可接受 |
| 简短问句 | 英译中 | 36 ms | 输出“你的名字是什么？”，语义正确但不如“你叫什么名字？”口语 |
| 术语数字 | 中译英 | 203 ms | `SKU A-120`、`20,000 yuan`、报关资料保持正确 |
| 商务句 | 英译中 | 94 ms | 语义基本正确，“在我开会后”略生硬 |
| 中英混合 | 混合 | 74 ms | 会重复翻译同义问题，自动语种混合场景需上层分句控制 |

结论：LMT-60-0.6B 延迟低、数字和 SKU 保持好，适合做服务端轻量翻译候选。短句口语化和中英混合去重需要在 App/Gateway 层继续处理。

## 翻译追加待测批次

新增候选不改变当前产品默认链路，先统一放入 Beelink
`/data/models/translation-model-eval/data/translation-product-fit` 批次。

| 优先级 | 模型 | 目标 |
| --- | --- | --- |
| P0 | `tencent/Hy-MT2-1.8B-GGUF` | 优先验证自托管低延迟部署，重点看中英混合和术语 |
| P0 | `tencent/Hy-MT2-1.8B` | BF16 质量基准，和 Qwen 商业质量路由对齐比较 |
| P0 | `NiuTrans/LMT-60-1.7B-Base` | 对比 LMT-60-0.6B，确认是否改善重复翻译和语义稳定性 |
| P1 | `google/madlad400-3b-mt` | 多语种文本翻译基线，评估中英之外扩展价值 |
| P1 | `facebook/seamless-m4t-v2-large` | 语音/文本一体化研究基线，不作为商业默认候选 |

测试通过后再同步 `release/domestic/model-selection-report.json`，否则只保留为灰度或研究项。

## TTS 评测：Qwen3-TTS

输入文本：`今天下午三点我们在会议室讨论产品计划。`

基础结果：

- 输出文件：`outputs/qwen3-tts-smoke.wav`
- 采样率：24 kHz
- 样本数：97,920
- 非流式推理延迟：2,347 ms

官方公开 streaming 路径复测：

| 语言 | 模式 | 返回完整音频耗时 | 音频时长 | RTF | ASR 代理 |
| --- | --- | --- | --- | --- | --- |
| 中文 | `non_streaming_mode=True` | `2334ms` | `4160ms` | `0.561` | - |
| 中文 | `non_streaming_mode=False` | `1926ms` | `4080ms` | `0.472` | Qwen3-ASR 识别通过，CER `0.0` |
| 英文 | `non_streaming_mode=True` | `2528ms` | `4960ms` | `0.510` | - |
| 英文 | `non_streaming_mode=False` | `2508ms` | `5360ms` | `0.468` | Qwen3-ASR 识别通过，WER `0.2222` |

注意：`non_streaming_mode=False` 是官方公开 Python 包目前可用的低延迟开关，但本轮源码和实测都显示它仍返回完整 `wavs, sr`，没有暴露 audio chunk、callback 或 websocket。因此这只能算 simulated streaming 优化，不能算通话场景需要的 first-packet streaming。

追加电话带宽 ASR-proxy 结果：

| 变体 | ASR 代理 | 识别结果 | 指标 | 结果 |
| --- | --- | --- | --- | --- |
| wideband16k | FireRedASR2-AED | 完整识别 | CER `0.0` | 通过 |
| phone8k_up16k | FireRedASR2-AED | 完整识别 | CER `0.0` | 通过 |
| phone8k_up16k_snr15 | FireRedASR2-AED | 完整识别 | CER `0.0` | 通过 |
| wideband16k | Qwen3-ASR | 完整识别 | CER `0.0`，`615ms` | 通过 |
| phone8k_up16k | Qwen3-ASR | 完整识别 | CER `0.0`，`104ms` | 通过 |

结论：Qwen3-TTS 中文输出的电话带宽可懂度证据目前最好，可以作为服务端 TTS 质量灰度候选。官方公开 `non_streaming_mode=False` 对中文有收益，`2334ms -> 1926ms`，但仍高于 `1200ms` 门禁且不是真 chunk 首包流式；下一步应接 vLLM-Omni 或可信社区 runtime 做真实流式复测。

## ASR 评测

测试音频使用 Qwen3-TTS 生成的中文短句 wav。

### Qwen3-ASR-0.6B

首轮输出：

```text
今天下午三点，我们在会议室讨论产品计划。
```

首轮延迟：7,259 ms。

追加 warm 短音频结果：

- wideband16k：CER `0.0`，延迟 `615ms`
- phone8k_up16k：CER `0.0`，延迟 `104ms`

结论：Qwen3-ASR 文本质量好，warm 状态短音频延迟明显优于首轮结果。下一步不要简单按 `7259ms` 淘汰，而是要单独做冷启动、模型常驻、流式推理和批量离线四组基准。

### FireRedASR2-AED

输出：

```text
今天下午三点我们在会议室讨论产品计划
```

首轮延迟：663 ms，RTF 0.0694。

追加电话带宽结果：Qwen3-TTS 中文 wideband/phone/noisy phone `3/3` 通过，CER `0.0`。

注意：PyPI `fireredasr` 运行时和 Hugging Face checkpoint 存在轻微键名不匹配，加载时使用了 `strict=False`，额外 key 为 `ctc.ctc_lo.weight` 和 `ctc.ctc_lo.bias`。

结论：本次烟测速度明显好于 Qwen3-ASR 首轮 Transformers 路线，准确率也足够好。产品化前需要固定官方 FireRedASR2 runtime 或维护一份明确的兼容加载补丁。

## TTS 评测：CosyVoice2

CosyVoice2-0.5B 已使用官方 GitHub runtime 跑通真实流式推理：

- 官方源码：`https://github.com/FunAudioLLM/CosyVoice`
- 源码 commit：`074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`
- runtime 路径：`/data/models/translation-model-eval/runtime/CosyVoice`
- 模型路径：`/data/models/translation-model-eval/models/cosyvoice2_0_5b`
- 采样率：24 kHz
- 加载耗时：6,149 ms

| 样本 | 接口 | 首包 | 总生成 | 音频时长 | RTF | 输出 |
| --- | --- | --- | --- | --- | --- | --- |
| 中文会议句 | `inference_zero_shot(..., stream=True)` | 1,073 ms | 7,784 ms | 27.2 s | 0.286 | `outputs/cosyvoice2-zh-zero-shot-stream.wav` |
| 英文短句 | `inference_cross_lingual(..., stream=True)` | 963 ms | 3,683 ms | 14.4 s | 0.256 | `outputs/cosyvoice2-en-cross-lingual-stream.wav` |

追加可懂度结果：

| 测试 | 结果 |
| --- | --- |
| Qwen3-ASR 代理短句可懂度 | 0/6 通过 |
| 中文短句 stream / non-stream | ASR 输出 `呱`、异常中文短语或大量重复“不” |
| 中文会议句 speed 1.3 | ASR 输出 `啊，我`，CER `0.9444` |
| 英文短句 | ASR 输出 `Oh, oh,` 或 `Chick chick, go,`，WER `1.0` |
| 电话带宽代理 | 中文长句出现大量“咕噜”或 `<sil>`；英文输出异常 |

追加 prompt/reference/runtime 诊断：

| 变量 | 覆盖项 | 结果 |
| --- | --- | --- |
| prompt/reference | 中文 zero-shot prompt、英文 zero-shot prompt、官方 `cross_lingual_prompt.wav` | `0/6` 通过 |
| 推理模式 | `stream=True`、`stream=False` | 均未恢复可懂度 |
| text frontend | `text_frontend=True`、`text_frontend=False` | 均未恢复可懂度 |
| 官方中文长样本 | CosyVoice 示例长句 | 生成音频过长且 ASR 输出大量重复内容 |

注意：当前 venv 的 ONNX Runtime 只有 `AzureExecutionProvider` 和 `CPUExecutionProvider`，因此 speech tokenizer ONNX 会降级到 CPU；`torchaudio.load` 在当前 torch/torchaudio 组合里要求 `torchcodec`，安装 `torchcodec` 后又缺少 FFmpeg 动态库/兼容栈，本轮诊断脚本只能继续使用 `soundfile` 读取和保存 WAV。

结论：CosyVoice2 的 runtime 生成链路和首包指标有价值，但当前问题已经不只是 prompt 选择。zero-shot、cross-lingual、stream/non-stream、text frontend 开关都失败，更像当前 venv/runtime/依赖/解码路径与官方预期不一致。后续应先建立隔离官方环境，再修可懂度，之后再谈接入 Worker。

## 当前建议

1. ASR 优先继续评估 FireRedASR2-AED，但必须先解决 runtime/checkpoint 兼容问题。
2. Qwen3-ASR 保留为高准确备选，下一轮重点测官方 streaming 或 vLLM/常驻后端。
3. 翻译可把 LMT-60-0.6B 作为服务端低延迟候选接入灰度 Provider。
4. TTS 当前推荐 Qwen3-TTS 做质量灰度候选，但必须补真 streaming first-audio；未达标前通话产品优先保证字幕。
5. CosyVoice2 降级为待修候选，先用隔离官方环境排查 prompt、参考音频、跨语种标签、依赖版本、FFmpeg/torchcodec 和 ONNX provider。

## 产物

- 远端汇总：`/data/models/translation-model-eval/outputs/beelink-model-eval-summary.json`
- 远端下载完整性：`/data/models/translation-model-eval/outputs/download-integrity-report.fixed.json`
- 远端 LMT 横评：`/data/models/translation-model-eval/outputs/lmt-eval-score.json`
- 远端电话带宽评测：`/data/models/translation-model-eval/outputs/call-audio-model-eval.json`
- 远端 Qwen3-TTS streaming 复测：`/data/models/translation-model-eval/outputs/qwen3-tts-streaming-eval.json`
- 远端 Qwen3-TTS streaming ASR 代理：`/data/models/translation-model-eval/outputs/qwen3-tts-streaming-asr-proxy.json`
- 远端 CosyVoice2 可懂度评测：`/data/models/translation-model-eval/outputs/cosyvoice2-intelligibility-eval.json`
- 远端 CosyVoice2 prompt/runtime 诊断：`/data/models/translation-model-eval/outputs/cosyvoice2-prompt-diagnostic.json`
- 本地缓存：`.cache/model-eval/beelink-model-eval-summary.json`
- 本地电话带宽缓存：`.cache/model-eval/call-audio-model-eval.json`
- 本地 CosyVoice2 可懂度缓存：`.cache/model-eval/cosyvoice2-intelligibility-eval.json`
- 本地下载和检查脚手架：`model-eval/beelink`
