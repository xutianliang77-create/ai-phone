# 国内版优化方案

版本：v1.5  
日期：2026-07-05  
关联：`docs/domestic-edition-development-plan.md`、`docs/domestic-edition-acceptance-plan.md`、`docs/poc/model-eval-runbook.md`

## 1. 结论

现有架构方向正确，不推翻。优化重点从继续调 iPhone 端侧 ASR 参数，转为三条主线：

- 服务端模型 Provider：ASR、翻译、TTS 都要可替换、可观测、可评测。
- 真实媒体链路：Call Link 和 PSTN 必须形成字幕、翻译、TTS 回灌闭环。
- 自建 LiveKit 基础设施：Call Link 默认使用自建 VM，不依赖 LiveKit Cloud 才能发布国内版。
- 模型评测门禁：所有模型替换先过固定语料和延迟、成本、稳定性指标。

iPhone 端侧 Nemotron CoreML 继续作为低延迟和弱网兜底链路；服务端用于解决长句、噪声、中英快速切换、歌曲/BGM、领域词和电话通话场景。

近期稳定性优化已落地：端侧 ASR 首次 native start 瞬时失败会自动清理并重试一次；OpenAI-compatible 翻译 Provider 对短句/命令式原文使用 `SOURCE_TEXT` 包装，遇到聊天式拒译会自动二次强制翻译，避免“有原文无译文”。

## 2. 参考产品边界

参考是学习产品和工程模式，不复用代码、资产、UI、品牌文案或存在商业授权风险的模型。

| 参考                     | 可学习                                                                                                | 不照搬                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| RTranslator              | Conversation mode、WalkieTalkie mode、自动识别双方语言、TTS 播放结束后恢复监听、离线隐私定位          | Android-only 架构、NLLB 商业风险链路、Bluetooth 设备互联实现                                                            |
| LiveKit / LiveKit Agents | WebRTC SFU、Flutter/iOS/Android/Web SDK、JWT、TURN、房间音轨、服务端 STT/LLM/TTS Agent、电话/SIP 集成 | 不自研 SFU，不把 Agents 黑盒化为唯一业务编排                                                                            |
| Fonoster / Asterisk      | `createCall(from/to/appRef/metadata)` 外呼模型、AudioSocket/外部媒体接入、开源 VoIP 控制面参考        | 不直接替换 LiveKit/PSTN Bridge；先通过受控 Fonoster-compatible provider/facade 接入，真实 gRPC/AudioSocket 适配另行验收 |
| Pot Desktop              | 多 Provider、OCR、TTS、插件化、外部调用                                                               | 桌面交互、划词翻译作为主路径                                                                                            |
| Translumo                | 多 OCR 引擎评估、低延迟屏幕翻译、最小捕获区域降低误识别                                               | 游戏/桌面捕获架构、代理规避翻译服务限制                                                                                 |

## 3. 目标架构

```text
Flutter App
  ├─ Talk / Listening / Type-to-Speak
  ├─ Call Link Host
  ├─ Scan / OCR
  └─ History / Billing / Compliance

API Server
  ├─ Session / Call / Billing / Payment
  ├─ Provider Policy / Release Gates
  ├─ Call Link Orchestrator
  └─ AI Calling Agent Control Plane

Realtime Gateway
  ├─ App realtime audio frames
  ├─ ASR Provider Router
  ├─ Translation Provider Router
  └─ TTS Provider Router

Translation Worker
  ├─ LiveKit audio subscription
  ├─ VAD / endpoint / speaker role
  ├─ ASR -> Translation -> Caption event
  └─ Translation -> TTS -> LiveKit/PSTN audio return

PSTN Bridge
  ├─ Outbound call / provider webhook
  ├─ Phone audio ingest
  └─ Translated TTS audio playback to phone

Model Eval
  ├─ Fixed audio/text fixtures
  ├─ ASR / Translation / TTS adapters
  └─ CER / WER / LID / latency / cost gates
```

