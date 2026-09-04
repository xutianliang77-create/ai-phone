# Qwen Audio Agent 差距补齐采用方案

版本：v1.2
日期：2026-07-30
状态：P0_P1_P2_SOURCE_COMPLETE_AUTOMATED_PASS_FLAG_OFF_DEPLOYED（全部默认关闭）

## 1. 结论

无界AI不引入第二套实时网关，也不以融合音频模型替换现有 LiveKit、独立
ASR/MT/TTS 和 Translation Worker 主线。

本方案只补两个当前缺失的能力层：

1. **实时前台之外的持久后台工作通道**：实时翻译、字幕和直接回复继续走现有
   低延迟前台；耗时工具任务通过有界命令快速受理，在后台持久执行。
2. **后台结果的可靠播报协调层**：结果生成完成后，必须等到安全播报窗口，
   并以目标客户端真实上报的播放开始/结束回执确认交付。

采用依据固定为 `QwenAudio/qwen-audio-agent` commit
`0480d00e2f79ce945d333010f800592903379e5b`、package `0.10.0`、
Apache-2.0。2026-08-13 已按批准方案完成 P0/P1/P2 源码、测试源码、自动化回归、
PostgreSQL 迁移和 flag-off 单容器部署。全部新增运行能力仍默认关闭；分层启用、客户端真实
播放回执、音频和故障矩阵现场验收继续后置。

上游参考：

