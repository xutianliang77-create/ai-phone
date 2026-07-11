# AI 通讯翻译总技术设计

版本：v0.1  
日期：2026-07-02  
依据：`docs/ai-communication-feature-design.md`、`docs/ai-communication-ui-design.md`、`docs/ai-communication-ui-screen-specs.md`  
专项：电话/PSTN 详见 `docs/ai-phone-translation-technical-design.md`、`docs/ai-phone-translation-protocol-design.md` 和 `docs/ai-phone-translation-data-ops-design.md`

## 1. 技术目标

把当前中英同传 App 扩展为 AI 通讯翻译平台，覆盖：

- 同传：面对面 Talk Mode、Listening Mode、Type-to-Speak。
- 通话：Call Link、拨打手机号、AI Calling Agent。
- 扫描：相机、相册、截图 OCR 翻译。
- 记录：全文、摘要、重点、术语建议、导出。
- 我的：语言、语音、隐私、用量、订阅、credits。

核心指标：

- 同传启动 3 秒内有识别反馈。
- 普通字幕译文 1-3 秒出现。
- 通话翻译目标延迟 2-5 秒。
- 通话、同传、扫描都能进入统一历史。
- 付费和 credits 不在客户端可信计算。

## 2. 总体架构

```text
Flutter App / Web Guest
        |
        +--> API Server
        |       +--> Auth / User
        |       +--> Sessions / Records
        |       +--> Billing / Credits
        |       +--> Terms / Settings
        |
        +--> Realtime Gateway
        |       +--> ASR / Translation / TTS Provider Router
        |
        +--> Call Orchestrator
        |       +--> LiveKit / WebRTC Room
        |       +--> PSTN Bridge
        |       +--> Call Event Stream
        |
        +--> Media AI Workers
                +--> ASR
                +--> Translation
                +--> TTS
                +--> Summary / Highlight
                +--> OCR
```

## 3. 前端模块

Flutter 按 feature 拆分：

| Feature | 职责 |
| --- | --- |
| `live` | 面对面同传、听讲、Type-to-Speak、实时字幕 |
| `call` | 通话首页、Call Link、拨号页、通话房间、AI Agent |
| `lens` | 相机/相册/截图 OCR 翻译 |
| `records` | 历史列表、详情、摘要、重点、全文、导出 |
| `settings` | 语言、语音、隐私、术语库、用量、订阅 |
| `billing` | credits 展示、购买入口、用量提示 |
| `shared_audio` | 麦克风、TTS 播放、音频权限、音频会话 |
| `shared_realtime` | WebSocket/WebRTC client、重连、事件模型 |

文件原则：

- 页面、controller、repository、model、widget 分开。
- 单文件控制在 350 行以内。
- iOS/Android 差异只放在 platform adapter。

## 4. 后端模块

| 模块 | 职责 |
| --- | --- |
| API Server | REST API、鉴权、持久化、导出、订阅和 credits |
| Realtime Gateway | 面对面/听讲实时音频和字幕事件 |
| Call Orchestrator | 通话状态机、房间、拨号、webhook、结束结算 |
| Provider Router | ASR、翻译、TTS、摘要、OCR 的 provider 选择 |
| Billing Ledger | 预扣、tick、结算、退款、成本入账 |
| Summary Service | 会后摘要、重点、待办、术语建议 |
| Export Service | Markdown、PDF、纯文本导出 |
| Terms Service | 术语库、ASR 后处理、用户纠错 |

## 5. 同传链路

面对面模式：

```text
Mobile Mic
-> Mobile ASR 或 Gateway ASR
-> language detection
-> Translation Provider
-> Subtitle Timeline
-> Session Record
```

Listening Mode：

```text
Mobile Mic
-> ASR/Translation
-> Large subtitle timeline
-> Manual highlight events
-> End and summarize
```

规则：

- 面对面默认自动语言识别。
- Listening Mode 默认关闭 TTS。
- “结束并总结”异步生成摘要，不阻塞历史保存。
- partial 识别保留本地显示，final 才入库；结束时 flush。

## 6. Type-to-Speak 链路

```text
User input text
-> translate text
-> TTS synthesize
-> play to local speaker or call target
-> insert call/session segment
```

数据要求：

- Segment 标记 `source=typed`。
- 通话中播放前暂停回声识别窗口。
- 常用短语本地缓存并可同步。

## 7. 通话链路

通话能力分三层：

| 层级 | 技术 |
| --- | --- |
| Call Link | LiveKit/WebRTC room + Web Guest |
| 拨打手机号 | App WebRTC + PSTN provider media stream |
| AI Agent | PSTN provider + Agent Worker + 用户监听/接管 |

