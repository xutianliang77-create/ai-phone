# 国内版优先开发计划

版本：v4.5  
日期：2026-07-08  
关联：`docs/regional-edition-product-design.md`、`docs/ai-communication-feature-design.md`、`docs/ai-communication-technical-design.md`、`docs/domestic-edition-optimization-plan.md`、`docs/fluidvoice-source-review-and-adoption-plan.md`

## 1. 产品目标

国内版优先，先做一款在中国大陆网络、支付、模型和渠道环境下可稳定使用的中英 AI 通讯翻译 App。

首发定位：

- 中英面对面实时同传。
- Listening Mode：会议、课堂、讲座字幕和翻译。
- Type-to-Speak：姓名、地址、号码、专业词输入后翻译并朗读。
- 历史记录：全文、摘要、重点、术语、导出。
- 扫描翻译：相机、相册、截图 OCR 翻译。
- Call Link：通过微信/短信/复制链接让对方进入翻译通话房间。
- 国内模型 Provider：Qwen、腾讯、自部署至少一条真实链路。
- 国内支付和合规基础：Apple IAP、微信/支付宝准备、隐私与备案材料。

重要边界：

- 不宣传直接拦截系统电话、微信、WhatsApp、Telegram 原生通话音频。
- 拨打手机号翻译电话要做，但国内版先进入灰度；正式开放依赖 PSTN/VoIP 服务商、录音/AI 转写提示、支付和合规评审。
- 国内版主链路不依赖不可稳定访问的海外 AI 服务。

## 2. 发布分层

| 层级      | 目标                 | 必须包含                                                      |
| --------- | -------------------- | ------------------------------------------------------------- |
| P0 内测版 | 证明核心翻译体验可用 | 同传、Listening、Type-to-Speak、历史、国内 Provider、自建监控 |
| P1 灰度版 | 形成可付费闭环       | Call Link、扫描翻译、摘要重点术语、支付沙盒、合规中心         |
| P2 商业版 | 加入高价值通话能力   | 拨打手机号翻译电话、AI Calling Agent、双向 TTS、分钟计费      |
| P3 增强版 | 差异化增强           | 自定义语音、团队词库、多语言、企业控制台                      |

## 3. 当前基线

| 模块             | 状态                                                             | 说明                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter App      | 已有 MVP                                                         | 五 Tab、中文界面、iOS 真机可跑                                                                                                                                                                                                                              |
| iOS 端侧 ASR     | 已可用                                                           | CoreML/Nemotron 主链路；长句和噪声场景需继续验收                                                                                                                                                                                                            |
| 自动语种识别     | 已接入                                                           | 中英互译可用；快速切换和混说需继续优化                                                                                                                                                                                                                      |
| 历史记录         | 已有闭环                                                         | 保存、详情、导出、服务端复盘生成、术语确认/撤销和下次同传纠错提示已接通                                                                                                                                                                                     |
| Type-to-Speak    | 已有闭环                                                         | 输入文本可自动翻译、朗读并保存到历史；保存走专用历史端点，不扣实时同传时长；屏幕译文和 TTS 播报文本分离                                                                                                                                                     |
| 国内 Provider    | 基础完成                                                         | 统一模型接入层已补 `release/domestic/model-routing.json`，Hy-MT2 自托管翻译主链路已接；qwen_live 保留为质量兜底；新增模型评测脚手架用于横评 Qwen3-ASR、FireRedASR2、LMT、VoxCPM2、Chatterbox、Qwen3-TTS/CosyVoice；腾讯 TRTC 待真实 POC                                                                 |
| Call Link        | App 主持人可入房，Translation Worker 已具备 LiveKit 音频订阅入口 | 链接、room token、App 主持人 LiveKit SDK 入房、App/Web Guest 字幕列表、角色标注、内部 Worker 事件入口、独立 Translation Worker 核心、历史持久化、App 结束保存和扣费已接；Worker 专用房间 token 与 LiveKit Node 音频订阅适配器已完成；自建 LiveKit env、渲染脚本、配置门禁和部署手册已补，真实 VM 部署和双端媒体联调待完成 |
| OCR              | 已有基础闭环                                                     | iOS Vision / Android ML Kit 已接；扫描结果可翻译、导出分享并保存到历史；需 40 张素材集真机/模拟器验收                                                                                                                                                       |
| 支付             | 服务端基础完成                                                   | 订单、ledger、Apple JWS、微信/支付宝 adapter、HTTPS 回调门禁已接；真实商户沙盒未完成                                                                                                                                                                        |
| 合规监控         | 部分完成                                                         | 日志脱敏、异常上报、监控查询、外部告警 webhook、发布材料和国内版基线一致性门禁已有                                                                                                                                                                          |
| AI Calling Agent | App/API/Worker/Bridge 控制面已接                                 | App 任务页、话术草稿、风险分级、用户授权、确认前取消、执行队列、Worker 状态回写、结果展示、内部队列拉取、PSTN Bridge 骨架、`/translated-audio` 译音回灌入口和签名完成回调已接；真实 PSTN 媒体执行待联调                                                     |

