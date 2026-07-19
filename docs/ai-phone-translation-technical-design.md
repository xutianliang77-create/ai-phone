# AI 翻译电话技术方案

版本：v0.7
日期：2026-07-14
范围：Call Link、WebRTC/VoIP 通话房间、拨打手机号翻译电话、PSTN 服务商桥接、AI Calling Agent。  
关联文档：`docs/ai-communication-feature-design.md`、`docs/ai-communication-ui-design.md`、`docs/ai-phone-translation-protocol-design.md`、`docs/ai-phone-translation-data-ops-design.md`

统一架构基线：`docs/architecture/README.md`。本文件继续描述翻译电话专项，
统一 session、Agent Runtime、LiveKit 安全和容量设计以架构目录为准。

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
                +--> Speech Turn Coordinator
                +--> ASR Provider
                +--> Translation Provider
                +--> TTS Provider
                +--> Playback / Interruption Controller
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
| Speech Turn Coordinator | 按 participant、VAD 和 speaker 边界形成稳定 turn，禁止跨人合并 |
| Playback / Interruption Controller | 按目标通话腿排队、播放、取消 TTS，并处理抢话和降级 |
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
2. API 创建唯一 translation_session、host/guest call legs 和 LiveKit room
3. API 签发 host token 和 guest token
4. 用户分享链接
5. 对方打开 Web Guest，授权麦克风
6. 双方发布原始音频轨道
7. Translation Worker 按 participant track 订阅双方音频，每条 source leg 独立进入 ASR/翻译队列
8. Worker 产生带 sourceLegId/targetLegId 的字幕和译文
9. Worker 为目标 leg 创建可取消 playback，发布目标语言 TTS 音频轨道
10. App/Web 只播放翻译轨道，原始音频可低音量或默认不播
11. 结束后生成记录和摘要
```

音频路由规则：

- 用户端默认播放“译文 TTS 轨道”。
- 原始对方音频默认静音或低音量，提供设置开关。
- Worker 必须能订阅原始音频。
- 字幕事件走 Realtime Gateway 或 Call Event WebSocket。
- Call Link 不运行单麦克风 diarization；host/guest 身份只来自独立 participant track。
- 双向翻译队列互相独立；一侧 TTS 阻塞或取消不得阻塞另一侧 ASR、翻译和播放。

## 6. 拨打手机号数据流

```text
1. 用户输入手机号并确认费用
2. API 预扣 credits，创建 call_session
3. App 加入 WebRTC 房间，成为 host participant
4. Call Orchestrator 调 PSTN 服务商拨号
5. 服务商回调 ringing / answered / completed
6. answered 后开启双向 media stream
7. PSTN Bridge 收到对方电话音频
8. Worker 翻译对方音频，建立 callee -> host playback 并发布给 App
9. Worker 接收 App 音频，建立 host -> callee playback 并送回 PSTN
10. 结束后按真实时长结算 credits，保存记录
```

关键点：

- 用户不离开 App，不调用系统 Phone App。
- 对方不需要安装 App，接普通电话。
- PSTN provider call id 必须入库。
- 拨号前必须展示费用预估和录音/AI 翻译提示。
- Provider 必须声明 `bidirectionalMedia`、`streamingWrite` 和 `clearPlayback` 能力；缺少清除播放能力时只能使用半双工或纯字幕降级，不能宣称支持实时抢话。

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

### 7.1 产品化能力集成

本阶段的 Agent、声音克隆、授权声纹和扫描翻译都复用现有 Provider、账号和会话边界，不另建客户端直连模型链路。

| 能力 | 主链路 | 安全和降级边界 |
| --- | --- | --- |
| Agent 灰度 | 草稿 -> 明示告知 -> 用户授权 -> 灰度策略 -> 原子预扣 -> PSTN 队列 | 白名单、紧急/禁拨号码、小时频控和高风险接管均在 API 事务内复核；客户端预检不作为权威 |
| Hi-Fi 声音克隆 | PCM16 WAV 质量分析 -> Voice Profile -> VoxCPM2 `hifi` -> 48k 模型输出重采样为24k协议音频 | 不合格录音不可置为 ready；提示词不拼入朗读正文；Provider 失败继续字幕 |
| 授权声纹 | 显式同意 -> 注册参考音频 -> Speaker Provider embedding -> 账号内匹配 -> 低置信度匿名 | embedding 只存模型服务引用，不回传 App、不进入字幕/LLM/导出；撤回立即停止命中，远端删除失败由周期补偿收敛 |
| 扫描翻译 | 系统 OCR block -> 逐块翻译 -> 原图坐标叠加 -> 原译逐块对照 -> 保存/分享 | OCR 坐标使用左上原点归一化值；无坐标时只做整段半透明叠加，不猜测文本位置 |

扫描页以原图作为空间真值。iOS Vision 的左下原点坐标在原生桥接层转换为左上原点；Android ML Kit 的像素矩形在桥接层按图片宽高归一化。Flutter 不重新推断版面，只按 `left/top/width/height` 回贴译文，从而保持菜单、表格、票据和文档的可对照性。

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

### 8.4 统一语音时间轴

每个 final segment 使用同一组不可变语音证据：

- `timing.startMs/endMs`：ASR 实际消费的 speech 区间；speaker 对齐、字幕排序、历史和 review 均复用该区间。
- `speaker`：只来自 participant track 或 diarization 对齐，不由 LLM 猜测。
- `vadContext.endpointReason`：`silence/max_duration/flush/speaker_boundary`。
- `vadContext.vadModelFingerprint`：服务器 VAD 模型文件 SHA-256；RMS 主动模式或模型资产不存在时可缺省。
- `vadContext.endpointPolicyFingerprint`：该 session 首帧冻结的端点策略 SHA-256。

Gateway 将段级上下文随 transcript/translation 一起写入 API；App 本地 outbox、历史模型、Markdown/CSV 导出和 LLM review 保留相同字段。数据库不保存 PCM、20ms 概率数组或声音身份特征。

延迟目标：

| 阶段 | 目标 |
| --- | --- |
| VAD 首次确认 | 60-200ms |
| VAD endpoint | 600-1200ms，按模式配置 |
| ASR partial | 300-800ms |
| 翻译 | 300-1200ms |
| TTS 首包 | 300-1000ms |
| 端到端可感知延迟 | 2-5s |

### 8.5 全双工播放与抢话架构

目标是让 Call Link、VoIP 和具备媒体清除能力的 PSTN 通话接近自然电话：TTS 播放期间继续采集双方语音，用户开口后只中断其即将听到的译音，不停止另一方向的识别、翻译或播放。

```text
capture call leg
  -> capture + 300-500ms pre-roll
  -> AEC(reference = exact playback PCM sent to this same leg)
  -> MarbleNet VAD
  -> SpeechTurnCoordinator
  -> ASR -> conservative correction -> ordered translation
  -> target call leg playback queue
  -> TTS stream -> playback sink