## 4. 优化主线 A：模型评测门禁

### A1 固定评测集

建立 `model-eval/fixtures` 的分层语料：

- 中文短句、中文快语速、中文长句。
- 英文短句、英文口音、英文连续对话。
- 中英混说、快速语言切换。
- 外贸、会议、物流、地址、数字、姓名、产品型号。
- 影视外放、环境噪声、歌曲/BGM。
- OCR 文本翻译和 Type-to-Speak 文本翻译。

### A2 指标

ASR：

- CER、WER。
- language accuracy。
- language confidence 分布。
- partial 首字延迟、final 延迟。
- 重复转写率、漏译率。

翻译：

- 关键语义准确率。
- 数字、金额、时间、姓名保持率。
- 术语命中率。
- 首 token 延迟、整句延迟。

TTS：

- 首包延迟。
- 是否支持流式。
- 中文/英文自然度主观评分。
- 电话窄带可懂度。
- 失败率和成本。

### A3 候选顺序

端侧 ASR：

- 默认保留 iOS Nemotron CoreML。

服务端 ASR：

- 第一候选：Qwen3-ASR-0.6B/1.7B。
- 第二候选：FireRedASR2。
- 兜底候选：SenseVoice / FunASR。

翻译：

- 实时翻译主模型：tencent/Hy-MT2-1.8B 自托管；Qwen 商业通道保留为质量兜底，LMT-60-0.6B/1.7B 和当前 LM Studio 保留为候选/实验路径。
- 摘要、术语、AI Agent 候选：Qwen 类 LLM。

TTS：

- 通话主模型：VoxCPM2。Beelink 产品适配评测已跑通 audio chunks，首包 `22-32ms`；`translation-worker` 已支持 VoxCPM2 HTTP TTS 身份契约，发布 env 与 `check:tts-provider` 会验证真实服务 provider/model、PCM16 和首包延迟；Beelink Tailscale TTS HTTP 服务已部署并通过真实 smoke，下一步跑 LiveKit/PSTN 回灌。
- 非流式质量 fallback：Chatterbox Multilingual V3。
- 基线备用：Qwen3-TTS-0.6B；公开 Python simulated streaming 仍不是 chunk 首包，不再作为通话 TTS 主接入目标。
- 待修研究项：CosyVoice2/3；CosyVoice2 当前生成链路已通，但可懂度代理未过，不能直接灰度。
- 端侧兜底：系统 TTS。

### A4 放行规则

- 没有固定评测结果，不替换默认模型。
- 新模型必须在核心语料上优于当前链路，且首字延迟和整句延迟不能明显变差。
- 歌曲/BGM 和强噪声先作为增强能力，不阻塞 P0/P1，但阻塞 P2 电话翻译宣传。

## 5. 优化主线 B：自动语种识别

问题：

- 移动端已支持按 ASR 语言或文字脚本做中英切块。
- 服务端在 `sourceLanguage=auto` 且无法从文本判断时，不能再用 `targetLanguage` 反推。

改造：

- ASR Provider 统一返回 `language`、`languageConfidence`、`rawLanguage`。
- 低置信度时保留字幕，但翻译进入短暂延迟确认，不直接丢弃。
- 混合句按语言片段切块翻译，并在 UI 合并为一条对话段。
- 每段历史保存识别语言、置信度、provider、model。

验收：

- 中英快速切换 20 轮，不连续漏译。
- 同一段包含中英两种语言时，至少能分别反向翻译。
- 低置信度有日志和诊断，不静默按错误方向翻译。

## 6. 优化主线 C：真实媒体链路

### C1 Call Link

当前已具备 App Host、Web Guest、LiveKit token、字幕事件、`tts.ready` 事件、App/Web TTS 就绪状态展示和历史基础。下一步补：