通话模块统一事件：

- `call.status`
- `participant.joined`
- `transcript.final`
- `translation.final`
- `tts.started`
- `highlight.created`
- `usage.tick`
- `error`

详细协议见 `docs/ai-phone-translation-protocol-design.md` 和 `docs/ai-phone-translation-data-ops-design.md`。

## 8. 扫描/OCR 链路

```text
Camera / Gallery / Screenshot
-> Image preprocessing
-> OCR Provider
-> Layout grouping
-> Translation Provider
-> Result view
-> Save record
```

Provider 优先级：

1. iOS Vision / Android ML Kit 本地 OCR。
2. 云 OCR 兜底。
3. LLM 视觉理解用于复杂表格或合同，不做 MVP 主链路。

记录类型：

- `record_type=scan`
- 保存原图引用、OCR 原文、译文、区域坐标。
- 默认不上传原图，用户保存/导出时再同步。

## 9. 记录与摘要

统一记录模型：

```text
Record
  id
  type: live | listening | call | agent | scan
  title
  languages
  duration
  summaryStatus
  exportStatus

Segment
  speaker
  sourceText
  translatedText
  sourceLanguage
  targetLanguage
  timestamp
  source: speech | typed | ocr | agent
```

摘要生成：

- 输入：final segments + highlights + metadata。
- 输出：一句话结论、关键事项、待办、时间/地点/金额、风险提示。
- 摘要失败不影响记录详情打开。

## 10. 术语和纠错

术语链路：

```text
ASR final
-> user termbase replacement
-> domain correction
-> translation prompt glossary
-> segment save
```

术语来源：

- 用户手动新增。
- 记录详情“术语建议”确认。
- 系统高频错词表。
- 行业词库包：商业、科技、医疗、旅游、餐饮、娱乐等；短期由服务端配置启用，后续在 App 设置中选择。

首批内置：

- 字幕、实时识别、同声传译、端侧翻译、会议纪要。

## 11. Billing 和 Credits

计费对象：

- 同传分钟。
- Call Link 分钟。
- PSTN 电话分钟。
- AI Agent 分钟。
- AI 摘要次数。
- 云 OCR 次数。

原则：

- 客户端只展示余额。
- 服务端按 heartbeat 和 provider webhook 结算。
- 通话先预扣，失败退款。
- 记录 provider 成本和模型成本。

## 12. 权限和平台适配

| 权限 | 场景 |
| --- | --- |
| 麦克风 | 同传、通话、听讲 |
| 相机 | 扫描翻译 |
| 相册 | 图片导入 |
| 通讯录 | 选择拨号联系人 |
| 通知 | 通话邀请、摘要完成 |

平台适配：

- iOS：AVAudioSession、CallKit 后续接入、Vision OCR、系统 TTS。
- Android：AudioRecord、ConnectionService 后续接入、ML Kit OCR、系统 TTS。
- Web Guest：浏览器 getUserMedia、WebRTC token、轻量字幕 UI。

## 13. 安全与合规

必须满足：

- API key 不进客户端。
- Webhook 验签。
- 手机号脱敏和哈希。
- 默认不保存原始音频。
- 通话前展示 AI 翻译、转写、费用提示。
- 用户可删除记录。
- 代理拨号保存用户授权。

高风险限制：

- AI Agent 不处理付款、身份验证、法律/医疗/金融决定。
- 需要用户接管的场景必须停止自动回复。

## 14. 可观测性

指标：

- ASR 延迟、翻译延迟、TTS 首包延迟。
- 通话接通率、掉线率、未接率。
- summary 成功率。
- OCR 成功率。
- credits 结算错误。
- provider 成本/分钟。

日志维度：

- userId hash。
- sessionId / callId / recordId。
- provider。
- model。
- platform。
- network type。

## 15. 发布策略

P0：保住现有端侧同传稳定性。  
P1：上线新导航、Listening Mode、Type-to-Speak、摘要。  
P2：上线 Call Link 和通话房间。  
P3：上线拨打手机号翻译电话。  
P4：上线扫描翻译、AI Agent、企业/团队能力。

每阶段必须有真机验证和回归测试，不允许只通过模拟器。

## 16. 区域化版本

国内版和国际版共享代码与架构，通过 `RegionEditionConfig` 切换：

- 国际版：OpenAI/Gemini、Twilio/Telnyx、Apple/Google/Stripe。
- 国内版：Qwen/Tencent/自部署、微信/支付宝/安卓渠道，PSTN 默认隐藏或灰度。

详细设计见 `docs/regional-edition-product-design.md` 和 `docs/regional-edition-technical-design.md`。
