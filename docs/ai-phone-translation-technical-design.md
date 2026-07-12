# AI 翻译电话技术方案

版本：v0.5
日期：2026-07-11
范围：Call Link、WebRTC/VoIP 通话房间、拨打手机号翻译电话、PSTN 服务商桥接、AI Calling Agent。  
关联文档：`docs/ai-communication-feature-design.md`、`docs/ai-communication-ui-design.md`、`docs/ai-phone-translation-protocol-design.md`、`docs/ai-phone-translation-data-ops-design.md`

## 1. 目标

实现三类通话能力：

- Call Link：双方点击链接进入 App/网页通话房间，实时双向翻译。
- 拨打手机号：用户在 App 输入手机号，对方接普通电话，接通后实时翻译。
- AI Calling Agent：AI 代用户打电话预约、查询、联系客服，用户可监听和接管。

非目标：

- 不读取 iOS/Android 原生蜂窝电话音频。
- 不直接监听微信、WhatsApp、Telegram 原生通话音频。
- 不绕过平台权限做后台录音。

## 2. 总体架构

```text
Flutter App / Web Guest
        |
        | WebRTC / HTTPS / WebSocket
        v
API Server ---- Billing / Credits / Records
        |
        v
Call Orchestrator
        |
        +--> LiveKit / WebRTC Room
        |
        +--> PSTN Bridge Adapter
        |       +--> Twilio Media Streams
        |       +--> Telnyx Media Streaming
        |
        +--> Translation Worker
                +--> Speaker Attribution Router
                +--> ASR Provider
                +--> Translation Provider
                +--> TTS Provider
                +--> Summary Provider
```

## 3. 核心组件

| 组件 | 职责 |
| --- | --- |
| Flutter App | 通话 UI、权限、WebRTC 入会、字幕渲染、TTS 播放兜底 |
| Web Guest | 对方免安装加入 Call Link |
| API Server | 鉴权、创建通话、签发 token、用量、记录、导出 |
| Call Orchestrator | 通话状态机、房间管理、PSTN 呼叫、事件分发 |
| LiveKit/WebRTC Layer | App/网页实时音频房间、低延迟传输、音频路由 |
| PSTN Bridge Adapter | 调 Twilio/Telnyx 或国内 PSTN Bridge 拨号，接收/发送电话音频 |
| Translation Worker | VAD、ASR、翻译、TTS、字幕事件、摘要材料 |
| Speaker Attribution Router | 按独立音轨、流式分离或手动模式选择归属来源，并完成时间对齐 |
| Billing Ledger | credits 预扣、结算、失败回滚、成本记录 |
| Session Record Service | 保存 transcript、translation、summary、highlights |

## 4. 技术选型

### 4.1 WebRTC/VoIP 房间

建议优先使用 LiveKit。

原因：

- 支持 Flutter、Web SDK。
- 支持 WebRTC SFU、房间、参与者、音频轨道。
- 可自托管，也可先用云服务做 POC。
- 官方支持 SIP participant，可用于后续和 Twilio/Telnyx SIP trunk 对接。

备选：

- 自建 WebRTC SFU：成本高，不建议 MVP。
- 纯 WebSocket 音频：适合单端录音，不适合浏览器通话房间。

### 4.2 PSTN 服务商桥接

首选 POC 顺序：

1. Twilio：文档成熟，上手快，适合验证。
2. Telnyx：强调 carrier 网络和低延迟，适合成本/质量对比。

关键能力：

- 购买号码。
- 发起出站电话。
- 接收通话状态 webhook。
- 双向媒体流：电话音频发给我们，我们把 TTS 音频送回电话。
- SIP trunk：后续可把电话参与者接进 WebRTC 房间。

## 5. Call Link 数据流

```text
1. 用户创建 Call Link
2. API 创建 call_session 和 LiveKit room
3. API 签发 host token 和 guest token
4. 用户分享链接
5. 对方打开 Web Guest，授权麦克风
6. 双方发布原始音频轨道
7. Translation Worker 订阅双方音频
8. Worker 产生字幕和译文
9. Worker 发布目标语言 TTS 音频轨道
10. App/Web 只播放翻译轨道，原始音频可低音量或默认不播
11. 结束后生成记录和摘要
```