- 部署自建 LiveKit VM，使用 `infra/livekit-selfhost` 生成配置并通过 `check:livekit-selfhost-config`。
- Worker 订阅真实 host/guest 音频轨。
- 按 speakerRole 分开 VAD、ASR 和翻译。
- 翻译文本生成 TTS 音频；API 已能接收并发布 Worker `tts.ready` 事件。
- Worker 作为房间参与者发布译文音轨。
- TTS 播放期间暂停对应方向识别，避免回声二次转写。

验收：

- App Host + Web Guest 真实说话 5 分钟。
- 双方都有原文、译文、角色标注。
- 至少一方能听到对方译文 TTS。
- 结束后历史有全文、译文、摘要、时长、用量。

### C2 PSTN 翻译电话

当前 PSTN Bridge 控制面、`callId -> providerCallId/mediaStreamId` 路由、`/media-frames` 来音入口、`/provider/media-events` 服务商签名来音入口、`/provider/status-events` 服务商签名状态入口、服务商 `eventId` 幂等、8k μ-law 来音转 PCM16、Translation Worker PSTN audio frame sink、PCM16 来音驱动 ASR/翻译/TTS、`/translated-audio` 译音回灌入口、PCM16 -> 8k μ-law 译音编码、媒体写入器和发布门禁已有，下一步补：

- Fonoster-compatible provider/facade 灰度：先按 Fonoster 外呼模型接 `from/to/appRef/metadata`，不把 Fonoster gRPC/AudioSocket 直接塞进主 Bridge。
- 真实 PSTN/VoIP 服务商媒体协议适配到 `/media-frames`。
- PSTN Bridge 的媒体写入器对接真实服务商 media/session API。
- 真实 PSTN/VoIP 服务商状态 webhook 适配到 `/provider/status-events`。
- 拨号前展示费用、录音/转写/AI 翻译提示。
- 失败退款、通话记录保存。

验收：

- App 发起拨号，对方普通手机接听。
- 用户说中文，对方听到英文 TTS。
- 对方说英文，用户听到中文或看到中文字幕。
- 通话失败、无人接听、余额不足、服务商未配置都有明确状态。

## 7. 优化主线 D：OCR 和多 Provider

参考 Pot / Translumo，但只吸收适合移动端的部分：

- OCR Provider 抽象保留 iOS Vision、Android ML Kit。
- 后续可加腾讯/阿里 OCR、PaddleOCR、Tesseract 作为服务端或插件式候选。
- 扫描翻译增加最小裁剪区域、低置信度提示、表格/合同模式。
- Provider 不做用户任意插件执行，先做受控 Provider 注册表，避免安全风险。

验收：

- 40 张素材集持续评测。
- OCR 输出保存 provider、confidence、latency。
- 失败或低置信度可重新裁剪、重试或切换 Provider。

## 8. 分阶段计划

### P0 内测优化

- 固化 iOS Nemotron 默认参数。
- 完成模型评测 fixtures 和 `npm run model:evaluate` 门禁。
- 服务端 ASR Provider 返回 language/confidence。
- 同传自动语种识别和 flush 不漏译。

### P1 灰度优化

- LiveKit 双端真实媒体联调。
- Call Link 字幕、历史、用量、断线恢复通过 5 分钟验收。
- OCR 素材集和 Provider 记录。
- Hy-MT2 服务端翻译 Provider、诊断告警、支付沙盒、发布材料完成门禁；Qwen 只作为可选质量兜底。

### P2 商业优化

- VoxCPM2 TTS Provider 接入、Call Link TTS 音轨发布和 PSTN 译音回灌。
- PSTN Bridge 真实媒体回灌。
- AI Calling Agent 真实外呼灰度。
- 通话录音/转写/AI 提示、费用预估、计费和退款闭环。

## 9. 发布门禁

新增或强化以下门禁：