## 4. 架构原则

- 一套 Flutter 代码，通过 `REGION_EDITION=domestic|international` 切换区域能力。
- 国内版默认 `REGION_EDITION=domestic`、`DATA_REGION=cn`、`COMPLIANCE_PROFILE=pipl`。
- Provider 统一走 Router，按地区、套餐、可用性、成本和健康状态选择。
- 语音链路拆分为 ASR、翻译、TTS、记录、计费，避免单文件或单服务过大。
- 服务端负责权益、用量、支付、通话状态和审计；客户端不作为 credits 单一真源。
- 默认不保存原始音频；日志、诊断、导出都必须脱敏。
- 参考 RTranslator、LiveKit、Pot Desktop、Translumo 的产品模式，但不复用代码、资产或商业授权不清晰的模型；优化方案以 `docs/domestic-edition-optimization-plan.md` 为准。
- 参考 FluidVoice 的端侧优先、Provider 抽象、LLM 后处理、raw/processed 历史和 Provider 验证思路；因 GPLv3 许可限制，仅吸收设计，不复制源码或资产。

## 5. D0 区域化基线

任务：

- 固化国内版默认配置。
- App、API、Gateway 都输出 region、dataRegion、provider policy。
- 国内版隐藏 Stripe、Google Play、Twilio/Telnyx 国际默认文案。
- 国际版配置保留，但不作为当前验收主线。

交付物：

- `RegionEditionConfig`。
- `/health` 区域化字段。
- 国内版诊断页。

## 6. D1 中文 UI 与移动端适配

任务：

- 五 Tab：同传、通话、扫描、记录、我的。
- 所有主要界面中文化。
- iPhone、Android 大小屏适配。
- 字幕超过一屏自动滚动到最新。
- 权限按场景触发，不在首次启动一次性申请。
- 发布身份从 iOS `LocalIdentity.xcconfig`、Android `key.properties` 和 release keystore 读取。

交付物：

- 国内版首页。
- 同传页、通话页、扫描页、记录页、我的页。
- 自动滚动和安全区适配。

## 7. D2 同传主链路

任务：

- iOS CoreML/Nemotron ASR 保持默认稳定参数。
- Android 已接系统 `SpeechRecognizer` ASR 兜底，通过 `DEVICE_ASR_PROVIDER=android_system` 或 `system` 启用；云 ASR 仍作为服务端兜底和灰度链路。
- 端侧 ASR 首次 native start 出现瞬时失败时自动清理原生状态并重试一次；连续失败仍结束会话并保存已有字幕。
- 自动语种识别：中文说话翻英文，英文说话翻中文。
- flush 机制：说完后必须补交最后一段，避免“有原文无翻译”。
- VAD、缓冲窗口、端点检测、重复转写去重。
- Type-to-Speak 支持翻译、系统朗读、保存到历史记录；服务端保存不消耗实时同传分钟。
- 领域词纠错第一批：字幕、实时识别、同声传译、端侧翻译、会议纪要。

交付物：

- Talk Mode。
- Listening Mode。
- Type-to-Speak。
- 术语纠错入口。

## 8. D3 国内模型 Provider

任务：

