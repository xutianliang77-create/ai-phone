# CosyVoice2 Runtime 测试报告

更新时间：2026-07-04

## 结论

CosyVoice2-0.5B 已在 Beelink 上使用官方 GitHub runtime 跑通真实流式 TTS：中文 zero-shot 与英文 cross-lingual 都能生成 24 kHz WAV，首包延迟分别为 `1073ms` 和 `963ms`。

但追加的 ASR-proxy 可懂度测试没有通过：当前 runtime/prompt/reference audio 路径下，6 条短中英样本的 Qwen3-ASR 代理识别全部失败，另一个电话带宽代理测试也显示 CosyVoice2 生成音频会被 ASR 识别成异常重复文本或静音。随后又补做 prompt/reference/runtime 诊断，zero-shot、cross-lingual、stream/non-stream、text_frontend 开关 6 组仍全部失败。因此它现在只能算“生成链路跑通”，不能作为跨平台/通话 TTS 灰度优先候选。

当前产品建议：先把服务端 TTS 灰度候选切回 Qwen3-TTS 质量路线，并继续寻找真流式 runtime；CosyVoice2 保留为待修候选，优先用隔离官方环境排查 prompt、参考音频、runtime 兼容和依赖版本。

## 测试目标

- 使用官方 GitHub runtime 跑通 CosyVoice2，而不是只验证权重下载。
- 验证中英双语 TTS 是否能真实输出音频。
- 测量流式首包、总生成耗时、音频时长和 RTF。
- 增加 ASR-proxy 可懂度测试，避免只看 WAV 是否生成。
- 将结果纳入模型选型和综合模型门禁。

## 测试环境

| 项目 | 值 |
| --- | --- |
| 机器 | Beelink |
| SSH | `beelink@100.110.127.117` |
| GPU | NVIDIA GeForce RTX 5090 |
| 工作目录 | `/data/models/translation-model-eval` |
| Python venv | `/data/models/translation-model-eval/.venv` |
| 模型目录 | `/data/models/translation-model-eval/models/cosyvoice2_0_5b` |
| runtime 目录 | `/data/models/translation-model-eval/runtime/CosyVoice` |
| GitHub runtime | `https://github.com/FunAudioLLM/CosyVoice` |
| runtime commit | `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` |
| Matcha-TTS submodule | `dd9105b34bf2be2230f4aa1e4769fb586a3c824e` |

## 依赖处理

为避免破坏当前 RTX 5090 / CUDA / torch 环境，没有直接安装官方 `requirements.txt` 中固定的旧版 torch。采用最小依赖补齐方式：

- 已补齐：`HyperPyYAML`、`hydra-core`、`omegaconf`、`diffusers`、`conformer`、`inflect`、`wetext`、`wget`、`openai-whisper`、`lightning`、`gdown`、`matplotlib`、`pyarrow`、`pyworld`、`pydub`
- 保持当前 torch 环境：`torch 2.11.0+cu130`
- ONNX Runtime 当前 provider：`AzureExecutionProvider`、`CPUExecutionProvider`

注意：当前 venv 没有 `CUDAExecutionProvider`，测试脚本将 ONNX session 安全降级到 `CPUExecutionProvider`。当前 `torchaudio.load` 需要 `torchcodec`，而 `torchcodec` 又依赖 FFmpeg 动态库和兼容 torch 栈；本轮安装验证失败后已回滚，测试脚本继续使用 `soundfile` 读取和保存 WAV。

## 模型加载验证

| 项目 | 结果 |
| --- | --- |
| 状态 | 通过 |
| 加载接口 | `AutoModel(model_dir=..., load_jit=False, load_trt=False, load_vllm=False, fp16=False)` |
| 加载耗时 | `6149ms` |
| 采样率 | `24000 Hz` |
| CUDA | `true` |
| GPU | `NVIDIA GeForce RTX 5090` |

远端结果文件：`/data/models/translation-model-eval/outputs/cosyvoice2-load-smoke.json`

