# 模型横评结果与推荐顺序

更新时间：2026-07-05

## 总体推荐

| 场景 | 推荐顺序 | 结论 |
| --- | --- | --- |
| 端侧本地同传 | 1. iOS CoreML/Nemotron ASR + iOS 系统翻译 + iOS 系统 TTS | 作为 MVP 默认链路，稳定、成本低、隐私最好 |
| 跨平台/通话 ASR | 1. FireRedASR2-AED；2. Qwen3-ASR-0.6B | FireRed 首轮速度最好；Qwen3-ASR 短音频 warm 测试很有潜力，但还要做冷/热和流式复测 |
| 跨平台/通话翻译 | 1. Hy-MT2-1.8B 自托管主模型；2. Qwen 商业质量兜底；3. MADLAD400-3B-MT 多语种候选；4. LMT-60-0.6B 低成本兜底；5. LM Studio 本地 Qwen | Hy-MT2-1.8B 已通过 Beelink 产品适配评测，作为国内版服务端翻译主模型；Qwen 不再是主链路发布门禁 |
| 跨平台/通话 TTS | 1. VoxCPM2；2. Chatterbox Multilingual V3；3. Qwen3-TTS-0.6B baseline | VoxCPM2 已在 Beelink 产品适配评测中跑通 audio chunks，首包 `22-32ms`，Worker HTTP Provider、Beelink Tailscale TTS 服务和 `check:tts-provider` 门禁已接；LiveKit/PSTN 回灌、并发、生产 HTTPS 和电话带宽仍待验收 |

## ASR 模型横评

| 推荐顺序 | 模式 | Provider / 模型 | 测试状态 | 关键指标 | 推荐理由 | 风险 / 待办 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 端侧本地 | `ios_coreml / nemotron-3.5-asr-streaming-0.6b` | 通过 | 中文、英文、中英混合 3 条 fixture 全通过；延迟约 `1500-1900ms` | 当前真机路线已集成，隐私好，不消耗服务器 GPU，适合作为 MVP 默认 ASR | 中文快语速、歌曲/BGM、强噪声仍需人工验收 |
| 1 | 跨平台/通话 | `fireredasr2_aed / FireRedASR2-AED` | 通过 | Qwen3-TTS 中文 wideband/phone/noisy phone 代理测试 `3/3`，CER `0.0`；首轮延迟 `663ms`，RTF `0.0694` | 服务端 ASR 候选里速度最好，中文电话带宽代理表现稳，适合通话链路灰度 | PyPI runtime 与 checkpoint 有 `ctc.ctc_lo.*` 额外 key，需要固定官方 runtime 或明确兼容补丁；英文还要用真人英文语料复测 |
| 2 | 跨平台/通话 | `qwen3_asr / Qwen3-ASR-0.6B` | 首轮未通过实时阈值；追加短音频通过 | 首轮离线延迟 `7259ms`；warm 中文 wideband `615ms`、phone `104ms`，CER `0.0` | 识别质量好，warm 短音频表现有潜力，适合作为高准确 ASR 备选 | 需要区分冷启动、模型常驻、流式推理和批量离线；未证明可稳定实时 |

## 翻译模型横评

| 推荐顺序 | 模式 | Provider / 模型 | 测试状态 | 关键指标 | 推荐理由 | 风险 / 待办 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 端侧本地 | `ios_system_translation` | 静态门禁通过 | Flutter 与 iOS Translation framework bridge 契约完整 | 端侧默认链路，隐私好、无服务器成本，适合面对面本地模式 | 真实语言包安装、质量和弱网下载状态仍需真机验收 |
| 1 | 跨平台/通话 | `hymt2_self_hosted / tencent/Hy-MT2-1.8B` | Beelink 产品适配评测通过 | 12/12 通过；P50 `152ms`，P95 `303ms`；显存 `3424MB` 仅作容量观测 | 国内版服务端翻译主模型；中英短句、长句、混合语种、JSON 和字幕分隔符表现稳定 | 仍需 100-300 条真实 ASR/电话语料和真人抽检；显存占用不作为发布门禁 |
| 2 | 跨平台/通话 | `qwen_live / qwen-plus` | smoke 通过 | 商业质量兜底 | 复杂上下文、摘要、Agent 文本生成仍可走商业质量路由 | 有 API 成本和网络依赖；作为 fallback 时需限流和降级 |
| 3 | 跨平台/通话 | `madlad400_candidate / MADLAD400-3B-MT` | Beelink 产品适配评测通过 | 11/12 通过；P50 `248ms`，P95 `373ms`；最大 torch 显存 `6640MB` | 多语种扩展价值高，适合作为中英之外的后续候选 | 模型体积大；ASR 脏输入表达偏机械 |
| 4 | 跨平台/通话 | `lmt_candidate / LMT-60-0.6B` | Beelink 产品适配评测通过 | 8/12 通过；P50 `141ms`，P95 `328ms`；最大 torch 显存 `1146MB` | 自部署、低延迟、低成本，适合作为灰度低延迟 Provider | 不应直接吃未分句中英混合整段；需加自动语种识别、分句和重复翻译去重 |
| 5 | 实验/私有部署 | `lmstudio / qwen2.7-7b-instruct-qwq-prime-1k` | 既有 POC 通过 | 可在 LM Studio 私有环境调用 | 适合本地实验、演示、私有部署兜底 | 不作为默认产品链路；吞吐、稳定性和运维依赖本地 LM Studio |