- self-hosted：SenseVoice + Qwen/LM Studio + 系统 TTS 作为兜底。
- Qwen：通过 QWEN_* 接入阿里云 OpenAI-compatible 商业通道，验证实时翻译延迟、稳定性和成本。
- 腾讯 TRTC AI：验证会议/通话场景。
- Provider health、latency、failure reason、fallback、分段 token 估算和 session 导出记录。
- Provider 不可用时提示清晰，`/health/release-ready` 阻断 mock、开发 LM Studio alias 和缺失 QWEN_* 配置。
- OpenAI-compatible 翻译 Provider 必须把短句、命令式原文和问题包装为待翻译文本；模型返回道歉、索要上下文或其它聊天式非译文时，自动二次强制翻译，仍失败则只发布失败状态而不把拒译内容当译文。
- TODO：新增 LLM Provider 抽象，专用于 ASR final 文本优化、会议纪要和通信记录整理；必须支持 OpenAI-compatible `/v1/chat/completions`、JSON 输出校验、超时、重试、空输出回退、thinking 标签剥离和 provider/model/promptVersion 诊断。
- TODO：新增 LLM Provider 验证和 fingerprint：baseURL + apiKey 生成配置指纹；本地端点允许无 key；云端端点必须 key；配置漂移时要求重新验证。
- 模型替换前必须进入 `model-eval` fixtures，比较 CER/WER、语言识别准确率、首字延迟、整句延迟、TTS 首包延迟和成本。
- 已完成 ASR、翻译、TTS 第一版产品选型报告并追加 Beelink TTS 产品适配评测：默认仍保留 iOS Nemotron 端侧 ASR 链路；FireRedASR2、LMT 进入跨平台/通话灰度；VoxCPM2 作为服务端实时通话 TTS 主接入目标，已进入 `translation-worker` 的 HTTP TTS Provider 身份契约、发布 env 门禁和 `check:tts-provider` 真实服务 smoke 门禁；`services/model-services/tts-service` 已提供 mock/VoxCPM2 HTTP 服务骨架，mock 可用于本地合同冒烟，VoxCPM2 模式在 runtime 或模型缺失时返回 degraded/503；Beelink Tailscale 内网已部署 VoxCPM2 TTS 服务并通过真实 HTTP smoke，公网 HTTPS 暴露和 LiveKit/PSTN 回灌仍待验收；Chatterbox 作为非流式质量 fallback，Qwen3-TTS 保留 baseline，CosyVoice2/CosyVoice3 先降为待修研究项。

交付物：

- Provider Router。
- 至少一条国内真实链路。
- Provider 运行日志、健康页和 Gateway 发布门禁。
- `npm run model:evaluate -- --json` 评测结果和候选模型结论。
- `npm run check:model-selection-ready -- --json` 发布门禁；真实报告路径为 `MODEL_SELECTION_FILE`，示例为 `release/domestic/model-selection-report.example.json`。
- `npm run check:model-routing -- --json` 校验统一模型接入层；真实路由路径为 `MODEL_ROUTING_FILE`，默认 `release/domestic/model-routing.json`。
- `npm run check:tts-provider -- --json` 验证 VoxCPM2 HTTP TTS 返回 provider/model 身份、PCM16 音频和首包延迟。

## 9. D4 记录、摘要、重点、术语

任务：

- 历史详情四个视图：摘要、重点、全文、术语。
- Summary Service 先用本地规则兜底，可接 Qwen/self-hosted OpenAI-compatible LLM。
- Highlight Service 抽取时间、地点、金额、待办、号码，并写入会后复盘。
- Terms Service 支持用户确认、撤销、下次同传生效。
- Markdown 导出和系统分享。
- TODO：session segment 同时保存 `rawText`、`optimizedText`、`translatedText`，并保留 LLM refinement 诊断字段。
- TODO：改造 `/sessions/:sessionId/review`，输出 title、summary、decisions、actionItems、keyFacts、risks、openQuestions、terms 和 evidence segment 引用。
- TODO：App 历史详情增加纪要、待办、全文原始识别、智能优化、译文和 Markdown 导出展示。
- TODO：术语库升级为翻译术语、ASR 保护词和 LLM 保护字段三层；支持导入、合并、去重和下次同传生效。
- TODO：App 后续增加行业选择，先覆盖商业、科技、医疗、旅游、餐饮、娱乐，并可扩展产品、教育、外贸等行业包；短期服务端通过 `DOMAIN_LEXICON_PACKS` 控制行业词库、ASR 热词和纠错词表。

