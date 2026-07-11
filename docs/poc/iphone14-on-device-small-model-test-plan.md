# iPhone 14 端侧小模型测试方案

日期：2026-07-07

## 目标

验证 iPhone 14 是否能稳定承载端侧小模型，用于本地同传、离线兜底和云端链路前处理。

本轮不以替代服务端大模型为目标。优先验证这些端侧能力：

1. VAD、端点检测、no-speech 过滤。
2. 自动语种识别和中英切换。
3. 小型端侧 ASR。
4. 说话人分离和多人字幕标注。
5. 系统翻译与系统 TTS 的稳定性。

## 总体结论预设

| 能力 | iPhone 14 端侧优先级 | 默认策略 |
| --- | --- | --- |
| VAD / 端点检测 | P0 | 必须端侧跑 |
| 自动语种识别 | P0 | 必须端侧跑 |
| ASR | P0 | Apple Speech / iOS CoreML ASR 优先，小模型对照 |
| 说话人分离 | P1 | 小会议、面对面和 Listening Mode 加强项 |
| 翻译 | P1 | 默认 iOS Translation framework，自研小翻译模型只做实验 |
| TTS | P1 | 默认 AVSpeechSynthesizer，自研神经 TTS 只做实验 |
| LLM 总结 | P2 | iPhone 14 不做默认端侧 LLM，走服务器 |

## 候选模型

### VAD / 端点检测

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| 当前 App VAD / 能量门限 | 规则基线 | 确认端点、flush 和 no-speech 过滤下限 |
| Silero VAD CoreML/ONNX | 小模型候选 | 对比误触发、漏检和弱噪声表现 |
| WebRTC VAD | 轻量规则候选 | 电话带宽和低功耗兜底 |

### 语种识别

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| NaturalLanguage framework | 系统基线 | 端侧判断中文、英文、混合文本 |
| ASR 结果字符规则 | 规则基线 | 对短句和混合句快速决策 |
| 小型 LID 模型 | 可选 | 如果系统和规则在混合语种上不稳，再引入 |

### ASR

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| Apple Speech / SpeechAnalyzer | 系统基线 | iPhone 14 默认端侧 ASR 兜底 |
| 当前 iOS CoreML / Nemotron ASR | 已集成路线 | 验证中文、英文、中英混合和快语速 |
| FluidInference/qwen3-asr-0.6b-coreml | 已淘汰 | iPhone 14 真机 `int8` 录音链路可跑，但 decoder final 为重复符号乱码且延迟过高；手机模型已删除 |
| Whisper Tiny/Base CoreML | 小模型 baseline | 对照多语种覆盖和噪声鲁棒性 |
| FluidAudio / Nemotron 新版本 | 重点候选 | 参考 FluidVoice 路线，寻找更快更准的端侧 ASR |

### Qwen3-ASR-0.6B CoreML 专项测试计划

状态：已终止，不再进入端侧测试队列。详见：

详细任务拆解见：

```text
docs/poc/qwen3-asr-coreml-iphone14-test-tasks.md
```

| 项目 | 计划 |
| --- | --- |
| 模型仓库 | `FluidInference/qwen3-asr-0.6b-coreml` |
| 测试 App Provider | `coreml_qwen3_asr` |
| 测试边界 | 只接入独立测试 App，不修改、不编译主 App |
| 首测变体 | `int8/` 已删除，测试终止 |
| 对照变体 | `f32/` 不再 stage |
| 备选路线 | `aufklarer/Qwen3-ASR-CoreML`，iOS 18+ encoder + decoder 全 CoreML/ANE，第二阶段验证 |
| 模型放置 | `Documents/Models/Qwen3ASRCoreML/int8` 和 `Documents/Models/Qwen3ASRCoreML/f32` |
| P0 样本 | 复用 `data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl` 全量 ASR 样本 |
| 对照模型 | Apple Speech、CoreML/Nemotron 2240ms、服务端 Qwen3-ASR-0.6B tuned v3 fixed score |
| 输出目录 | `data/model-eval/iphone14-small-models/results/device-pulls/single` |