音频路由规则：

- 用户端默认播放“译文 TTS 轨道”。
- 原始对方音频默认静音或低音量，提供设置开关。
- Worker 必须能订阅原始音频。
- 字幕事件走 Realtime Gateway 或 Call Event WebSocket。

## 6. 拨打手机号数据流

```text
1. 用户输入手机号并确认费用
2. API 预扣 credits，创建 call_session
3. App 加入 WebRTC 房间，成为 host participant
4. Call Orchestrator 调 PSTN 服务商拨号
5. 服务商回调 ringing / answered / completed
6. answered 后开启双向 media stream
7. PSTN Bridge 收到对方电话音频
8. Worker 翻译对方音频，TTS 发布给 App
9. Worker 接收 App 音频，翻译后 TTS 送回 PSTN
10. 结束后按真实时长结算 credits，保存记录
```

关键点：

- 用户不离开 App，不调用系统 Phone App。
- 对方不需要安装 App，接普通电话。
- PSTN provider call id 必须入库。
- 拨号前必须展示费用预估和录音/AI 翻译提示。

## 7. AI Calling Agent 数据流

```text
1. 用户填写任务、号码、约束、个人信息
2. Agent Planner 生成通话目标和话术
3. 用户确认后预扣 credits
4. API 将授权任务放入 `queued`
5. Agent Call Worker 拉取队列并提交给 HTTP PSTN Bridge
6. PSTN Bridge 调服务商拨号并回写 provider call id
7. Agent Worker 接电话音频并生成回复
8. 用户 App 看到实时转写、AI 意图和对方回答
9. 用户可点击“接管”
10. 结束后生成结果、摘要、待办
```

Agent 安全门：

- 拨号前用户必须确认。
- Worker 内部队列和状态回写必须带 `INTERNAL_API_SECRET`。
- `PSTN_BRIDGE_BASE_URL` 未配置时不得伪造成功。
- 付款、身份验证、法律/医疗/金融决定必须请求接管。
- Agent 每次敏感操作要记录 reason 和 user_confirmed。

## 8. 音频处理链路

输入格式：

- App/WebRTC：优先 Opus，Worker 内部转 PCM16 16k/24k mono。
- PSTN：通常 8k μ-law 或 provider 指定编码，Bridge 转 PCM16。

处理步骤：

1. Audio frame normalize。
2. 在线模式由 ASR Service 内的 Speech Frontend 重采样至 16kHz。
3. MarbleNet VAD 输出帧级语音概率，Endpoint State Machine 维护前置缓存、静音端点和最大分段。
4. ASR 与 Speaker Attribution 并行处理，二者使用统一客户端音频时间轴。
5. SpeechTurnCoordinator 确认 speaker 变化后在音频时间轴切分 turn；不同 speaker 的文本禁止合并。
6. 自动语种识别和翻译方向选择。
7. 术语纠错和翻译。
8. TTS streaming、Jitter buffer 和目标端播放。

### 8.1 VAD 总体设计

在线链路以服务器端 VAD 为权威判断，端侧门控不得提前丢弃低音量语音：

```text
App PCM16
  -> Gateway 排序、批处理和重连
  -> ASR Service Speech Frontend
       -> PCM16 16kHz normalize
       -> MarbleNet ONNX VAD
       -> Endpoint State Machine
       -> Qwen3-ASR
  -> transcript.final
```

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| App | 麦克风、AudioSession、保守静音门控、TTS playback gate、AEC | 不做在线链路的权威端点判断 |
| Gateway | 帧排序、批处理、重连、flush、session 生命周期 | 不执行神经 VAD 推理 |
| ASR Service | 重采样、MarbleNet、前置缓存、端点、最大分段、RMS 降级 | 不处理 TTS 播放回声策略 |
| Speaker Provider | 输出独立 speaker spans | 不直接执行 ASR；稳定边界由 Gateway Coordinator 提交给 ASR Service |