交付物：

- 会后复盘详情页和手动生成入口。
- 术语库基础。
- 导出分享。

## 10. D5 扫描翻译

任务：

- iOS Vision OCR。
- Android ML Kit OCR。
- 拍照、相册、截图导入。
- 原文、译文、对照视图。
- OCR 结果保存到记录；翻译暂不可用时仍可保存识别文字，服务端保存不消耗实时同传分钟。

交付物：

- 扫描翻译页。
- OCR Provider 抽象。
- 40 张素材验收集。

## 11. D6 Call Link 通话房间

任务：

- 国内可访问的 WebRTC/LiveKit 房间。
- 自建 LiveKit VM 配置、DNS、Caddy、Redis、TURN/UDP 和发布 env snippet。
- App 主持人 LiveKit SDK 入会并发布麦克风。
- Web Guest 免安装入会。
- 微信、短信、复制链接分享。
- 双方实时字幕、翻译、TTS 播放。
- Translation Worker 通过 LiveKit data topic 下发 `transcript.final`、`translation.final` 和 `tts.ready`。
- Translation Worker 在 LiveKit Node RTC 支持本地发布音轨时，自动追加 LiveKit TTS Audio Sink，按目标角色发布 `translation-tts-{host|guest}-{sampleRate}` 译音轨，并把 TTS PCM16 切分为音频帧送入房间。
- App Host 和 Web Guest 按 segment 合并显示原文、译文和 `tts.ready` 语音就绪状态。
- App Host 和 Web Guest 对 `translation-tts-*` 译音轨执行目标角色播放控制：host 只播放 `translation-tts-host-*`，guest 只播放 `translation-tts-guest-*`，普通远端麦克风轨保留为 TTS 未接通时的兜底原声。
- App Call Link 字幕超过一屏后自动滚动到最新段落。
- Call Link 创建后同步生成历史 session，sessionId 与 callId 对齐。
- Worker 字幕事件按 segment 写入历史全文。
- 独立 Translation Worker 通过 HTTP ASR、OpenAI-compatible 翻译 Provider 和 `/internal/call-links/:callId/events` 提交字幕、译文和 TTS 就绪事件。
- API 通过 `/internal/call-links/:callId/worker-room-token` 给 Worker 签发可订阅用户音频、也可发布翻译 TTS 音轨的 LiveKit token。
- Translation Worker 通过 LiveKit Node RTC 订阅 host/guest 音频轨，按说话方转成 PCM16 帧进入 ASR 和翻译链路。
- 提供可重复执行的 LiveKit Worker 前置验收脚本，覆盖 token、权限、runtime、smoke caption、`tts.ready` 和历史写入。
- 提供 Beelink/Linux Worker 真实媒体验收脚本，覆盖 host/guest/worker 三方入房、data channel、worker 音频订阅和翻译 TTS 音轨回灌订阅。
- 结束接口幂等完成通话 session、记录时长并扣减用量。
- 结束后生成通话记录、摘要、重点和用量。

交付物：

- Call Link API、room token、App 主持人入房、Web Guest 页面和发布门禁。
- `infra/livekit-selfhost` 自建部署模板、`render:livekit-selfhost` 渲染命令、`check:livekit-selfhost-config` 配置门禁和 `docs/poc/livekit-selfhost-runbook.md`。
- App/Web Call Link 字幕组件支持 `tts.ready` 状态展示。
- 受管理员 token 保护的 Worker 字幕烟测入口。
- 受内部密钥保护的真实 Worker 字幕事件入口。
- 独立 Translation Worker workspace、HTTP ASR Provider、翻译 Provider 和内部事件客户端。
- Worker 专用 room token API 和 LiveKit 音频订阅适配器。
- App/Web 目标角色译音轨播放过滤和 Call Link 长字幕自动滚动。
- `npm run check:call-link-livekit-worker` 前置验收命令和联调手册。
- `npm run check:livekit-room-media` 真实媒体验收命令；内测时从 Beelink Worker 目录执行同名脚本。
- App 通话中页面和主持人字幕列表。
- Web Guest 页面、按段合并字幕、TTS 就绪状态和我/对方角色标注。
- Call Link 历史 session、字幕分段持久化和结束接口。
- App 主持人端“结束并保存”调用结束接口并显示保存结果。
- 通话状态机。