测试步骤已取消：该模型不再 stage 到手机，也不再跑 smoke/P0。

放行门槛：

| 指标 | 门槛 |
| --- | ---: |
| App 闪退 | 0 |
| 模型加载失败 | 0 |
| P0 通过数 | 不低于当前 CoreML/Nemotron 完整复测结果 |
| 中文长句/快语速 | 不低于 CoreML/Nemotron |
| 中英混合 | 不低于 Qwen3-ASR 服务端 tuned 的可后处理水平 |
| 首个 partial | <= 800ms，或显著优于 Nemotron |
| final latency | <= 2000ms |
| 模型包体 | `int8` 可接受；`f32` 需单独产品审批 |

### 说话人分离

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| Streaming-Sortformer-Diar-CoreAI | CoreAI 候选 | 验证 iPhone 14 上最多 4 人说话人标注 |
| NVIDIA Sortformer 服务端原版 | 服务端对照 | 若端侧不稳，保留服务端 diarization 路线 |

### 翻译

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| iOS Translation framework | 系统默认 | iPhone 14 本地翻译默认链路 |
| LMT-60-0.6B 量化实验 | 可选 | 只验证端侧自研翻译可行性，不进入 MVP 默认 |
| Hy-MT2-1.8B | 服务端对照 | 不放 iPhone 14，作为 Beelink/服务器主模型 |

### TTS

| 候选 | 类型 | 测试目的 |
| --- | --- | --- |
| AVSpeechSynthesizer | 系统默认 | iPhone 14 本地 TTS 默认链路 |
| LuxTTS | 实验候选 | 验证自定义声音和非流式高质量 TTS，不作为电话实时默认 |
| VoxCPM2 | 服务端对照 | 通话实时 TTS 主候选，不放 iPhone 14 默认链路 |

## 测试设备和环境

| 项目 | 要求 |
| --- | --- |
| 设备 | iPhone 14，至少 1 台；如有 iPhone 14 Pro 单独记录 |
| 系统 | 当前可用 iOS 版本，记录完整版本号 |
| 网络 | Wi-Fi 在线、飞行模式离线两组 |
| 电量 | 起测 >= 80%，禁用低电量模式 |
| 温度 | 冷机、连续 15 分钟、连续 30 分钟三档 |
| App | Debug/TestFlight/Release 包分别标注 |
| 日志 | App session、ASR 原文、语种、翻译、TTS、VAD segment、崩溃日志 |

## 测试数据集

已准备 v1 测试集：

```text
data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl
data/model-eval/iphone14-small-models/terminology-v1.json
data/model-eval/iphone14-small-models/result-template-v1.jsonl
```

生成音频：

```bash
npm run generate:iphone14-test-audio -- --core
npm run generate:iphone14-test-audio -- --all
```

生成目录：

```text
test-audio/iphone14-small-models/
```

### 固定音频

优先复用现有测试音频：

```text
test-audio/realtime-online-bilingual-test.m4a
test-audio/realtime-online-bilingual-test-24k.wav
```

新增 iPhone 14 端侧测试集：

| 分组 | 数量 | 内容 |
| --- | ---: | --- |
| 中文短句 | 20 | 日常问候、会议、地址、金额 |
| 英文短句 | 20 | 问候、酒店、发票、客服 |
| 中文长句 | 20 | 15-30 秒连续讲话 |
| 英文长句 | 20 | 15-30 秒连续讲话 |
| 中英混合 | 30 | 模型名、产品名、人名、数字混合 |
| 快语速中文 | 20 | 真实用户快读 |
| 噪声场景 | 20 | 室内噪声、电视外放、街道噪声 |
| 歌曲/BGM | 10 | 明确标注为不承诺强识别，只做抗干扰 |
| 电话带宽 | 20 | 8k/16k narrowband/wideband |
| 多人说话 | 20 | 2 人、3 人、4 人，部分重叠说话 |

### 领域词清单

