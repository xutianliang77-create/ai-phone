# 国内版实时协议、计费与数据架构设计

版本：v1.0  
日期：2026-07-06  
状态：发布级补充设计  
关联：`docs/domestic-app-detailed-functional-design.md`、`docs/domestic-design-review-action-plan.md`、`docs/domestic-technical-design-merge-plan.md`

## 1. 设计目标

本设计把国内版“实时同传、Call Link、PSTN/AI Agent、历史记录、计费账本”放到同一套协议和数据口径下，解决三个问题：

- App、Gateway、Worker、API 对 session、segment、usage、billing 的理解必须一致。
- 在线同传、Call Link、PSTN/Agent 的扣费必须可幂等、可追溯、可解释。
- 历史记录、摘要、重点、术语、导出和删除必须有明确的数据边界。

本设计不推翻当前实现。当前继续使用 Flutter App、Node.js/TypeScript API/Gateway/Worker、Python 模型服务、自建 LiveKit、Qwen3-ASR-0.6B original tuned v3 + Hy-MT2-1.8B + VoxCPM2；FireRedASR2-AED 保留为 ASR fallback。

## 2. 当前实现基线

| 模块 | 当前能力 | 发布级缺口 |
| --- | --- | --- |
| App 实时同传 | 已能创建 realtime session、发送 `audio.frame` 或端侧 `client.text.segment`、接收字幕和译文、保存历史；可识别服务端 quota end 并停止本地录音 | 断线 resume、余额低水位提前 UI、在线 TTS 音频回放和错误恢复仍需真机验收 |
| Realtime Gateway | 已有 WSS `/realtime`、token 校验、audio batch、provider 路由、`usage.tick`、pause/end flush、低余额 graceful end | 缺服务端 VAD 事件、resume token 和限流 |
| API session | 已有 `/realtime/sessions`、内部 segment upsert、session end、历史列表详情导出 | 仍是本地 JSON store，缺云端数据生命周期、用户隔离和删除审计 |
| Usage/Billing | 已有余额、`consumeSeconds`、ledger entry、重复 end 不重复扣费；已接入基础 usage settlement、`<6s` 免计费、`sessionId/note` ledger、持久化幂等键、Gateway capped billable seconds、`usage.hold` 启动预留和 settle/release、内部 `usage.refund` 幂等返还 | 缺双货币 credits、PostgreSQL 账本和运营退款后台 |
| Call Link | 已有 LiveKit room、字幕事件、TTS 事件、历史 upsert、创建前 60 秒余额预留 | 真实双端时长权威源、Guest 同意、WebView 降级和 TTS 轨听感仍待验收 |
| PSTN/Agent | 已有 Bridge、media sink、status webhook、Agent 控制面骨架、Agent start 60 秒余额预留；Agent `failed` 终态释放预留且不扣费 | 真实服务商媒体、被叫告知硬控制、禁拨/频控和运营审计仍待完成 |

## 3. 核心对象

### 3.1 Session

Session 是历史、计费、导出、摘要的主对象。

| 字段 | 含义 |
| --- | --- |
| `id` | session 唯一 ID；当前 realtime 使用 UUID，Call Link 当前 `sessionId = callId` |
| `userId` | 归属用户；当前开发态为 `guest-user`，发布前必须接账号系统 |
| `mode` | `conversation`、`listening`、`call_link`，后续扩展 `pstn_call`、`agent_call` |
| `status` | `created`、`active`、`paused`、`ended`、`failed` |
| `createdAt` / `endedAt` | 创建和结束时间 |
| `consumedSeconds` | 服务端最终结算秒数 |
| `segments` | 原文、译文、模型用量和诊断片段 |

规则：

- 创建 session 时只代表“可开始”，不代表已扣费。
- 结束 session 必须幂等；重复结束只返回既有结果，不重复扣费。
- `ended` 后只允许补摘要、导出和删除，不再追加普通字幕；迟到事件只能写入诊断。

### 3.2 Segment

Segment 是字幕和译文的最小持久化单位。