生产基线：

- 主模型：`nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0`。
- 运行方式：ASR 进程内 ONNX CPU；NeMo 只在部署阶段导出网络和固定 Mel 预处理资产。
- 默认阈值：`0.5`；`0.7` 仅作为严格噪声档 A/B 候选，不直接替换生产阈值。
- 滚动上下文：`1000ms`；当前批次使用连续 3 帧平滑，避免单帧噪声尖峰。
- 降级：模型资产缺失、加载或推理失败时切换 RMS，ASR 不因 VAD 故障中断。
- 当前状态：服务器 VAD 已通过真机测试并标记 `accepted`；端侧 MarbleNet 仍为候选评测，不进入生产 App。

VAD 只能区分语音和非语音，不能识别设备自身 TTS。扬声器自动朗读仍必须由 `AudioSessionCoordinator + playback gate + AEC` 处理。

### 8.2 端点配置

| 模式 | 默认静音端点 | 前置缓存 | 最大分段 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 面对面对话 | 700-900ms | 400ms | 8s | 优先响应速度 |
| 聆听/会议 | 1000-1200ms | 400ms | 10s | 优先长句完整性 |
| Call Link | 600-900ms | 300ms | 8s | 配合独立 participant track |
| PSTN | 500-800ms | 300ms | 8s | 兼容 8kHz 电话音频 |

当前生产 Qwen3-ASR 仍使用 `1100ms` 端点作为统一安全基线。代码已支持按 session 冻结 `conversation/listening/call_link/pstn` 四种策略，并分别配置 900/1400/900/1100ms；统一验收完成前不部署到生产，避免一次上线同时改变模型和断句策略。

### 8.3 多说话人和混合语种

- conversation、meeting、classroom 和 business 均按多人场景设计，不限定为2个说话人。
- 单麦克风 Streaming Sortformer 当前最多输出4个稳定匿名槽位，因此 App、API 和模型服务默认 `maxSpeakers=4`。
- Call Link/PSTN 使用 participant track，按房间真实参与者区分，不受单麦克风4人限制。
- VAD 决定语音生命周期；确认的 speaker 变化决定 turn；语义完整决定软分句。
- 语种变化只决定 `dominantLanguage` 和翻译方向，不是硬断点。中文夹英文、英文夹中文、姓名、品牌、型号和字母串保持同一 speaker turn。
- 快速抢话通过 `SpeechTurnCoordinator + ASR Turn Buffer` 在 `boundaryMs` 回切 PCM，不能等 ASR 输出后再给整段选择一个主 speaker。
- ASR Service 内部边界提交只结束 speaker turn，不重置 MarbleNet VAD；边界前后 PCM 均保留在同一 session 时间轴。
- 单麦克风重叠语音实时阶段只翻译主 speaker 并标记 overlap；独立 participant track 可并行翻译每一路。

说话人归属规则：

- Call Link/PSTN 使用 participant track，角色为 host/guest/agent，不运行 diarization。
- 面对面单麦克风使用流式 diarization，输出匿名 `speaker_1..4`。
- 声音身份必须取得单独授权；未授权或低置信度时只显示匿名说话人。
- LLM 只使用既有 speaker 标签整理纪要，禁止根据文本内容猜身份。
- 详细接口、数据模型和降级规则见 `docs/ai-phone-speaker-attribution-design.md`。

延迟目标：

| 阶段 | 目标 |
| --- | --- |
| VAD 首次确认 | 60-200ms |
| VAD endpoint | 600-1200ms，按模式配置 |
| ASR partial | 300-800ms |
| 翻译 | 300-1200ms |
| TTS 首包 | 300-1000ms |
| 端到端可感知延迟 | 2-5s |

## 9. 模型 Provider 策略