## 12. D7 支付、套餐和 credits

任务：

- 套餐：Free、Pro、Plus、Credits。
- Apple IAP：StoreKit 2、JWS 服务端验签、Server Notifications。
- iOS 恢复购买：拉取 StoreKit 当前权益/未完成交易，提交服务端确认后刷新权益。
- 微信支付/支付宝：下单签名、HTTPS 回调地址、回调验签、幂等、退款。
- credits ledger：购买、消耗、退款、人工调整。
- `/health/ready` 阻断缺失、短密钥、本地回调等支付配置的发布。
- 本地自动验收：`npm run check:domestic-payment-callbacks -- --json --no-save` 固化微信/支付宝签名回调、重复回调、错签拒绝和 ledger 增量。
- 国内 Android 未接通微信/支付宝 native 商户流程前，App 不公开购买入口，只展示套餐、余额和“暂未开放”。

交付物：

- 套餐与用量页。
- 订单和 ledger API。
- 支付 adapter。
- iOS 恢复购买入口和服务端确认闭环。
- 支付发布门禁和国内支付 notifyUrl。
- 国内支付回调 smoke 证据。
- 移动端发布门禁检查 Android 购买入口保持隐藏。

## 13. D8 拨打手机号翻译电话

任务：

- 用户侧使用 App 内 VoIP/WebRTC，不跳转系统 Phone App。
- 对方侧接听普通电话。
- 服务端通过 PSTN/VoIP 服务商拨号并桥接双方音频。
- 双向链路：ASR -> 翻译 -> TTS -> 对方听到译音。
- 通话前展示费用预估、录音/转写/AI 翻译提示。
- 余额不足、合规未通过、服务商未配置时禁止发起；策略打开后 `/health/release-ready` 必须阻断未配置 PSTN。

交付物：

- Call Orchestrator。
- PSTN Bridge Adapter、`callId -> providerCallId/mediaStreamId` 路由、`/media-frames` 来音接入入口、`/provider/media-events` 服务商签名来音入口、`/provider/status-events` 服务商签名状态入口、服务商 `eventId` 幂等、终态 `consumedSeconds` 透传、8k μ-law 来音转 PCM16、Translation Worker PSTN audio frame sink、`/translated-audio` 译音回灌入口、PCM16 -> 8k μ-law 译音编码、媒体写入器和灰度发布门禁。
- `npm run check:pstn-provider-media-event -- --json` 服务商签名媒体回调自动验收。
- `npm run check:pstn-bridge-audio -- --json` 译音回灌自动验收。
- `npm run check:translation-worker-pstn-audio-sink -- --json` 电话来音驱动 Worker ASR/翻译/TTS 自动验收。
- `npm run check:pstn-internal-media-loop -- --json` Bridge 来音、Worker 翻译和 Bridge 译音回灌内部闭环验收。
- 总发布门禁默认执行同等 `pstn_internal_media_loop_readiness`，仅限局部排查可使用 `--skip-pstn-internal-media-loop`。
- `npm run check:pstn-provider-status-event -- --json` 服务商签名通话状态回调自动验收。
- 双向媒体流翻译 Worker。
- 通话计费、`agent_call_usage` ledger、`usageSettledAt` 和 call id 记录。

## 14. D9 AI Calling Agent

任务：