| 字段 | 含义 |
| --- | --- |
| `id` | segmentId，来自 Gateway/Worker/provider |
| `sourceText` | ASR 原文或端侧识别文本 |
| `translatedText` | 翻译结果或失败提示 |
| `providerUsage` | provider、model、输入输出字符、延迟等模型用量 |
| `language` | 后续补充源语言和目标语言，供自动语种和历史筛选 |
| `diagnostics` | 后续补充 stage、provider、retryable、confidence |

规则：

- `segmentId` 是 upsert 幂等键。
- 同一 segment 先到 `sourceText`、后到 `translatedText` 时必须合并，不新增重复记录。
- 空文本、`<sil>`、纯噪声、重复字幕不进入历史正文，只进入诊断计数。

### 3.3 Usage Event

Usage Event 是计费解释层，当前实现以 `usage.tick` 和 session end 估算为主，发布级需要独立持久化。

| 类型 | 含义 |
| --- | --- |
| `usage.tick` | Gateway 每 30 秒向客户端提示 billableSeconds 和 remainingSeconds |
| `usage.hold` | 创建在线/通话 session 时预留余额；当前已覆盖在线同传、Call Link、AI Calling Agent start |
| `usage.settle` | session 结束时按权威时长结算 |
| `usage.refund` | 通话失败、告知期拒绝、服务端异常后的返还；当前已有 `/internal/sessions/:sessionId/refund` 和系统 refund ledger |

## 4. 在线同传协议

### 4.1 创建 Session

入口：`POST /realtime/sessions`

请求字段：

| 字段 | 要求 |
| --- | --- |
| `mode` | `conversation` 或 `listening` |
| `sourceLanguage` | 自动或 Hy-MT2 支持语言 |
| `targetLanguage` | 自动反向或 Hy-MT2 支持语言 |
| `autoReverseTargetLanguage` | 自动语种反向互译时为 true |
| `voiceOutput` | 是否需要朗读译文 |
| `termbaseId` | 可选术语库 |

返回字段：

| 字段 | 含义 |
| --- | --- |
| `sessionId` | API 与 Gateway 共同使用的 session ID |
| `realtimeToken` | 5 分钟内用于 WSS 握手的短期 token |
| `endpoint` | Gateway WSS 地址 |
| `expiresAt` | token 过期时间 |
| `maxDurationSeconds` | 当前 session 最大时长 |

发布级要求：

- 创建前校验登录、`voice_cloud` 单独同意、余额和风控。
- token 只允许绑定的 `sessionId/userId/mode/language` 使用。
- token 泄漏后最多影响单个短期 session。

### 4.2 WebSocket 握手

入口：`GET /realtime?token=...`

握手成功后 Gateway 必须：

1. 校验 token。
2. 创建 provider session。
3. 加载术语库。
4. 返回 `session.started`。

握手失败返回：

- `error.invalid_token`：不可重试。
- `error.provider_unavailable`：可重试，可提示切回端侧。
- `error.quota_not_enough`：不可继续在线，可提示充值或端侧。

### 4.3 Client Events

#### `audio.frame`

```json
{
  "type": "audio.frame",
  "sessionId": "uuid",
  "sequence": 1,
  "timestampMs": 1783350000000,
  "format": "pcm16",
  "sampleRate": 16000,
  "data": "base64"
}
```

规则：

- `sequence` 在单个 session 内递增。
- `timestampMs` 使用客户端采集时间。
- `format` 当前只支持 `pcm16`。
- `sampleRate` 当前支持 `16000` 或 `24000`。
- `data` 必须是 base64 PCM16。
- Gateway 当前 120ms 延迟批处理，单批最大约 800ms，积压超过约 2400ms 时丢弃过旧音频。

#### `client.text.segment`

端侧 ASR 识别后走服务端翻译时使用。

```json
{
  "type": "client.text.segment",
  "sessionId": "uuid",
  "segmentId": "local-1",
  "text": "你好",
  "language": "zh",
  "isFinal": true,
  "confidence": 0.92
}
```

规则：

