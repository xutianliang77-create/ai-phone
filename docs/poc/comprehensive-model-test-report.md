# 端侧本地与跨平台通话模型全面测试报告

更新时间：2026-07-04

## 测试目标

针对两个产品模式，对 ASR、翻译、TTS 模型和链路做统一测试：

- 端侧本地模式：iPhone 本地 ASR、本地翻译、本地 TTS。
- 跨平台/通话模式：服务端 ASR、服务端翻译、服务端 TTS、PSTN/VoIP 音频闭环。

本报告只记录可验证结论。需要真人听感、嘈杂环境、歌曲/BGM、快语速长句的项目列为人工验收项，不伪造成自动通过。

## 自动化命令

完整汇总：

```bash
npm run check:comprehensive-models -- --json
```

该命令会运行：

- 默认模型 smoke：`model-eval/fixtures/cn-en-smoke.json`
- 真实候选综合 fixture：`model-eval/fixtures/cn-en-comprehensive-real.json`
- iOS CoreML/Nemotron ASR bridge 静态契约
- iOS 系统翻译 bridge 静态契约
- iOS 系统 TTS bridge 静态契约
- iOS 权限、CoreML runtime、模型资源检查
- Translation Worker PSTN audio sink
- PSTN Bridge -> Translation Worker -> TTS -> media writer 内部闭环
- Beelink 模型下载和真实输出完整性检查

最近一次结果保存到：

```text
.cache/model-eval/comprehensive-model-readiness.json
```

完整模型推荐顺序和横评表：`docs/poc/model-selection-ranking-table.md`

## 总体结果

| 模式 | 结果 | 说明 |
| --- | --- | --- |
| 端侧本地模式 | 自动门禁通过 | iOS ASR bridge、系统翻译 bridge、系统 TTS bridge、权限、CoreML runtime、模型资源均通过 |
| 跨平台/通话链路 | 链路门禁通过 | Translation Worker PSTN audio sink 和 PSTN internal media loop 均通过 |
| 真实候选模型综合准入 | 未通过 | Qwen3-ASR 首轮离线后端慢，LMT 中英混合重复，Qwen3-TTS 公开 simulated streaming 仍慢且不是 chunk 首包，CosyVoice2 当前可懂度未过 |

因此：MVP 默认模型选择仍为端侧稳定链路；跨平台/通话模式的链路框架可用，但服务端模型只进入灰度或待修，不能直接替换默认链路。

## ASR 结果

| 模式 | Provider / 模型 | 测试状态 | 结果 |
| --- | --- | --- | --- |
| 端侧本地 | `ios_coreml / nemotron-3.5-asr-streaming-0.6b` | 通过 | 3 条 fixture 全通过，中文、英文、中英混合均在阈值内 |
| 跨平台/通话 | `qwen3_asr / qwen3-asr-0.6b` | 首轮未通过；追加短音频有潜力 | 首轮文本准确但 Transformers 离线后端延迟 `7259ms`；追加 Qwen3-TTS 中文 wideband/phone warm 测试 CER `0.0`，延迟 `615ms` / `104ms` |
| 跨平台/通话 | `fireredasr2_aed / fireredasr2-aed` | 通过 | Qwen3-TTS 中文电话带宽代理 `3/3` 通过，首轮延迟 `663ms` |

注意：FireRedASR2-AED 当前有 runtime/checkpoint 兼容 caveat，此前加载使用 `strict=false`，额外 key 为 `ctc.ctc_lo.*`。产品化前必须固定官方 runtime 或维护明确补丁。

## 翻译结果

| 模式 | Provider / 模型 | 测试状态 | 结果 |
| --- | --- | --- | --- |
| 端侧本地 | `ios_system` | 静态门禁通过 | Flutter 与 iOS Translation framework bridge 契约完整；真实语言包和质量仍需真机人工验收 |
| 跨平台/通话 | `lmt_candidate / lmt-60-0.6b` | 3/4 通过 | 会议、术语数字、商务短句通过；中英混合句重复翻译未通过 |
| 跨平台/通话 | `qwen_candidate / qwen-commercial-route` | 默认 smoke 通过 | 当前作为高质量/复杂语境兜底仍合理 |

LMT 的价值是低延迟、低成本、可自部署。它不应直接处理未分句的中英混合整段，前面需要自动语种识别、分句和去重。

## TTS 结果

| 模式 | Provider / 模型 | 测试状态 | 结果 |
| --- | --- | --- | --- |
| 端侧本地 | `ios_system_tts` | 静态门禁通过 | Flutter 与 iOS AVSpeechSynthesizer bridge 契约完整 |
| 跨平台/通话 | `qwen3_tts_candidate / qwen3-tts-0.6b` | 可懂度通过；首包未通过 | 24kHz WAV 可生成；公开 `non_streaming_mode=False` 中文完整返回 `1926ms`、英文 `2508ms`，超过 `1200ms` 首包阈值且不是 chunked audio；FireRedASR2 电话带宽代理 `3/3`，CER `0.0`；Qwen3-ASR 复听 simulated streaming `2/2` |
| 跨平台/通话 | `cosyvoice2_candidate / cosyvoice2-0.5b` | 生成通过；可懂度未通过 | 官方 runtime 可生成流式中英 WAV，中文首包 `1073ms`、英文首包 `963ms`；但基础可懂度代理 `0/6`，prompt/reference/runtime 诊断 `0/6`，电话带宽代理也失败 |

最新结论有反转：CosyVoice2 的首包和 RTF 好看，但当前音频内容不可作为产品输出；Qwen3-TTS 的可懂度更稳，但公开 Python 路径还没有满足通话所需的真流式首包。

## 通话链路结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `translation_worker_pstn_audio_sink` | 通过 | 电话帧进入 Worker，ASR 调用、字幕事件、TTS playback 均产生 |
| `pstn_internal_media_loop` | 通过 | PSTN Bridge 到 Worker，再到 TTS 回灌和 media writer 的内部闭环通过 |

这说明链路结构是通的，当前问题集中在真实模型 Provider 的准入质量，而不是电话媒体闭环本身。

## 当前结论

推荐选型：

- 端侧本地默认：`iOS CoreML/Nemotron ASR + iOS 系统翻译 + iOS 系统 TTS`
- 跨平台/通话 ASR 灰度：FireRedASR2-AED，但先修 runtime/checkpoint 兼容；Qwen3-ASR 做常驻和 streaming 复测
- 跨平台/通话翻译：默认服务端主模型用 Hy-MT2-1.8B 自托管；Qwen 商业通道保留为质量兜底；LMT-60-0.6B 只作为低成本 fallback，并必须增加中英混合分句/去重
- 跨平台/通话 TTS：Qwen3-TTS 作为质量灰度候选，先接真 streaming runtime；CosyVoice2 降为待修候选

## 下一步

1. 让 Qwen3-TTS 接 vLLM-Omni 或可信社区真流式 runtime，重新测 chunk first audio latency、英文和长句。
2. 用隔离官方环境排查 CosyVoice2 prompt/reference/runtime 兼容问题，只有 ASR-proxy 和真人听感都过后再进灰度。
3. 固化 FireRedASR2-AED 官方 runtime 或兼容补丁。
4. 为 LMT Provider 增加中英混合分句、自动语种识别和重复翻译去重。
5. 用同一套人工语料补真机验收：快语速中文、长句、噪声、歌曲/BGM、姓名地址数字、领域词。
6. 灰度候选通过综合 fixture 和真实媒体测试后，再更新 `release/domestic/model-selection-report.json` 的默认链路。