## 生成链路 Smoke

| 样本 | 接口 | 状态 | 首包 | 总生成 | 音频时长 | RTF | 输出 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 中文会议句 | `inference_zero_shot(..., stream=True)` | 生成通过 | `1073ms` | `7784ms` | `27200ms` | `0.286` | `.cache/model-eval/cosyvoice2-zh-zero-shot-stream.wav` |
| 英文短句 | `inference_cross_lingual(..., stream=True)` | 生成通过 | `963ms` | `3683ms` | `14400ms` | `0.256` | `.cache/model-eval/cosyvoice2-en-cross-lingual-stream.wav` |

这组结果只证明 runtime 能加载模型并产生音频，不能单独证明音频适合产品播放。

## 追加可懂度测试

测试脚本：

```bash
python scripts/run_cosyvoice2_intelligibility_eval.py
python scripts/run_call_audio_eval.py
```

结果文件：

- 远端：`/data/models/translation-model-eval/outputs/cosyvoice2-intelligibility-eval.json`
- 本地：`.cache/model-eval/cosyvoice2-intelligibility-eval.json`
- 远端：`/data/models/translation-model-eval/outputs/call-audio-model-eval.json`
- 本地：`.cache/model-eval/call-audio-model-eval.json`

### Qwen3-ASR 代理可懂度

| 样本 | 模式 | 首包 | 生成耗时 | ASR 代理输出摘要 | 指标 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 中文短句 | stream, speed 1.0 | `1162ms` | `2311ms` | `呱` | CER `1.0` | 未通过 |
| 中文短句 | non-stream, speed 1.0 | `1682ms` | `1694ms` | 异常中文短语 | CER `1.625` | 未通过 |
| 中文短句 | stream, speed 1.3 | `1247ms` | `1856ms` | 大量重复“不” | CER `3.25` | 未通过 |
| 中文会议句 | stream, speed 1.3 | `1379ms` | `4062ms` | `啊，我` | CER `0.9444` | 未通过 |
| 英文短句 | stream, speed 1.0 | `1278ms` | `1290ms` | `Oh, oh,` | WER `1.0` | 未通过 |
| 英文短句 | non-stream, speed 1.0 | `1831ms` | `1843ms` | `Chick chick, go,` | WER `1.0` | 未通过 |

汇总：`0/6` 通过。

### 电话带宽代理

| 音频 | ASR 代理 | 结果 |
| --- | --- | --- |
| CosyVoice2 中文长句 wideband16k | FireRedASR2 | 输出大量重复“咕噜”，CER `21.25`，未通过 |
| CosyVoice2 中文长句 phone8k_up16k | FireRedASR2 | 输出 `<sil>`，CER `1.0`，未通过 |
| CosyVoice2 英文 wideband/phone/noisy phone | FireRedASR2 / Qwen3-ASR | 输出异常中文或 `Kiki, k`，未通过 |

注意：ASR-proxy 不是人工 MOS 听感测试，但它是很有用的自动警报。本轮结果足够说明当前 CosyVoice2 生成路径不能直接进通话产品。

### Prompt / Reference / Runtime 诊断

测试脚本：

```bash
python scripts/run_cosyvoice2_prompt_diagnostic.py
```

结果文件：

- 远端：`/data/models/translation-model-eval/outputs/cosyvoice2-prompt-diagnostic.json`
- 本地：`.cache/model-eval/cosyvoice2-prompt-diagnostic.json`

| 样本 | 变量 | 首包/返回 | 音频时长 | ASR 代理摘要 | 指标 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 中文会议句 | zero-shot, stream | `980ms` | `15200ms` | 大量重复“花花花，我苦” | CER `3.0` | 未通过 |
| 中文会议句 | zero-shot, non-stream | `3670ms` | `15000ms` | `我我古` | CER `0.9444` | 未通过 |
| 官方中文长样本 | zero-shot, stream | `1284ms` | `40000ms` | 大量重复短词 | CER `2.617` | 未通过 |
| 官方中文长样本 | `text_frontend=false` | `9696ms` | `40000ms` | 异常短句 | CER `0.9787` | 未通过 |
| 英文短句 | cross-lingual + 中文 prompt | `1234ms` | `12800ms` | `Oo, oo` | WER `1.0` | 未通过 |
| 英文短句 | cross-lingual + 官方英文 prompt | `2105ms` | `12800ms` | 重复异常英文片段 | WER `2.7778` | 未通过 |