- `language` 优先使用端侧 ASR 返回语言。
- 低置信度仍可发送，但必须带 `confidence` 供诊断。
- Gateway 不得用目标语言反推真实源语言，除非 provider 未返回语言且客户端也未给出。

#### 控制事件

| 事件 | 作用 |
| --- | --- |
| `session.pause` | 停止接收新音频，flush pending audio 和 provider |
| `session.resume` | 恢复接收音频 |
| `session.end` | 停止接收，依次 flush audio batch、ASR/provider、segment sink，发送带完整性摘要的 `session.ended` 后关闭连接 |

### 4.4 Server Events

| 事件 | 含义 | 持久化 |
| --- | --- | --- |
| `session.started` | Gateway 已创建 provider session | 不写正文 |
| `transcript.partial` | 中间字幕 | 默认不写历史 |
| `transcript.final` | 最终原文 | upsert `sourceText` |
| `translation.delta` | 中间译文 | 默认不写历史 |
| `translation.final` | 最终译文 | upsert `translatedText` |
| `translation.failed` | 翻译失败 | upsert 失败提示并记录诊断 |
| `audio.output` | 服务端返回 TTS 音频 | 默认不保存原始音频 |
| `usage.tick` | 在线用量提示，可带 `lowBalance` | UI 展示，P1 后写 usage event |
| `session.paused` | 已暂停 | 更新 UI |
| `session.ended` | 已结束，带 `reason/billableSeconds/remainingSeconds` 和 `flush` 完整性摘要 | App 确认结束；Gateway sink 调 API 结算并保存历史 |
| `error` | 错误 | UI 展示 stage/provider/retryable |

### 4.5 事件顺序

正常音频链路：

1. `session.started`
2. 多个 `audio.frame`
3. `transcript.partial` 可选
4. `transcript.final`
5. `translation.delta` 可选
6. `translation.final` 或 `translation.failed`
7. `audio.output` 可选
8. `usage.tick` 每 30 秒可多次出现
9. `session.ended`

端侧文本链路：

1. `session.started`
2. `client.text.segment`
3. `translation.final` 或 `translation.failed`
4. `session.ended`

约束：

- UI 只把 final 作为稳定历史。
- partial/delta 可以覆盖当前草稿，不进入最终导出。
- 同一 `segmentId` 的 final 到达后，后续同 ID final 只能覆盖同一段，不新增段。
- `session.ended` 必须排在尾段 `transcript.final` 与 `translation.final/failed` 之后。
- `flush.status` 为 `completed` 或 `empty` 且 audio/provider 成功、无未解决段时，App 才把结束 flush 视为确认成功。
- `flush.status=degraded` 时仍结束和保存已有原文，但 App 必须提示最后一句未完整确认。

`session.ended.flush` 字段：

| 字段 | 含义 |
| --- | --- |
| `status` | `completed`、`empty` 或 `degraded` |
| `transcriptFinalCount` | 结束窗口内补齐的最终原文数 |
| `translationFinalCount` | 结束窗口内补齐的最终译文数 |
| `translationFailedCount` | 已保留原文但翻译失败的段数 |
| `unresolvedSegmentCount` | 仍只有 final 原文、没有译文或失败结果的段数 |
| `pipelineErrorCount` | 结束窗口内 ASR/provider 等管线错误数 |
| `audioFlushed/providerFlushed` | 两级 flush 是否执行成功 |

## 5. VAD、缓冲、端点和 flush

当前 Gateway 只做音频 batch 和 flush，不做完整 VAD 状态机。发布级策略如下：

| 阶段 | 策略 |
| --- | --- |
| 采集 | App 20ms 至 100ms 一帧，弱网可合并但不超过 200ms |
| 缓冲 | Gateway 批处理上限 800ms，积压超过 2400ms 丢弃旧帧并记录诊断 |
| VAD | 服务端 ASR 使用 MarbleNet v2 主判断，阈值默认 0.5；RMS 仅自动降级，App 端仅做保守静音门控和 TTS 播放门控 |
| 强制切段 | 连续语音超过 6 至 8 秒必须强制 final，防止长句不翻译 |
| silence flush | 静音 600 至 900ms 后 flush 当前段 |
| stop flush | pause/end 前必须 flush pending audio 和 provider |
| 去重 | `segmentId + normalizedText` 去重，短时间重复 final 不重复展示 |