### 翻译模型追加批次结果

完整报告：`docs/poc/translation-product-fit-beelink-report.md`

| 推荐顺序 | 模型 | 测试结果 | 结论 | 风险 / 注意 |
| --- | --- | --- | --- | --- |
| 1 | `tencent/Hy-MT2-1.8B` | 12/12；P50 `152ms`，P95 `303ms` | 国内版服务端翻译主模型 | 需扩展真实 ASR/电话语料；显存只做容量规划 |
| 2 | `google/madlad400-3b-mt` | 11/12；P50 `248ms`，P95 `373ms` | 多语种扩展候选 | 模型大；ASR 脏输入表现一般 |
| 3 | `facebook/seamless-m4t-v2-large` | 10/12；P50 `172ms`，P95 `220ms` | 语音/文本一体研究对照 | 领域术语和分隔符保护不足；不作为商业默认 |
| 4 | `NiuTrans/LMT-60-0.6B` | 8/12；P50 `141ms`，P95 `328ms` | 低成本兜底 | 需分句、语种识别、去重、格式保护 |
| 5 | `NiuTrans/LMT-60-1.7B-Base` | 0/12；P50 `1630ms`，P95 `1718ms` | 不推荐 | Base 版本直接吃指令会复读 prompt；若继续 LMT，应测非 Base `NiuTrans/LMT-60-1.7B` |
| - | `tencent/Hy-MT2-1.8B-GGUF` | 已下载；未质量评分 | 缺兼容 runtime | 需要 llama.cpp/STQ runtime 后再评测 |

## TTS 模型横评

| 推荐顺序 | 模式 | Provider / 模型 | 测试状态 | 关键指标 | 推荐理由 | 风险 / 待办 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 端侧本地 | `ios_system_tts / iOS AVSpeechSynthesizer` | 静态门禁通过 | Flutter 与 iOS TTS bridge 契约完整 | 端侧默认 TTS，稳定、省成本、无服务器依赖 | 音色自然度有限；Android 需对应系统 TTS 适配 |
| 1 | 跨平台/通话 | `voxcpm2 / VoxCPM2` | 产品适配评测通过；Worker 合同、Beelink HTTP 服务和发布 smoke 门禁已接 | audio chunks；首包 `22-32ms`；RTF `0.191-0.193`；ASR 代理 `6/9`；HTTP warm smoke 约 `990ms`、`firstAudioMs=22ms` | 服务端实时通话 TTS 主模型，首包和流式能力最适合电话回灌 | LiveKit/PSTN 回灌、并发、生产 HTTPS、电话带宽和人名/地址规范化仍需验收 |
| 2 | 跨平台/通话 | `chatterbox_multilingual_v3 / Chatterbox Multilingual V3` | 产品适配评测通过；非流式 | 首包 `608-1206ms`；RTF `0.222-0.413`；ASR 代理 `6/9` | 适合非流式、高质量 fallback 或会后播报 | 当前公开 Python 路径没有真流式 API，不作为实时电话主链路 |
| 3 | 跨平台/通话 | `qwen3_tts_candidate / Qwen3-TTS-0.6B` | 电话带宽代理部分通过；首包未通过 | 24kHz WAV；非流式中文 `2334ms`；公开 simulated streaming 中文 `1926ms`、英文 `2508ms`；产品适配 ASR 代理 `3/9` | 保留 baseline 和备用，不再作为通话 TTS 主接入目标 | `non_streaming_mode=False` 仍返回完整 WAV，不暴露 audio chunk/callback，实时性不够 |
| 4 | 跨平台/通话 | `cosyvoice2_candidate / CosyVoice2-0.5B` | 生成通过；可懂度未通过 | 中文首包 `1073ms`、RTF `0.286`；英文首包 `963ms`、RTF `0.256`；基础可懂度 `0/6`；prompt/reference/runtime 诊断 `0/6` | 暂只保留研究价值 | zero-shot、cross-lingual、stream/non-stream、text_frontend 开关均未修复不可懂音频 |
| 5 | Android 端侧 | `system_tts / Android system TTS` | 设计兜底 | 尚未做等价真机横评 | Android MVP 的实际兜底路径，工程风险低 | 不应作为高自然度通话 TTS；需 Android 真机验证 |