the same call leg capture while receiving translated playback
  -> InterruptionController
       -> barge_in.detected
       -> cancel target playback generation
       -> preserve pre-roll and continue ASR
```

核心约束：

- `translation_session` 是唯一会话聚合，Call Link 的 `callId` 与 `sessionId` 使用同一 ID；不得再维护只存在内存的平行通话真值。
- 每位参与者、PSTN 媒体流或 Agent 使用一个 `call_leg`。ASR/翻译队列按 `sourceLegId` 隔离，TTS 队列和取消按 `targetLegId` 隔离。
- 每次译音创建独立 `playbackId` 和单调递增 `generation`。播放状态为 `queued -> streaming -> completed`，中断进入 `interrupting -> interrupted`，异常进入 `failed`。
- 取消必须同时停止 TTS 生成、丢弃未发送帧、调用 LiveKit/PSTN sink 的 stop/clear，并拒绝旧 generation 的迟到音频。
- InterruptionController 只在 AEC 后语音满足 VAD 连续时长、能量和置信度门槛时触发；单个噪声尖峰、键盘声和播放回声不能触发抢话。
- 抢话后的 ASR 使用 300-500ms pre-roll，避免丢失首音节；中断事件不直接结束当前 session，也不触发结算。
- 同一 target leg 同时只允许一个 active playback；不同 target leg 可并行，不能用 callId 作为全房间单队列键。
- 纯 TTS 播放、字幕写入、playback 状态和 usage 事件均通过幂等事件写入；音频 PCM、AEC reference 和 VAD 帧仅保存在 Worker 环形缓冲，不落库。

模式策略：

| 场景 | 生产策略 | 降级策略 |
| --- | --- | --- |
| LiveKit App/Web + 耳机 | AEC 全双工，允许抢话 | AEC 异常时切半双工并提示 |
| LiveKit App/Web + 扬声器 | AEC + exact TTS reference + playback generation | 回声置信度异常时暂停本 leg 播放期间的识别，不影响另一 leg |
| PSTN 支持 clear/stop | 双向媒体 + provider clear，允许抢话 | clear 失败时终止旧 generation 并切半双工 |
| PSTN 不支持 clear/stop | 不开启全双工抢话 | 半双工或纯字幕 |

首期不使用 LLM 判定抢话。LLM 只处理已经确认的 ASR 文本，不能参与 300ms 级音频中断控制。

当前实现边界（2026-07-14）：

- `CALL_FULL_DUPLEX_ENABLED=false` 为安全默认值；API token 和 Worker 使用同一发布环境开关，未灰度客户端继续执行半双工采集保护。
- iPhone 与 Web 由 WebRTC 音频栈启用 echo cancellation、noise suppression 和 auto gain control；Worker 不自行用 RMS 或文本相似度冒充抢话检测。
- ASR Service 在每个音频帧响应头返回 MarbleNet voiced/probability/provider/pre-roll；HTTP ASR Provider 只把同 call、同 speaker、单调 sequence 的结果送入 `CallInterruptionController`。
- 控制器确认抢话后只推进当前 target route epoch、Abort 当前 generation 并调用 LiveKit `AudioSource.clearQueue()`；另一 target leg 保持并行。LiveKit sink 在每帧写入前后校验 generation，clear 完成后不再接受旧代次帧。
- VAD fallback、概率缺失、pre-roll 不足或 playback clear 失败立即发布 `pipeline.degraded`；App/Web 切回 TTS 期间暂停采集。健康链路恢复后发布 `pipeline.restored`，但不重放旧 PCM。
- PSTN 的能力合同已经具备，但 Mock、HTTP 和 Fonoster adapter 当前均声明 `clearPlayback=false`。在真实服务商提供并验证 clear/stop 前，PSTN 只能半双工或纯字幕。

## 9. 模型 Provider 策略

| 能力 | 国内版生产基线 | P2/P3 |
| --- | --- | --- |
| VAD | 在线 MarbleNet v2；端侧现有端点检测 | MarbleNet CoreML/Android ONNX 候选 |
| ASR | iOS CoreML/Nemotron；在线 Qwen3-ASR-0.6B tuned v3 | FireRedASR2、云 streaming ASR 备选 |
| 翻译 | iOS 系统翻译；在线 Hy-MT2-1.8B；通话默认级联 pipeline | 原生 S2S 已具备 `cascade/native/shadow` Provider 路由，国际 Provider 评测通过后注入 |
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
| AEC 不可用或回声升高 | 当前 leg 降级半双工，另一方向保持运行并记录 `pipeline.degraded` |
| playback cancel/clear 失败 | 提升 generation、丢弃迟到帧，PSTN 切半双工并告警 |
| Worker 重启 | 从持久化 session/call legs/playback 终态恢复；未确认 playback 标记 interrupted，不自动重放旧语音 |
| 翻译超时 | 显示原文，后台补译 |

## 13. 推荐落地顺序

1. 数据基础：统一 translation_session、call legs、事务、inbox/outbox、幂等和重启恢复，不改变现有半双工行为。
2. 播放域：playbackId/generation、按 target leg 队列、stop/clear 合同和事件协议。
3. LiveKit 全双工：AEC、TTS reference、pre-roll 和 InterruptionController，先以 feature flag 灰度。
4. 故障恢复：API/Worker 重启、重复事件、迟到音频和降级收敛。
5. Call Link 产品闭环：创建、分享、自动 Worker 入房、结束、历史和质量报告。
6. PSTN Provider 能力适配：先验证 bidirectional media、streaming write、clear playback。
7. 真实 PSTN 双向翻译和 credits 闭环。
8. AI Calling Agent 复用同一 call leg/playback/settlement 模型。

## 14. POC 验收

Call Link POC：

- 两台手机或手机 + 浏览器可通话。
- 双方字幕和译文出现。
- 双方同时说话时两条方向独立，不互相取消。
- 一方在译音播放中开口，目标端播放 P95 300ms 内停止，首音节无明显丢失。
- 连续 30 分钟仅播放 TTS 时不得产生回声字幕或误抢话。
- 可结束并保存记录。

PSTN POC：

- App 输入美国/加拿大手机号。
- 对方接普通电话。
- 对方说英文，App 看到中文字幕。
- 用户说中文，对方听到英文 TTS。
- Provider 支持 clear 时，抢话 P95 300ms 内停止旧译音；不支持时明确进入半双工。
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