ASR flush 必须继续携带当前 session 的 `sourceLanguage`、`targetLanguage`、`hotwords` 和 `corrections`，保证尾句与实时段使用同一领域词策略。

面对面自动朗读时：

- TTS 播放前先 flush 当前用户话音。
- TTS 播放期间暂停上行或丢弃采集帧。
- 播放结束后延迟 300 至 600ms 恢复 ASR。
- 真机 10 句无自激作为 P0 验收。

## 6. Call Link 数据协议

Call Link 使用 LiveKit 房间和数据通道。

| 项目 | 口径 |
| --- | --- |
| 房间 | `call_{callId}` |
| 数据 topic | `translation.captions` |
| 参与者 | `host`、`guest`、`worker` |
| 字幕事件 | `worker.status`、`transcript.final`、`translation.final`、`tts.ready` |
| 音频轨 | 用户麦克风轨、`translation-tts-{host|guest}-{sampleRate}` 译音轨 |

事件规则：

- Worker 只订阅 `host/guest` 麦克风轨。
- Worker 不得把 `translation-tts-*` 译音轨送回 ASR。
- `transcript.final`、`translation.final`、`tts.ready` 必须先发数据通道，再播放 TTS，避免 TTS 阻塞字幕显示。
- `tts.ready` 表示译音已合成并准备播放，不代表对方一定听到；播放失败必须追加 `worker.status`。
- Web Guest 不支持麦克风时进入仅字幕模式，不创建上行语音。

持久化：

- `transcript.final` 写 `sourceText`。
- `translation.final` 写 `translatedText`。
- `tts.ready` 只写诊断和媒体指标，不保存音频。
- `worker.status` 默认不进入历史正文。

## 7. PSTN/AI Agent 媒体协议

PSTN Bridge 是电话服务商和 Translation Worker 之间的桥。

上行媒体：

1. 服务商发送 `mulaw8k` 或等价电话音频。
2. PSTN Bridge 转为 `pcm16/16000`。
3. 通过 `audioFrameSinkEndpoint` 送入 Translation Worker。
4. Worker 执行 ASR -> 翻译 -> TTS。

下行媒体：

1. Worker 合成 `pcm16` TTS。
2. TTS Audio Sink 发送给 PSTN Bridge。
3. PSTN Bridge 转码为电话侧音频。
4. 服务商播放给目标说话人。

计费边界：

- 告知期必须先播放 AI 身份、录音转写和实时翻译提示。
- 被叫在告知期拒绝或挂断，不计费或全额返还。
- 无人接听、忙线、服务商失败不扣用户实时分钟。
- 接通并通过告知后，按服务商权威通话时长和 Worker 实际处理时长取较保守值结算。

## 8. 计费设计

### 8.1 计费模式

| 场景 | 当前口径 | 发布级口径 |
| --- | --- | --- |
| 端侧同传 | 不扣实时分钟 | 继续免费或仅限制本地功能 |
| 在线同传 | 创建前预留 30 秒，session end 按权威 billable seconds 幂等结算并释放 hold | 按有效在线处理时长扣费，支持 hold 和低余额结束 |
| Call Link | 创建前预留 60 秒，当前复用 session 结算能力 | host 创建方承担计费，Guest 不扣费 |
| PSTN 翻译电话 | 骨架阶段 | 按通话秒 + TTS/ASR/翻译服务成本折算 |
| AI Calling Agent | 骨架阶段 | 按任务执行秒、电话秒和模型 credits 组合计费 |
| Type-to-Speak / OCR | 当前不扣实时分钟 | 后续可按 credits 或套餐次数 |

### 8.2 结算规则