## 已验证服务端模型下载完整性

| 模型 | 任务 | 仓库 | 下载状态 | 大小 | 横评结论 |
| --- | --- | --- | --- | --- | --- |
| Qwen3-ASR-0.6B | ASR | `Qwen/Qwen3-ASR-0.6B` | 完整，无 LFS pointer | 1.88 GB | 准确，warm 短音频有潜力；需流式和冷/热基准 |
| FireRedASR2-AED | ASR | `FireRedTeam/FireRedASR2-AED` | 完整，无 LFS pointer | 4.73 GB | 服务端 ASR 灰度第一 |
| LMT-60-0.6B | 翻译 | `NiuTrans/LMT-60-0.6B` | 完整，无 LFS pointer | 1.52 GB | 低延迟灰度翻译 |
| Qwen3-TTS-0.6B-CustomVoice | TTS | `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | 完整，无 LFS pointer | 2.50 GB | TTS 质量候选；公开 Python 路径 simulated streaming 仍未过首包门禁 |
| CosyVoice2-0.5B | TTS | `FunAudioLLM/CosyVoice2-0.5B` | 完整，无 LFS pointer | 4.86 GB | 首包好但当前可懂度未过，延后 |
| VoxCPM2 | TTS | Beelink 本地 `voxcpm2-notcpp` / VoxCPM2 runtime | 可用 | 待补标准下载体积 | 通话 TTS 主模型；Worker 合同和 Beelink HTTP 服务已接，回灌验收待完成 |

## 产品落地顺序

| 阶段 | ASR | 翻译 | TTS | 理由 |
| --- | --- | --- | --- | --- |
| MVP 默认 | iOS CoreML/Nemotron | iOS 系统翻译 | iOS 系统 TTS | 当前端侧链路已验证，最稳、成本最低 |
| 通话灰度第一版 | FireRedASR2-AED | Hy-MT2-1.8B 自托管主模型，Qwen 商业质量兜底 | VoxCPM2 主接入，系统 TTS/字幕兜底 | Hy-MT2 质量和延迟已过产品适配评测；VoxCPM2 首包和 chunk 流式最适合电话回灌，但回灌验收前仍不承诺语音回灌质量 |
| 低成本自部署灰度 | FireRedASR2-AED | LMT-60-0.6B | VoxCPM2，Chatterbox fallback | LMT 可降成本；TTS 需先完成 Worker provider、并发、电话带宽和文本规范化验收 |
| 实验 / 备用 | Qwen3-ASR | LM Studio Qwen | Qwen3-TTS baseline / CosyVoice2 研究项 | 有可用价值，但当前不适合直接做默认实时链路 |

## 不推荐直接默认上线的项目

| 模型 | 不默认上线原因 |
| --- | --- |
| Qwen3-ASR-0.6B | 首轮 Transformers 离线延迟 `7259ms`；warm 短音频好但未证明稳定流式 |
| LMT-60-0.6B | 中英混合句会重复翻译，必须先加上层分句和去重 |
| Qwen3-TTS-0.6B | 电话带宽代理有可懂度证据，但公开 Python simulated streaming 仍是完整 WAV 返回，中文 `1926ms` 仍过慢；产品适配评测弱于 VoxCPM2 |
| CosyVoice2-0.5B | 当前基础可懂度 `0/6`，prompt/reference/runtime 追加诊断仍 `0/6`，先隔离官方环境修可懂度 |

## 下一步测试优先级

1. VoxCPM2：部署真实 HTTP TTS 服务，先通过 `npm run check:tts-provider -- --json`，再跑 LiveKit/PSTN 回灌、首包、并发、稳定性和 8k 电话带宽验收。
2. Hy-MT2：部署 `services/model-services/translation-service` 到 Beelink/生产环境，跑 `npm run check:translation-provider -- --provider hymt2_self_hosted --json`。
3. TTS 文本规范化：对 SKU、金额、人名、地址、电话号码做显示文本和播报文本分离。
4. Chatterbox：保留非流式质量 fallback，补长句、英文和真人听感。
5. FireRedASR2-AED：固定官方 runtime 或兼容补丁，补英文、快语速、噪声、电话音频测试。
6. LMT-60-0.6B：增加自动语种识别、分句、去重后重测中英混合对话；当前通话 Worker 不再用 LMT 做 chat prompt 翻译。