- `npm run model:evaluate -- --json`：模型替换前必须 ready。
- `npm run check:call-link-livekit-worker -- --json`：真实 LiveKit Worker 前置验收。
- `npm run check:translation-worker-pstn-audio-sink -- --json`：PSTN 来音进入 Worker 的 ASR/翻译/TTS 前置验收。
- `npm run check:pstn-provider-media-event -- --json`：服务商签名媒体回调和重复 `eventId` 幂等前置验收。
- `npm run check:pstn-provider-status-event -- --json`：服务商签名通话状态回调和重复 `eventId` 幂等前置验收。
- `npm run check:pstn-internal-media-loop -- --json`：Bridge 来音、Worker 翻译和 Bridge 译音回灌内部闭环验收。
- `npm run check:model-selection-ready -- --json`：模型选型报告必须完成。
- `npm run check:model-routing -- --json`：统一模型接入层必须覆盖 ASR、翻译、TTS，并能渲染当前 Profile 的 env。
- `npm run check:domestic-release-ready -- --env-file release/domestic/release.env --local-stack --json`：总门禁必须包含生产 env 文件、支付、LiveKit、Hy-MT2 服务端翻译、模型选型、PSTN Bridge、服务商签名媒体/状态回调、诊断告警和发布材料。
- 真机验收：iPhone 和 Android 都必须通过同传、Call Link、OCR、历史和权限测试。

## 10. 模型选型

状态：第一版产品选型已完成，正式报告为 `release/domestic/model-selection-report.json`。默认本地链路保留已验证的端侧方案；服务端/通话翻译主模型调整为 Hy-MT2-1.8B。

选型结论：

- 端侧默认：iOS CoreML/Nemotron ASR + iOS 系统翻译 + iOS 系统 TTS。
- 跨平台/通话 ASR 灰度：FireRedASR2-AED；Qwen3-ASR 准确但当前离线 Transformers 路径过慢，暂作非实时/后续 vLLM streaming 备选。
- 跨平台/通话翻译主模型：tencent/Hy-MT2-1.8B 自托管；Qwen 商业通道作为复杂上下文和摘要兜底；LMT-60-0.6B 作为低成本 fallback，前置自动语种识别、分句和去重。
- 跨平台/通话 TTS：VoxCPM2 作为服务端实时通话主接入目标，Worker 配置契约、`services/model-services/tts-service` HTTP 骨架和 Beelink Tailscale 部署已落地；Chatterbox 作为非流式质量 fallback；Qwen3-TTS 保留 baseline；CosyVoice2 降为待修候选，先解决可懂度。

后续优化：

- 固化 FireRedASR2-AED runtime/checkpoint 兼容补丁。
- 为 LMT Provider 增加中英混合分句、自动语种识别和重复翻译去重。
- 使用 Beelink VoxCPM2 TTS endpoint 跑 Call Link/PSTN Worker，输出 `tts.ready`、PCM16 音频和 LiveKit/PSTN 可播放译音；如需公网访问，先补 reviewed HTTPS。
- 对 VoxCPM2 做长句、快语速、英文、噪声、并发和 8k 电话带宽回灌测试。
- 已增加基础 TTS 文本规范化策略，区分字幕显示文本与播报文本，覆盖 SKU/产品码、金额和电话号码；后续继续补人名、地址、单位和真实 VoxCPM2 听感评分。

验收：

- `npm run model:evaluate -- --json` 使用真实候选输出，覆盖全部 requiredGroups。
- `npm run check:model-selection-ready -- --json` 使用真实 `MODEL_SELECTION_FILE` 返回 ready。
- `npm run check:model-routing -- --json` 使用真实 `MODEL_ROUTING_FILE` 返回 ready。
- 每个候选至少有 provider、model、latency、语言置信度或 TTS 电话评分证据。
- 文档给出默认链路、灰度链路和兜底链路。

## 11. 不做事项

- 不拦截系统电话、微信、WhatsApp、Telegram 原生通话音频。
- 不把 NLLB 作为商业默认翻译模型。
- 不用桌面端截图翻译架构替代移动端 OCR。
- 不在模型评测前替换默认 ASR。
- 不为了短期演示绕过支付、录音提示、AI 通话提示和发布门禁。