| 规则 | 要求 |
| --- | --- |
| 最小启动余额 | 在线同传至少 30 秒，Call Link/Agent/PSTN 至少 60 秒；active hold 会从 `availableSeconds` 中扣除 |
| <6s 免计费 | 用户误触、告知期失败、服务端启动失败不扣费 |
| 向上取整 | 有效通话按秒向上取整 |
| 最大时长 | token 内 `maxDurationSeconds` 限制单 session |
| 低余额 | Gateway 按 API `availableSeconds + 当前 session holdSeconds` 计算剩余分钟；剩余低于 30 秒通过 `usage.tick.lowBalance` 提示；归零后 capped billable seconds 并 graceful end |
| 幂等 | 同一 sessionId 的 settle 只能成功一次 |
| 失败退款 | provider 失败、PSTN 失败、重复扣费必须可反向 ledger；当前基础 API 已接入，真实服务商失败分类仍需联调 |

### 8.3 Ledger

当前 ledger 字段已有：

| 字段 | 含义 |
| --- | --- |
| `type` | `purchase`、`usage`、`refund` |
| `source` | `system` 或支付 provider |
| `deltaSeconds` | 秒数变化，扣费为负数；系统用量返还为正数，支付退款回滚也可能为负数 |
| `balanceAfter` | 变更后余额 |
| `orderId` | 购买订单 |
| `sessionId` | 用量来源 session |
| `note` | 解释说明 |

发布级扩展：

- 增加 `idempotencyKey`，当前格式为 `settle:{sessionId}`、`refund:{sessionId}`。
- 增加 `currency`：`seconds` 或 `credits`。
- 增加 `businessType`：`realtime`、`call_link`、`pstn`、`agent`、`ocr`。
- 增加 `metadata`：providerCallId、roomName、model、failureReason。

## 9. 数据架构

### 9.1 本地和云端边界

| 数据 | 端侧本地 | 云端 |
| --- | --- | --- |
| 端侧同传历史 | 默认本地保存 | 用户登录并开启云同步后上传 |
| 在线同传历史 | App 本地缓存 + API session | API 为权威副本 |
| Call Link 历史 | Host App 和 API | API 为权威副本 |
| PSTN/Agent 历史 | App 展示摘要 | API 为权威副本 |
| 原始音频 | 默认不保存 | 默认不保存；调试需用户授权和短期留存 |
| TTS 音频 | 不保存 | 不保存，必要时仅保存合成指标 |
| 模型诊断 | 本地最近错误 | API 保存脱敏 stage/provider/model/latency |

### 9.2 数据生命周期

| 操作 | 要求 |
| --- | --- |
| 创建 | session 创建即写入 `created` |
| 追加 | final 事件 upsert segment |
| 结束 | 写 `endedAt`、`consumedSeconds`、settle ledger |
| 摘要 | 用户触发后生成 review，失败可重试 |
| 导出 | 支持 markdown/txt/json/csv |
| 删除 | 本地删除立即生效；云端先软删再异步硬删 |
| 注销 | 删除账号数据、session、billing 可按法规保留必要账务记录 |

### 9.3 隐私和脱敏

- 日志不得输出手机号、地址、API Key、token、完整身份证件号。
- 字幕正文只在 session/history 存储，不进普通运行日志。
- provider 错误可保存 stage/provider/retryable，不保存完整 prompt 和音频。
- Call Link joinUrl、LiveKit token、realtimeToken 均按敏感凭证处理。

## 10. 断线恢复

当前 Gateway 断线后 session 会 close，发布级需要补 resume。

目标策略：

| 场景 | 行为 |
| --- | --- |
| App 短暂断网 < 15 秒 | App 缓冲少量音频，重连后创建 resume 或新 session |
| WSS 断开但 API session 未结束 | App 查询 `/realtime/sessions/{sessionId}/status` |
| token 过期 | App 用 API 换新 token，必须同 userId/sessionId |
| provider 已关闭 | 创建新 provider session，历史沿用原 sessionId |
| 重复 segment | 通过 segmentId upsert 去重 |

P1 最小可接受方案：