诊断结论：prompt 文本、参考音频、stream 开关和 text frontend 开关都不能解释问题。更可能的根因是当前 venv 与 CosyVoice2 官方 runtime 的音频 I/O、依赖版本、ONNX provider 或解码路径不一致。

## 产物

| 产物 | 路径 |
| --- | --- |
| 远端汇总 | `/data/models/translation-model-eval/outputs/beelink-model-eval-summary.json` |
| 本地汇总 | `.cache/model-eval/beelink-model-eval-summary.json` |
| 中文 smoke JSON | `.cache/model-eval/cosyvoice2-smoke.json` |
| 英文 smoke JSON | `.cache/model-eval/cosyvoice2-smoke-en.json` |
| 中文 WAV | `.cache/model-eval/cosyvoice2-zh-zero-shot-stream.wav` |
| 英文 WAV | `.cache/model-eval/cosyvoice2-en-cross-lingual-stream.wav` |
| 可懂度评测 JSON | `.cache/model-eval/cosyvoice2-intelligibility-eval.json` |
| prompt/runtime 诊断 JSON | `.cache/model-eval/cosyvoice2-prompt-diagnostic.json` |
| 电话带宽评测 JSON | `.cache/model-eval/call-audio-model-eval.json` |
| 综合门禁缓存 | `.cache/model-eval/comprehensive-model-readiness.json` |

## 综合门禁影响

CosyVoice2 在综合 fixture 中现在应当失败，原因是 `phoneBandScore=1.0`，低于 `ttsPhoneBandScore=3.5`。整体 `check:comprehensive-models` 仍为预期 `not_ready`，剩余失败项包括：

| 模型/Provider | 问题 |
| --- | --- |
| Qwen3-ASR | 首轮 Transformers 离线后端延迟 `7259ms`，超过 `2500ms` 阈值；warm 短音频还需独立基准 |
| LMT-60-0.6B | 中英混合句重复翻译，similarity 过低 |
| Qwen3-TTS | 公开 Python simulated streaming 中文完整返回 `1926ms`，仍超过 `1200ms` 首包阈值，且不是 chunked audio |
| CosyVoice2 | 当前基础可懂度 `0/6`，prompt/reference/runtime 诊断仍 `0/6`，电话带宽代理未通过 |

## 产品选型影响

- 端侧默认链路不变：`iOS CoreML/Nemotron ASR + iOS 系统翻译 + iOS 系统 TTS`
- 跨平台/通话 TTS 灰度质量候选：`Qwen3-TTS-0.6B`，前提是接入真流式 runtime 并压低 chunk 首包
- CosyVoice2：从灰度优先降级为待修候选
- 在服务器 TTS 达标前，通话产品应优先保证字幕链路，TTS 回灌作为灰度能力开放

完整 ASR、翻译、TTS 横评表和推荐顺序见：`docs/poc/model-selection-ranking-table.md`。

## 后续工作

1. 用隔离官方 CosyVoice2 环境排查 prompt 文本、参考音频、跨语种标签、依赖版本、FFmpeg/torchcodec 和 ONNX provider 对可懂度的影响。
2. 使用真人听感和 ASR-proxy 双重标准复测 CosyVoice2。
3. 让 Qwen3-TTS 接 vLLM-Omni 或可信社区真流式 runtime，重新测 chunk first audio latency。
4. 增加电话 8 kHz/16 kHz 编码后的可懂度测试。
5. 增加中文长句、快语速、英文短句、姓名地址数字、领域词、噪声/BGM 场景测试。