- 场景：预约、客服查询、外贸询价。
- 用户填写目标、号码、偏好、必要信息。
- AI 生成话术，必须用户确认后拨打。
- 通话中可查看转写、翻译和状态，并可人工接管。
- 付款、身份验证、合同、医疗、法律、金融触发接管。
- App 和 API 已落地 `/ai-calling-agent/drafts` 草稿、授权、确认前取消、执行队列和接管审计。
- `/ai-calling-agent/drafts/:draftId/start` 只在 Agent Worker、PSTN 策略和内部密钥就绪后进入 `queued`；未就绪返回 503，不自动外呼。
- `/ai-calling-agent/drafts/:draftId/start` 同时检查剩余用量；低于 60 秒时返回 `agent_call_insufficient_balance`，不进入 `queued`。
- 内部 Worker 通过 `/internal/ai-calling-agent/drafts/:draftId/status` 回写 `in_progress`、`completed`、`failed`、provider call id、结果摘要、失败原因、下一步和可选 `consumedSeconds`。
- Agent Call Worker 通过 `/internal/ai-calling-agent/drafts/queued` 拉取队列，并把任务提交给 `PSTN_BRIDGE_BASE_URL` 的 HTTP Bridge；Bridge 未配置时 Worker 不调度。
- 新增 `@translation/pstn-bridge` 服务，提供 `POST /agent-calls`、`POST /translated-audio`、Bearer 鉴权、mock provider、HTTP 上游 provider、Fonoster-compatible provider 和 `/health/release-ready` 发布门禁。
- PSTN Bridge 通过 `/provider/status-events` 接收服务商 `answered/completed/failed` 等状态，再签名调用 API `POST /webhooks/pstn/agent-calls`；Bridge 和 API 都按 `eventId` 幂等处理服务商重放。
- 本地隔离验收命令 `npm run check:agent-call-worker` 自动启动 API、mock PSTN Bridge 和真实 Worker，验证入队、调度、`in_progress` 回写、带 `consumedSeconds` 的签名完成回调，以及余额耗尽后二次 start 不入队；总发布门禁默认执行同等 `agent_call_worker_readiness`。

交付物：

- Agent 任务页。
- 话术预览。
- 用户授权、确认前取消、执行队列、Worker 调度和接管机制。
- Agent Call Worker 本地 smoke 门禁和联调手册。
- PSTN Bridge 服务商签名媒体/状态入口、API signed status webhook 和 Bridge/API 双重事件幂等。
- PSTN Bridge 可部署服务骨架和联调手册。
- 任务结果、失败原因和下一步摘要。

## 15. D10 TTS 和语音输出

任务：

- 端侧系统 TTS 作为本地默认输出。
- 服务端通话 TTS 主模型：VoxCPM2。`translation-worker` 已支持 `TTS_PROVIDER=voxcpm2`、`TTS_MODEL=VoxCPM2`、`TTS_HTTP_ENDPOINT` 和 `TTS_HTTP_API_KEY`；若 TTS 服务返回了不匹配的 provider/model，Worker 不会发布错误的 `tts.ready`。
- `services/model-services/tts-service` 已提供 `GET /health` 与 `POST /tts/synthesize`，mock provider 可返回 deterministic PCM16 做本地自动化合同冒烟；`TTS_SERVICE_API_KEY` 配置后合成接口强制 Bearer 鉴权；`TTS_SERVICE_PROVIDER=voxcpm2` 时使用 lazy load，缺 VoxCPM2 runtime 或模型目录会返回 degraded/503，不生成假音频。
- `npm run deploy:beelink-tts` 已能把 TTS 服务同步到 Beelink `/data/models/translation-model-eval/services/tts-service` 并重启 `8002`；当前 Tailscale endpoint `http://100.110.127.117:8002/tts/synthesize` 通过 `check:tts-provider`，warm latency 约 1s，`firstAudioMs` 约 22ms。
- Translation Worker 已新增 TTS Provider 抽象、`tts.ready` 事件、`TTS_AUDIO_SINK_ENDPOINT` 音频输出口和 PSTN audio frame sink；配置 VoxCPM2 HTTP TTS 后可把 PCM16 译音交给 LiveKit/PSTN 播放服务。HTTP TTS 返回无效或缺失 PCM16 音频时不发布 `tts.ready`，Worker 保留原文和译文字幕并发中文状态提示。PSTN Bridge 已提供 `POST /translated-audio`，可作为 `TTS_AUDIO_SINK_ENDPOINT` 接收译音、转发给上游服务商，并在配置媒体写入器后按 `mediaStreamId` 写回电话媒体流。
- Translation Worker 已新增基础 TTS 文本规范化：字幕仍保留原译文，发给 TTS 的播报文本会对 SKU/产品码、金额、电话号等做可读化处理，避免符号和长数字直接乱读。
- Chatterbox 作为非流式质量 fallback；Qwen3-TTS 作为 baseline；国内云 TTS 保留商业 fallback；CosyVoice 自部署待可懂度修复后再回到候选。
- Type-to-Speak 已接入基础朗读文本规范化：展示译文保持不变，系统朗读前会对产品码、金额、电话号等做可读化处理；地址、姓名和单位继续在真实语料验收中扩展。
- 通话中 TTS 播放时处理回声和重复识别。
- 自定义语音放到 P3，必须用户授权。