| 能力 | 国内版生产基线 | P2/P3 |
| --- | --- | --- |
| VAD | 在线 MarbleNet v2；端侧现有端点检测 | MarbleNet CoreML/Android ONNX 候选 |
| ASR | iOS CoreML/Nemotron；在线 Qwen3-ASR-0.6B tuned v3 | FireRedASR2、云 streaming ASR 备选 |
| 翻译 | iOS 系统翻译；在线 Hy-MT2-1.8B | 国际 Provider 和原生 S2S 路由 |
| TTS | iOS 系统 TTS；在线 VoxCPM2 | 低延迟流式 TTS、授权自定义语音 |
| 纠错/摘要 | Qwen3.5-9B no-thinking | 成本路由、企业私有模型 |

原则：

- Provider Router 保留。
- 电话实时场景优先选择低延迟流式 Provider。
- 摘要和重点提取可异步，不能阻塞通话结束。

## 10. Credits 和成本控制

拨号前：

- 校验用户订阅状态。
- 预扣最低 3-5 分钟 credits。
- 展示预估费用。

通话中：

- 每 15 秒写入 usage heartbeat。
- 余额不足 60 秒时提示。
- 余额耗尽前自动提醒并结束。

结束后：

- 按实际秒数结算。
- 失败/未接听退回预扣。
- 保存 provider 成本、模型成本、credits 消耗。

建议计费：

- Call Link：低 credits 或 Pro 包含一定分钟。
- 拨打手机号：2-5 credits / 分钟。
- AI Agent：3-8 credits / 分钟。

## 11. 合规与隐私

必须做：

- 通话前展示 AI 翻译、转写、可能保存记录的提示。
- 按地区配置录音/转写 consent 文案。
- 默认不保存原始音频，只保存文本记录。
- 用户可删除通话记录。
- 电话号码加密存储或脱敏展示。
- Webhook 必须验证签名。

地区策略：

- 美国/加拿大先做。
- 双方同意录音地区必须明确提示。
- 中国大陆 PSTN 不进入首发范围。

## 12. 失败处理

| 场景 | 处理 |
| --- | --- |
| 对方未接 | 标记 no_answer，退回 credits |
| 忙线 | 标记 busy，可一键重拨 |
| 号码无效 | 前端校验 + provider 错误提示 |
| WebRTC 断开 | 尝试重连，保留房间 60 秒 |
| PSTN media stream 断开 | 结束电话并保存已完成片段 |
| ASR 失败 | 降级到备用 ASR 或提示 |
| TTS 失败 | 继续字幕，关闭语音播放 |
| 翻译超时 | 显示原文，后台补译 |

## 13. 推荐落地顺序

1. Call domain 数据模型和 API。
2. LiveKit POC：App 和 Web Guest 加入同一房间。
3. Translation Worker 订阅音频并输出字幕。
4. TTS 轨道回放。
5. Call Link 产品闭环：创建、分享、加入、结束、历史。
6. Twilio outbound + bidirectional Media Streams POC。
7. Telnyx 对比 POC。
8. PSTN 拨号页和 credits 预扣。
9. 电话双向翻译闭环。
10. AI Calling Agent。

## 14. POC 验收

Call Link POC：

- 两台手机或手机 + 浏览器可通话。
- 双方字幕和译文出现。
- 可结束并保存记录。

PSTN POC：

- App 输入美国/加拿大手机号。
- 对方接普通电话。
- 对方说英文，App 看到中文字幕。
- 用户说中文，对方听到英文 TTS。
- 10 分钟内不掉线。
- 历史记录包含 provider call id、时长、费用。

## 15. 官方资料

- Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams
- Twilio Media Stream messages: https://www.twilio.com/docs/voice/media-streams/websocket-messages
- Twilio Voice pricing: https://www.twilio.com/en-us/voice/pricing/us
- Telnyx Media Streaming: https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming
- Telnyx Voice API: https://telnyx.com/products/voice-api
- Telnyx Voice pricing: https://telnyx.com/pricing/voice-api
- LiveKit Telephony: https://docs.livekit.io/telephony/
- LiveKit outbound SIP calls: https://docs.livekit.io/telephony/making-calls/outbound-calls/
- LiveKit self-hosting: https://docs.livekit.io/transport/self-hosting/