必须覆盖：

- 模型名：`FireRedASR2`、`Hy-MT2`、`VoxCPM2`、`Nemotron`、`Whisper`。
- 产品词：同传、通话翻译、端侧翻译、说话人分离。
- 业务词：SKU、报价、报关资料、发票、会议纪要。
- 数字：手机号、金额、日期、订单号。
- 人名和地名：中文名、英文名、地址。

## 指标和门槛

### VAD / 端点检测

| 指标 | MVP 门槛 | 理想门槛 |
| --- | ---: | ---: |
| 起始检测延迟 | <= 300ms | <= 150ms |
| 结束检测延迟 | <= 900ms | <= 500ms |
| no-speech 误触发 | <= 5% | <= 2% |
| 漏检真实语音 | <= 3% | <= 1% |
| flush 后无翻译 | 0 个阻断问题 | 0 |

### ASR

| 指标 | 中文 MVP | 英文 MVP | 理想 |
| --- | ---: | ---: | ---: |
| 短句 CER/WER | <= 12% | <= 10% | <= 6% |
| 长句 CER/WER | <= 18% | <= 15% | <= 10% |
| 快语速 CER | <= 25% | - | <= 15% |
| 首个 partial | <= 800ms | <= 800ms | <= 400ms |
| final latency | <= 2000ms | <= 1800ms | <= 1200ms |
| 中英混合漏段 | <= 5% | <= 5% | <= 2% |
| 崩溃/闪退 | 0 | 0 | 0 |

### 自动语种识别

| 指标 | MVP 门槛 | 理想门槛 |
| --- | ---: | ---: |
| 中文/英文短句准确率 | >= 95% | >= 98% |
| 中英混合方向准确率 | >= 90% | >= 95% |
| 语言快速切换漏翻译 | <= 5% | <= 2% |

### 说话人分离

| 指标 | MVP 门槛 | 理想门槛 |
| --- | ---: | ---: |
| 2 人 DER | <= 18% | <= 10% |
| 3-4 人 DER | <= 28% | <= 18% |
| speaker 切换延迟 | <= 1200ms | <= 700ms |
| 重叠说话处理 | 不崩溃，能标注主要 speaker | 更细粒度标注 |

### 翻译

| 指标 | MVP 门槛 | 说明 |
| --- | ---: | --- |
| iOS 系统翻译可用率 | >= 95% | 语言包已安装时 |
| 中英短句可用率 | >= 90% | 真人抽检 |
| 领域词保留 | >= 85% | iPhone 14 本地模式不要求达到服务端主模型 |
| 离线可用 | 必须验证 | 语言包未安装时要给清晰提示 |

### TTS

| 指标 | MVP 门槛 | 说明 |
| --- | ---: | --- |
| 首音延迟 | <= 800ms | 系统 TTS |
| 中文可懂度 | >= 4/5 | 真人听感 |
| 英文可懂度 | >= 4/5 | 真人听感 |
| 连续 30 分钟稳定性 | 无崩溃 | 温度和电量需记录 |

### 设备资源

| 指标 | MVP 门槛 |
| --- | ---: |
| 单模型包体增加 | <= 300MB 优先，> 500MB 需产品审批 |
| 连续 15 分钟电量下降 | <= 8% |
| 连续 30 分钟电量下降 | <= 15% |
| 机身过热降频 | 不应阻断字幕 |
| 内存峰值 | 不触发系统杀进程 |

## 测试流程

### Phase 0：模型准入

1. 确认模型许可证、体积、运行时、最低 iOS 版本。
2. 确认是否支持 Core ML / ONNX Runtime / CoreAI。
3. 确认是否需要网络、是否需要下载语言包。
4. 不满足许可证或体积门槛的模型只进入研究池。

### Phase 1：离线单模型基准

1. 关闭网络或飞行模式。
2. 逐个模型加载、推理、卸载。
3. 记录冷启动、热启动、首 token/首 partial、final latency。
4. 输出 JSONL 结果，统一写入：