交付物：

- TTS Provider 抽象。
- HTTP TTS Provider、Worker `tts.ready` 控制事件和 HTTP TTS 音频输出 sink。
- LiveKit TTS Audio Sink、目标角色译音轨发布和 PCM16 音频帧推送。
- VoxCPM2 TTS HTTP Provider 身份契约、基础 TTS 文本规范化、TTS HTTP 服务骨架、Beelink 部署脚本、发布 env 门禁和 `check:tts-provider` 服务 smoke；公网 HTTPS、8k 电话带宽回灌、听感和并发稳定性验收。
- 常用短语和收藏。
- 通话中朗读队列。

## 16. D11 合规、安全和监控

任务：

- APP 备案主体、公司主体和 `RELEASE_MATERIALS_FILE` 发布清单；APP 备案号在正式取得前保留 `京ICP备00000000号-1A` 占位，当前开发验收允许该占位，正式提交渠道前再替换真实备案号。
- 国内版生产环境文件 `release/domestic/release.env`；上线前必须通过 `npm run check:domestic-release-env -- --file release/domestic/release.env --json`，确认支付、LiveKit、诊断、Hy-MT2 翻译 Provider、PSTN Bridge、模型路由和发布材料路径不再使用占位值，且 API key/webhook secret 达到最小长度、Apple 根证书 SHA-256 为 64 位 hex 指纹；总发布门禁还会检查 `release/domestic/release.env`、Android `key.properties` 和 release keystore 已被 `.gitignore` 保护。
- Call Link、Realtime 分段写入、术语库内部读取、Translation Worker 和 AI Agent 的内部接口必须配置强 `INTERNAL_API_SECRET`；缺失或过短时内部接口、API release-ready 和总发布门禁不得通过。
- 隐私政策、用户协议、第三方 SDK 清单、模型服务商清单。
- 权限用途说明和删除记录入口。
- 日志脱敏：手机号、邮箱、token、apiKey、Apple JWS、原文、译文、音频 data。
- App 异常上报、监控查询、fatal 告警、`check:domestic-release-materials` 国内版基线一致性和 release-ready 门禁；总发布门禁默认执行同等 `release_materials_readiness`。
- 正式外部告警 webhook 和 on-call 流程。
- webhook 支持通用 JSON、企业微信、飞书、钉钉文本机器人格式和管理员测试投递。
- `check:diagnostics-alerting -- --local-stack` 本地隔离 smoke：启动 API 和 mock webhook，验证签名告警投递与敏感详情不外发；总发布门禁默认执行同等 `diagnostics_alerting_local_smoke`。

交付物：

- App 内隐私与合规中心。
- 监控和告警配置。
- 发布前合规包和发布材料清单。

## 17. D12 渠道和发布

任务：

- iOS 中国区包。
- 国内安卓渠道包。
- 渠道截图、文案、隐私标签。
- `npm run generate:domestic-release-screenshots` 生成 iOS/Android 基线渠道截图，用于发布材料草稿和截图门禁回归。
- 内测、灰度、正式发布版本号策略。
- 客服和退款处理流程。

交付物：

- Release Candidate。
- 渠道材料。
- 发布回滚预案。

## 18. 里程碑

| 里程碑        | 放行条件        | 目标                           |
| ------------- | --------------- | ------------------------------ |
| M1 内测       | D0-D4 通过      | 真实用户测试同传和记录         |
| M2 功能闭环   | D0-D7 通过      | 可灰度付费，Call Link 可演示   |
| M3 通话灰度   | D8 通过内部验收 | 小范围开放拨打手机号           |
| M4 Agent 灰度 | D9 通过内部验收 | 开放 AI 代打电话，确认前可取消 |
| M5 上架准备   | D0-D12 全部通过 | iOS 中国区和安卓渠道提交       |

## 19. 近期执行顺序