- WSS 断开后提示“重试在线 / 切回端侧”。
- 重试失败不丢本地已显示字幕。
- 用户点击结束时仍调用 API end，完成历史保存和幂等结算。

## 11. 错误和诊断

错误事件必须包含：

| 字段 | 用途 |
| --- | --- |
| `code` | 程序判断 |
| `message` | 中文 UI 提示 |
| `stage` | `connection`、`asr`、`translation`、`tts`、`session` |
| `provider` | 具体 provider |
| `retryable` | 是否可重试 |
| `sessionId` | 关联 session |

App 展示规则：

- `retryable=true`：展示“重试在线”和“切回端侧”。
- `retryable=false`：展示原因和下一步，如登录、余额、权限、同意。
- 同一错误短时间内折叠展示，详细信息进入模型链路诊断。

## 12. 发布门禁

### 12.1 自动化门禁

| 门禁 | 要求 |
| --- | --- |
| 协议合同测试 | `audio.frame`、`client.text.segment`、control、server events 均有解析和序列化测试 |
| session sink 测试 | `transcript.final`、`translation.final`、`translation.failed`、`session.ended` 可同步 API |
| 计费幂等测试 | 重复 end、重复 webhook、重复 settle 不重复扣费 |
| ledger 测试 | purchase、usage、refund 顺序和余额正确 |
| Call Link 测试 | data channel 事件持久化，`translation-tts-*` 不回送 ASR |
| PSTN 测试 | provider media -> Worker -> TTS sink -> status webhook 内部闭环 |

### 12.2 真实验收

| 场景 | 验收 |
| --- | --- |
| 在线同传 5 分钟 | 无崩溃、无空译文刷屏、历史完整、余额减少正确 |
| 中英快速切换 20 轮 | 语言方向正确率达到灰度门槛 |
| 弱网断开重连 | 不丢已显示字幕，可继续或优雅结束 |
| Call Link 双端 5 分钟 | Host/Guest 均可看到字幕，对方可听到译音 |
| PSTN 内部闭环 | 告知期不扣费，接通后结算幂等 |
| 删除和导出 | 历史详情可导出，删除后列表和详情不可见 |

## 13. 开发任务

### P0/P1 立即开发

1. 已新增基础 usage settlement 抽象，替换散落的 session end 估算逻辑。
2. 已为 `completeSessionWithUsage` 增加 `<6s` 免计费、`note`、`sessionId` ledger 记录和持久化幂等键。
3. 已增加在线 session 低余额检测、`usage.tick.lowBalance`、`session.ended.reason` 和 graceful end 事件。
4. 已新增 `usage.hold`，覆盖在线同传 30 秒预留、Call Link 60 秒预留、AI Calling Agent start 60 秒预留、`/usage/balance` 的 `heldSeconds/availableSeconds` 和 settle 释放。
5. App 在线模式已展示 `usage.tick.lowBalance` 低余额提示，并可与最新错误摘要同时显示。
6. 已新增系统用量返还原语、`/internal/sessions/:sessionId/refund` 幂等退款接口，并让 Agent `failed` 终态释放预留、不扣余额。
7. 扩展 segment 持久化字段：language、confidence、stage、provider、model、latency。
8. Call Link Web Guest 增加入房同意、仅字幕模式、举报入口和 ICP 占位。

### P2/P3 后续开发

1. PostgreSQL session、segment、usage_event、billing_ledger 表。
2. Redis session resume 和短期音频帧缓冲。
3. credits 双货币、PostgreSQL 账本和运营退款后台。
4. 云同步、软删硬删、个人信息副本导出。
5. OTel trace、SLO 看板、容量压测和等保审计。

## 14. 非目标

- 不保存原始音频作为默认功能。
- 不在 P0/P1 引入 Kafka、ClickHouse、Apollo 或 SPIFFE/mTLS 作为硬依赖。
- 不把 PSTN/AI Agent 的真实商用计费写成已完成。
- 不把端侧同传纳入在线分钟扣费。
- 不把 partial/delta 作为历史最终文本。