```text
data/model-eval/iphone14-small-models/
```

### Phase 2：App 真机链路

1. 打开 App 本地同传模式。
2. 播放固定音频，手机麦克风采集。
3. 逐段记录：VAD segment、ASR 文本、语种、翻译、TTS。
4. 测三轮：安静、噪声、快速切换。
5. 每轮结束必须点 End，验证 session 保存和历史详情。

### Phase 3：连续稳定性

1. 连续运行 15 分钟。
2. 连续运行 30 分钟。
3. 记录温度、电量、卡顿、闪退、字幕延迟漂移。
4. 如果出现端侧错误，记录首次错误前 30 秒音频和日志。

### Phase 4：对照服务端

同一批音频分别跑：

- iPhone 14 本地链路。
- Beelink FireRedASR2 + Hy-MT2 + VoxCPM2。
- 当前线上链路。

最终比较：

| 维度 | iPhone 14 本地 | Beelink 服务端 | 线上默认 |
| --- | --- | --- | --- |
| 准确率 | 待测 | 待测 | 待测 |
| 延迟 | 待测 | 待测 | 待测 |
| 离线能力 | 强 | 无 | 无 |
| 成本 | 低 | 中 | 高 |
| 隐私 | 强 | 中 | 中 |

## 结果文件格式

每条样本输出一行 JSON：

```json
{
  "runId": "iphone14-local-20260707-001",
  "device": "iPhone 14",
  "iosVersion": "待记录",
  "mode": "local",
  "candidate": "apple_speech",
  "group": "zh_fast_speech",
  "audio": "zh_fast_001.wav",
  "expectedText": "今天我们测试自动识别语言",
  "actualText": "今天我们测试自动识别语言",
  "expectedLanguage": "zh",
  "actualLanguage": "zh",
  "latencyMs": 1280,
  "firstPartialMs": 420,
  "wer": 0.0,
  "cer": 0.0,
  "batteryStart": 86,
  "batteryEnd": 85,
  "thermalState": "nominal",
  "passed": true
}
```

## 决策规则

### 可以进入 MVP 默认

同时满足：

1. 安静和轻噪声场景 ASR 达到 MVP 门槛。
2. 连续 30 分钟无崩溃、无系统杀进程。
3. 包体、耗电、温度可接受。
4. 端侧错误不会导致字幕丢失，能自动降级到系统能力。

### 只能进入灰度

满足准确率，但存在任一问题：

- 快语速下降明显。
- 中英混合不稳。
- 包体偏大。
- 发热或耗电偏高。
- 需要用户手动下载模型。

### 不进入产品

任一项触发：

- 闪退或系统杀进程。
- 连续运行内存泄漏。
- 许可证不允许商业使用。
- 模型体积超过产品可接受范围。
- 无法离线或无法稳定加载。

## 推荐执行顺序

1. 先测系统基线：Apple Speech / SpeechAnalyzer、Translation framework、AVSpeechSynthesizer、NaturalLanguage。
2. 再测 VAD 和语种识别小模型。
   - TODO：将 `nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0` 导出为 CoreML/ONNX 端侧候选，对比当前端点检测器的低音量召回、噪声误触发、耗电、温升和实时系数；通过前不进入生产 App。
3. 再测当前 iOS CoreML / Nemotron ASR 与 Whisper Tiny/Base CoreML。
4. 再测 Streaming-Sortformer-Diar-CoreAI。
5. 最后才测 LMT 量化、LuxTTS 等更重的实验项。

## 当前建议

iPhone 14 本地模式首版推荐：

```text
端侧 VAD/端点检测
-> Apple Speech 或 iOS CoreML/Nemotron ASR
-> NaturalLanguage 自动语种识别
-> iOS Translation framework
-> AVSpeechSynthesizer
```

服务端高质量模式继续使用：

```text
FireRedASR2-AED
-> Hy-MT2-1.8B
-> VoxCPM2
```

本测试结束前，不把自研小翻译模型或神经 TTS 设为 iPhone 14 默认。