1. 运行 `npm run generate:domestic-release-screenshots` 生成发布材料基线截图；填充真实发布材料清单，APP 备案号先保留 `京ICP备00000000号-1A` 占位，备案完成后再替换为真实备案号；运行 `check:domestic-release-materials` 并完成法务/渠道复核。
2. 先运行 `npm run check:diagnostics-alerting -- --local-stack --webhook-format generic --json --no-save` 回归本地告警链路，再分别用 `wecom`、`feishu`、`dingtalk` 跑本地机器人格式 smoke；最后使用真实企业微信/飞书/钉钉机器人完成外部告警联调，并运行 `npm run check:diagnostics-alerting -- --json` 留存验收结果。
3. 先跑 `npm run check:domestic-payment-callbacks -- --json --no-save` 固化本地支付回调，再跑 Apple Sandbox Notifications、微信/支付宝真实沙盒。
4. 自建 LiveKit：先准备 `livekit.qkxy.cn` / `turn-livekit.qkxy.cn` DNS 和 VM 防火墙，运行 `npm run check:livekit-selfhost-config -- --env infra/livekit-selfhost/.env --json` 与 `npm run render:livekit-selfhost -- --env infra/livekit-selfhost/.env --output infra/livekit-selfhost/generated --json`，部署后再完成 App 主持人 + Web Guest + Translation Worker 三端媒体联调。
5. 跑 `generate:android-release-keystore` 和 `configure:mobile-release-identity` 后执行 `npm run check:domestic-release-env -- --file release/domestic/release.env --json` 与 `npm run check:domestic-release-ready -- --env-file release/domestic/release.env --json`；本机旧服务干扰时加 `--local-stack`，签名主体为“北京乾坤祥云科技有限公司”，并通过同一个 env 文件校验真实模型选型、发布材料、国内支付回调 smoke、Agent Call Worker、PSTN Bridge 与 PSTN 内部媒体闭环。
6. 用固定语料回归 ASR、自动语种识别、flush 和自动滚动。
7. 做 Call Link 5 分钟双人通话真机验收。
8. 先跑 `npm run check:agent-call-worker -- --json` 固化本地 Worker 调度和签名 webhook 闭环，再跑 `npm run check:pstn-bridge-media-ingest -- --json` 固化内部电话来音接入，跑 `npm run check:pstn-provider-media-event -- --json` 固化服务商签名来音回调，接着跑 `npm run check:translation-worker-pstn-audio-sink -- --json` 固化来音进入 Worker 的 ASR/翻译/TTS，随后跑 `npm run check:pstn-bridge-audio -- --json` 固化译音回灌入口，再跑 `npm run check:pstn-internal-media-loop -- --json` 固化内部媒体闭环，最后联调真实 Agent Worker/PSTN 服务商，把 `PSTN_BRIDGE_BASE_URL` 接到真实媒体桥并驱动 `queued/in_progress/completed/failed`。
9. 整理 APP 备案、隐私、SDK/模型服务商清单；APP 备案号保留 `京ICP备00000000号-1A` 占位，开发验收可通过，正式提交渠道前替换真实号码。
10. 模型选型和模型接入层已生成正式 `release/domestic/model-selection-report.json` 与 `release/domestic/model-routing.json`：端侧 iOS Nemotron 继续保留；服务端主链路调整为 FireRedASR2-AED ASR、Hy-MT2 翻译、VoxCPM2 TTS；后续补 LMT 混合语种分句去重、Qwen3-TTS 真流式 runtime，以及 CosyVoice2 隔离官方环境下的 prompt/reference/runtime 可懂度修复。

## 20. 主要风险

| 风险               | 影响             | 应对                                                                |
| ------------------ | ---------------- | ------------------------------------------------------------------- |
| 中文 ASR 长句不稳  | 翻译准确率下降   | 固定稳定参数、后处理、术语库、云 ASR 兜底                           |
| 国内 PSTN 合规复杂 | 电话翻译无法公开 | 先 Call Link，PSTN 仅灰度并保留合规开关                             |
| Provider 成本过高  | 毛利不可控       | Router 按套餐选择模型，按分段记录 provider/model/latency/token 估算 |
| 支付联调慢         | 无法灰度收费     | Apple IAP 先通，微信/支付宝并行沙盒                                 |
| 上架材料不全       | 延迟发布         | D11 提前开始，不等功能完成后再补                                    |