- [架构文档](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/docs/architecture.md)
- [实时网关](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/server/src/voice/realtime-gateway.mjs)
- [播报窗口](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/server/src/voice/announcement/announcement-window.mjs)
- [播报管理器](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/server/src/voice/announcement/announcement-manager.mjs)
- [任务管理器](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/server/src/task/task-manager.mjs)
- [请求安全](https://github.com/QwenAudio/qwen-audio-agent/blob/0480d00e2f79ce945d333010f800592903379e5b/server/src/core/request-security.mjs)

## 2. 必须保护的现有优势

| 无界AI现有能力 | 当前依据 | 方案约束 |
| --- | --- | --- |
| LiveKit 媒体与独立 AgentSession | `services/voice-agent-runtime` | 不替换、不另建 realtime gateway |
| Translation 与 Agent 两个编排器 | `services/translation-worker`、`services/voice-agent-runtime` | 翻译热路径不强制进入 LLM |
| 自适应打断、接管和 barge-in | AgentSession 与 call-room events | 沿用现有状态和事件语义 |
| 按目标 leg 的 playback generation | Translation Worker TTS sink | 不改成 owner 级全局播放锁 |
| playback 生命周期事件 | `packages/contracts/src/call-room/events.ts` | 保留服务端播放事件，只新增客户端回执 |
| PostgreSQL outbox 租约、退避和死信 | API storage repositories | 复用可靠事件能力，不把 outbox 当任务数据库 |
| 有界音频、控制和 TTS 队列 | Realtime Gateway | 补门禁，不重写已有背压实现 |

## 3. 差距与决策

| 上游模式 | 无界AI当前状态 | 决策 |
| --- | --- | --- |
| 实时前台快速提交后台任务 | Agent 工具主要随当前 Agent turn 执行 | **采用并调整**：增加持久 Work lane，前台翻译不等待 |
| queued 到 completed 的明确任务状态机 | 已有 AgentRun，但缺少通用后台 Work 生命周期 | **采用并调整**：新增 Work，不重命名 AgentRun |
| submissionKey、优先级、并发和确认式取消 | 现有可靠命令能力可复用，语音后台任务未统一 | **采用并调整** |
| claim/lease 和有限重试的通知交付 | 已有 outbox；缺少独立播报交付 ledger | **采用并调整**：outbox 传事件，ledger 管交付状态 |
| AnnouncementWindow | 缺少翻译优先的统一后台播报门 | **采用**：翻译绝对优先 |
| turnId + generation + itemId 失效 | 已有 turn、segment 和多类 generation | **采用语义，调整命名**：禁止新增裸 `generation` |
| 客户端 playback.started/ended 后确认交付 | 当前事件主要代表服务端 sink/源播放 | **采用并兼容**：新增客户端回执，不改旧事件含义 |
| 音频缓冲上限、watchdog、重连退避 | 已有上限；部分恢复策略仍可加强 | **增量采用** |
| Host/Origin、防 DNS rebinding、maxPayload | 已有 Origin、限流和 maxPayload | **补缺**：增加 Host 绑定和缺失 Origin 策略 |
| owner 级唯一 voice client | 不适合多 leg 通讯 session | **拒绝原样采用** |
| DashScope/Qwen 单 Provider | 与可路由 ASR/MT/TTS 主线冲突 | **拒绝** |
| 重启后 active job 直接失败 | 与持久任务恢复目标冲突 | **拒绝** |

## 4. 目标架构

```text
LiveKit / SIP / App audio
          |
现有 Speech Runtime
    |                 |
Translation Runtime   Voice Agent Runtime
    |                 |
字幕 / 实时译音        直接回答 / bounded work commands
    |                                  |
    |                     Durable Work Control
    |                     PostgreSQL + durable queue
    |                                  |
    |                        Background Agent Runner
    |                                  |
    |                           Work Result Outbox
    |                                  |
    +------------> Delivery Coordinator
                         |
                 AnnouncementWindow
                         |
                   现有 TTS/Playback
                         |
                  client playback receipts
```

优先级固定为：

```text
实时翻译字幕/译音
  > 当前轮直接 Agent 回复
  > 权限确认提示
  > 后台工作结果播报
```

后台工作拥塞、失败或恢复不得阻塞 Translation Runtime，也不得改变现有 ASR、MT、
TTS 路由和 session 内冻结的 Model Profile。

## 5. ID 与 generation 兼容

### 5.1 主关联键

| 语义名称 | 无界AI采用方式 |
| --- | --- |
| `communicationSessionId` | 架构语义名称；现行 v1 wire/storage 继续使用 `sessionId`，不创建第二个 ID |
| `legId` | 保持现有媒体腿语义 |
| `turnId` | 保持现有语音轮次语义 |
| `segmentId` | 保持现有字幕/翻译修订单位 |
| `workId` | 新增后台工作主键 |
| `playbackId` | 保持现有一次播放主键 |
| `deliveryAttemptId` | 新增一次后台结果交付尝试 |
| provider `itemId` | 只可映射为 adapter-local `providerItemId`，不得成为业务主键 |

### 5.2 generation

禁止新增含义不明的裸 `generation`。新合同必须使用：

- `turnGeneration`：打断、快速语言切换或重新开启当前 turn 后的失效代次。
- `playbackGeneration`：目标 leg 播放队列的失效代次。
- `dispatchGeneration`：Agent/Worker dispatch 接管代次。

现有 v1 playback DTO 的 `generation` 保持兼容，由 adapter 映射为
`playbackGeneration`；不做破坏性重命名。

所有消费者必须拒绝：

- 已失效的 `turnGeneration`。
- 不等于目标 leg 当前值的 `playbackGeneration`。
- 已过期的 claim lease。
- 已被更新 dispatch 取代的 `dispatchGeneration`。

## 6. 后台 Work 状态机

持久状态：

```text
queued -> running -> delegated -> finalizing -> completed
   |         |           |             |
   +---------+-----------+-------------+-> failed

queued/running/delegated/finalizing
   -> cancelling -> cancelled / failed
```

规则：

- `agent.work.accepted` 是命令已通过校验并入队的接收事件，不作为第二个持久状态。
- `submissionKey` 在同一 `sessionId + actor + tool` 范围内幂等。
- owner 并发、任务优先级、最大运行时间、取消 deadline 和重试次数有硬上限。
- `cancel` 先进入 `cancelling`；只有 runner/下游确认或 deadline 收敛后进入终态。
- 进程重启后从 PostgreSQL/队列恢复未终态 Work；禁止批量直接标记 failed。
- Work 完成只表示结果已生成，不表示用户已听到。

## 7. 交付状态机与播放回执

后台结果每次交付尝试使用：

```text
generated -> claimed -> queued_for_playback
          -> playback_started -> playback_ended
```

任一非终态可收敛为：

```text
cancelled / failed / expired
```

约束：

- `generated` 与 `playback_ended` 分开持久化。
- claim 使用 lease、有限重试和指数退避；过期 lease 可被重新 claim。
- 当前尝试被用户打断时，写入
  `cancelled(reason=user_interruption)`；如策略允许重播，创建新的
  `deliveryAttemptId`，不把原行倒退到 `generated`。
- 现有 `playback.queued/started/interrupted/ended/failed` 保持服务端
  sink/LiveKit source 语义。
- 新增 `client.playback.started`、`client.playback.ended` 和必要的
  `client.playback.failed` 回执，携带 `sessionId`、`legId`、`playbackId`、
  `deliveryAttemptId`、`turnGeneration`、`playbackGeneration` 和
  `clientInstanceId`。
- 只有可信目标客户端的 `client.playback.ended` 才把后台结果标记为已交付。
  captions-only 或无音频产品路径必须定义独立的可见交付回执，不能伪造播放完成。

## 8. AnnouncementWindow

后台结果只有同时满足以下条件才可排入现有播放链：

- 用户当前没有说话。
- 当前前台回复没有处于生成、排队或播放状态。
- 目标 leg 没有翻译 TTS 排队、播放或 clear 未收敛。
- 目标 leg 在线且不是 degraded。
- Work 绑定的 `turnGeneration` 仍有效。
- 当前 session 没有接管、转接、结束或更高优先级权限确认。

窗口关闭时只延迟后台播报，不暂停翻译、不抢占用户发言。窗口重新打开后由
Delivery Coordinator 重新 claim；超过有效期则标记 `expired` 并保留可查看文本。

## 9. 工具与权限边界

实时前台只暴露有界控制工具：

- `agent.work.create`
- `agent.work.cancel`
- `agent.work.status`
- current time
- memory read/write
- permission request/status

复杂业务工具只在后台 Agent/Tool Gateway 可见。创建 Work 时必须持久化：

- 当前 turn 的明确用户指令证据。
- `consentSnapshotId` 或等价授权快照。
- tool schema/policy 版本。
- 参数 hash、风险级别和允许的副作用范围。

模型不能通过对话常识自行推定联系人、支付、账户变更或其他敏感权限。现有 L0-L3
风险和 AgentRun/ToolExecution 审计保持权威。

## 10. Voice ownership 与安全

voice ownership 使用：

```text
sessionId + legId + clientInstanceId
```

同一 leg 在一个时刻只有一个主动 voice client；takeover 必须有 generation、lease、
确认和旧 owner 失效。禁止复制 owner/账号级全局锁，以免不同通话或不同 leg 互相阻塞。

Realtime Gateway 增量安全项：

- Host 与 Origin 同时校验，防 DNS rebinding；缺失 Origin 只能走明确的受信非浏览器路径。
- 保持现有 WebSocket max payload、帧率、连接数、音频时长和控制队列上限。
- Agent-only response-start watchdog 默认设计值 12 秒，超时只取消 Agent 回复，
  不结束 Translation Runtime。
- 重连使用有上限的指数退避和 jitter；连接稳定达到阈值后才重置退避。
- 待发送音频按时长和 chunk 数双重限制，溢出必须结构化上报。

## 11. 采用、调整与拒绝清单

### 11.1 直接采用

- 实时前台和持久后台工作双通道。
- 有界实时工具面。
- Work 明确状态机、幂等提交和确认式取消。
- 结果生成与实际交付分离。
- claim/lease、有限重试和退避。
- AnnouncementWindow。
- 打断时清播放并取消当前回复。

### 11.2 按无界AI调整

- 复用现有 `sessionId/legId/turnId/segmentId/playbackId`，只新增 `workId`
  和 `deliveryAttemptId`。
- 所有 generation 使用作用域明确的名称。
- PostgreSQL 保存 Work 和 delivery ledger；现有 outbox 只承担可靠事件发布。
- 客户端播放回执作为现有服务端 playback lifecycle 的补充。
- voice ownership 缩小到 `sessionId + legId + clientInstanceId`。
- Qwen Audio Realtime 只可作为 `agent_audio_realtime` 可选 Provider。

### 11.3 明确拒绝

- 第二套 realtime gateway。
- 用 Qwen/DashScope 单一 Provider 替换可观测、可路由的 VAD/ASR/MT/TTS。
- 把 LLM 放入每句翻译热路径。
- JSON TaskStore 或单机内存队列作为生产真值。
- owner/账号级全局 voice 锁。
- 浏览器 Float32 线性重采样加 PCM16 Base64 作为新媒体主链。
- 重启后把全部 active Work 直接标记 failed。
- 改写现有 AgentRun、playback 事件或 Translation Runtime 的已验收语义。

## 12. 实施任务与顺序

本节方案已经批准、完成源码实施并通过本地自动化；该状态不代表真实迁移、部署、灰度或现场音频通过。

### P0：不改变现有功能的兼容底座

1. `ARC-VOICE-WORK-001`：补充 `workId`、作用域 generation、失效规则和
   Node/Flutter golden fixtures。
2. `ARC-VOICE-DELIVERY-001`：设计 delivery ledger、客户端播放回执和
   服务端/客户端播放语义映射。
3. `ARC-VOICE-WINDOW-001`：实现独立 AnnouncementWindow 策略和优先级测试。
4. `ARC-VOICE-RELIABILITY-001`：补 Host/Origin、稳定重连退避、
   Agent-only watchdog 和待发音频时长门。

2026-08-28 实现状态：以上四项均为 `SOURCE_AUTOMATION_PASS / DEPLOYMENT_PENDING`。对应主要工件为：

- `packages/contracts/src/communication/voice-work.ts`、
  `client-playback-receipts.ts` 和 Node/Flutter/Python fixtures；
- `services/api-server/src/modules/agent-calls/agent-delivery-ledger.ts`；
- `services/voice-agent-runtime/src/announcement-window.ts`；
- `services/realtime-gateway/src/security/realtime-gateway-protection.ts`；
- `apps/mobile/.../realtime_reconnect_backoff.dart`；
- `services/voice-agent-runtime/src/agent-response-start-watchdog.ts` 和
  `livekit-target-audio-output.ts`。

边界保持不变：服务端 `playback.*` 不代表设备已播放；只有精确目标客户端在收到定向
lifecycle、确认绑定 Worker 音轨已订阅且未静音，并按顺序上报
`client.playback.started -> ended` 后才完成 delivery。真机扬声器实际可听仍属于后置现场验收，
不能由源码状态替代。watchdog 只 interrupt 当前 Voice Agent 回复，不挂断通话、不停止
Translation Runtime。P1 runner/Coordinator 与 P2 ownership/shadow 均已接入源码但默认关闭，
现有翻译和 AI 代打默认行为不因这些独立组件改变。

### P1：持久后台工作

1. `ARC-VOICE-WORK-002`：PostgreSQL Work Store、durable queue、
   transactional outbox、submissionKey、create/cancel/status。
2. `ARC-VOICE-PERMISSION-001`：有界工具面和当前 turn 明确授权证据。
3. Delivery Coordinator 接入现有 TTS/playback，但默认 feature flag 关闭。

2026-08-28 实现状态：以上均为 `SOURCE_AUTOMATION_PASS / DEPLOYMENT_PENDING`。

- migration `037_agent_voice_work`、`038_agent_work_permissions`、
  `039_agent_voice_turn_scope` 以 PostgreSQL 为唯一生产真值；Work、command inbox 和业务
  outbox 在同一 transaction 更新。
- Work create/cancel/status、当前 turn 授权、permission request/resolve、claim lease、有限
  retry、取消 deadline、进程重启 convergence 和同容器 runner 已接线；TTL、最大运行时、
  cancel deadline 和 claim lease 共同 fencing 最终写入。
- permission resolve 的默认授权快照 ID 由 permissionRequestId + commandId 确定生成；真正
  写入决定前在同一 PostgreSQL transaction 内锁定并复核当前 App ownership，接管后的旧
  lease/generation 不能批准或拒绝当前请求。
- runner 当前仅允许注册表中的 `availability_lookup v1 + external_read`，调用外部可配置
  Tool Gateway 并携带稳定 `workId` 幂等键；没有加入拨号、消息、支付或其他外部写工具。
- Delivery Coordinator 只向当前 dispatch 的唯一 Voice Agent Worker 发送，并把生命周期只发
  给当前 ownership 的 App Host；同 attempt 事件严格按序，发布结果未知时保留原 attempt 对账，
  不立即制造第二次播报。

### P2：所有权和可选 Provider

1. `ARC-VOICE-OWNERSHIP-001`：按 session + leg 的 voice ownership/takeover。
2. `ARC-VOICE-PROVIDER-001`：Qwen Audio Realtime 可选 Agent Provider
   shadow，不进入默认翻译链。

2026-08-28 实现状态：以上均为 `SOURCE_AUTOMATION_PASS / DEPLOYMENT_PENDING`。

- migration `040_voice_client_ownership` 实现 `sessionId + legId` 权威所有权、短 lease、续租、
  generation 和两阶段 takeover；Flutter 使用持久 `clientInstanceId`，网络结果未知时在短窗口
  内复用同一 takeover/command ID。
- migration `041_agent_voice_delivery` 将 Work 完成与实际交付分离；Worker 使用精确目标命令、
  AnnouncementWindow 和播放 generation，App 使用有界持久 receipt outbox，服务端只接受当前
  owner 的完整绑定回执。
- Qwen Audio Realtime shadow 只读取既有 callee 音轨的 16 kHz mono PCM，按 100 ms 批次发送，
  强制 text-only、禁止工具和音频输出；协议异常、服务端错误或缓冲超限只关闭 shadow，不影响
  Voice Agent、Translation Runtime、SIP 或 Air780 主链。密钥仅来自运行环境。
- 无界 AI 应用仍是单个 `wujie-ai` 容器；runner/coordinator 是 API 内任务，shadow 是 Voice
  Agent 内观察器。Tool Gateway 是显式配置的外部接口，不由本方案新增第二个应用容器。

## 13. 验收与回滚门

实施前先冻结同一批真实/合成 fixtures 和现有基线。验收至少包括：

- 所有新 feature flag 关闭时，现有 Translation、Agent、playback 和接管行为不变。
- 同一负载下 ASR/MT/TTS 首结果与端到端延迟无统计显著退化；任何阶段
  p95 退化超过 5% 均阻止灰度。
- 100 个后台结果覆盖生成、断网、重连、打断、过期和进程恢复；不得重复
  `client.playback.ended`，不得播放旧 generation。
- 用户发言和翻译 TTS 总能关闭 AnnouncementWindow，后台播报不得延迟翻译。
- create/cancel/status 幂等；重启可恢复，外部副作用不重复。
- Host/Origin、DNS rebinding、超大帧和队列饱和测试通过。
- 真实 iPhone/Android 对“服务端开始播放”和“设备实际播放”分别留证。

回滚顺序：

1. 关闭后台 Work 创建。
2. 关闭 AnnouncementWindow 交付协调。
3. 停止后台 runner，保留 Work/delivery 数据只读。
4. 客户端回执字段继续兼容忽略，现有 playback 事件和翻译链不回滚。

本批 P0/P1/P2 canonical Node `1821/1821`、Flutter `453/453`、ASR `101/101`、全仓
typecheck/analyze/build、空库及 36→41 PostgreSQL 升级和 Beelink feature-flag-off 单容器部署
均已通过。当前结论仍不是运行功能现场通过：真实启用前必须分层配置只读 Tool Gateway，执行
客户端回执、故障矩阵和真机音频验收；任何失败均只关闭对应 flag，不回退既有主链。
