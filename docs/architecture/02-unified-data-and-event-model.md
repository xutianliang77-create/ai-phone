# 统一数据与事件模型

版本：v1.0
日期：2026-07-17

## 1. 聚合边界

权威聚合根为 `communication_sessions`。一次面对面同传、Call Link、PSTN
翻译电话或 Agent 电话都只创建一个 session。

禁止继续出现：

- Agent draft 自己承担通话、session、计费和结果全部状态。
- `callId`、`sessionId` 在不同服务中指向不同业务对象。
- provider webhook 直接修改多个无事务关联的记录。
- room 在线状态直接覆盖业务 session 状态。

兼容期允许 API 返回 `callId`，但其值必须等于 `sessionId`，最终只保留
`sessionId`。

## 2. ID 层级

| ID | 含义 | 生命周期 |
| --- | --- | --- |
| `sessionId` | 唯一业务会话 | 创建到删除/归档 |
| `roomId` | LiveKit room 实例 | 可因恢复而变化 |
| `participantId` | 人、Agent 或 Worker 的会话身份 | session 内 |
| `legId` | 一条媒体/电话腿 | 可重连或转接 |
| `turnId` | 一名说话者的一轮发言 | session 内 |
| `segmentId` | 可修订的字幕/翻译单位 | turn 内 |
| `playbackId` | 一次目标腿译音播放 | segment 派生 |
| `agentRunId` | 一次 Agent 执行 | session 内可重试 |
| `toolExecutionId` | 一次工具调用 | agent run 内 |
| `providerOperationId` | 外部服务操作 | webhook/对账 |

外部 `providerCallId`、LiveKit participant identity 和 media stream id 只作为
provider binding，不作为业务主键。

## 3. 核心实体

### 3.1 `communication_sessions`

| 字段 | 说明 |
| --- | --- |
| `id` | sessionId |
| `user_id` | 归属账号 |
| `mode` | conversation/listening/call_link/pstn_translation/agent_call/... |
| `orchestration_mode` | translation/agent/hybrid |
| `status` | created/connecting/active/paused/ending/ended/failed/cancelled |
| `source_language_policy` | auto/fixed |
| `target_language_policy` | auto_reverse/fixed |
| `duplex_mode` | full_duplex/half_duplex/captions_only |
| `version` | 乐观并发版本 |
| `started_at/answered_at/ended_at` | 权威时间 |
| `end_reason/failure_code` | 结构化终态 |
| `billable_seconds` | 最终结算秒数 |
| `created_at/updated_at` | 审计时间 |

### 3.2 `session_participants`

表示人或 AI 身份，不等同于连接。

| 字段 | 说明 |
| --- | --- |
| `id` | participantId |
| `session_id` | 所属会话 |
| `kind` | human/agent/worker/recorder |
| `role` | host/guest/callee/assistant/translator/operator |
| `display_name` | 会话内名称 |
| `preferred_language` | 对该参与者播放的语言 |
| `consent_snapshot_id` | 入会时同意快照 |
| `status` | invited/joined/left/removed |

### 3.3 `media_legs`

| 字段 | 说明 |
| --- | --- |
| `id` | legId |
| `session_id/participant_id` | 归属 |
| `transport` | local/livekit/sip/pstn/websocket |
| `provider` | livekit/twilio/telnyx/domestic_bridge |
| `provider_participant_id` | LiveKit identity |
| `provider_call_id/media_stream_id` | 外部绑定 |
| `direction` | send/receive/bidirectional |
| `capabilities` | publish/subscribe/clear/dtmf/record |
| `status` | created/joining/ringing/active/degraded/ended |
| `joined_at/left_at` | 生命周期 |

唯一约束：

- `session_id + provider_participant_id`
- `provider + provider_call_id`
- 一个 active leg 只能绑定一个 participant。

### 3.4 `speech_turns`

`speech_turns` 是翻译与 Agent 共用的语义输入。

| 字段 | 说明 |
| --- | --- |
| `id` | turnId |
| `session_id/participant_id/leg_id` | 来源 |
| `start_ms/end_ms` | 统一音频时间轴 |
| `dominant_language/detected_languages` | 语种 |
| `speaker_source/confidence/overlap` | 归属证据 |
| `endpoint_reason` | silence/semantic/max/flush/boundary |
| `status` | open/final/superseded |

### 3.5 `transcript_segments`

| 字段 | 说明 |
| --- | --- |
| `id/session_id/turn_id` | 标识 |
| `revision` | 单调修订号 |
| `raw_text` | ASR 原文，不被 LLM 覆盖 |
| `display_text` | 保守规范化/纠错文本 |
| `language/confidence` | ASR 输出 |
| `start_ms/end_ms` | turn 内区间 |
| `asr_provider/model/fingerprint` | 实际路由 |
| `is_final` | 是否稳定 final |

旧 revision 不能覆盖新 revision 的原文、speaker、turn 和 timing。

### 3.6 `translations`

翻译不再直接塞进 segment 的同一个可变 JSON 字段。

| 字段 | 说明 |
| --- | --- |
| `id` | translationId |
| `session_id/segment_id` | 来源 |
| `revision` | 对应 segment revision |
| `target_language` | 目标语言 |
| `text` | 译文 |
| `provider/model/prompt_version` | 路由 |
| `latency_ms/term_hits` | 指标 |
| `status` | pending/completed/failed/superseded |

唯一约束：`segment_id + revision + target_language`。

### 3.7 `tts_playbacks`

保留当前正确的 `targetLegId + generation` 设计，并扩展：

- `translation_id`
- `audio_format/sample_rate`
- `first_audio_ms`
- `sink_provider`
- `clear_supported`
- `stop_latency_ms`
- `interruption_classification`

每个 target leg 最多一个 active playback。

### 3.8 Agent 实体

`agent_tasks` 保存用户目标和授权前草稿；`agent_runs` 保存一次真实执行。

| 实体 | 关键字段 |
| --- | --- |
| `agent_tasks` | objective、constraints、target、risk、authorization |
| `agent_runs` | session_id、task_id、status、policy_version、model_profile |
| `agent_steps` | input turn、decision、output、latency、status |
| `tool_executions` | tool、arguments_hash、risk、approval、result |
| `handoff_records` | reason、summary、target、accepted_at |

任务与执行分开后，重试不会覆盖原授权和历史结果。

### 3.9 计费与可靠事件

- `usage_holds`：可变状态，但使用幂等键。
- `billing_ledger`：append-only。
- `inbox_events`：eventId + payloadHash 去重。
- `outbox_events`：事务提交后异步发布。
- `provider_operations`：外部请求和 webhook 对账。

终态、hold settle/release、ledger 和 outbox 必须同事务提交。

## 4. 事件信封

```json
{
  "eventId": "uuid",
  "eventType": "speech.transcript.final",
  "eventVersion": 1,
  "sessionId": "uuid",
  "aggregateVersion": 18,
  "sequence": 42,
  "occurredAt": "ISO-8601",
  "producer": "translation-worker",
  "traceId": "trace-id",
  "idempotencyKey": "speech:segment:revision",
  "payload": {}
}
```

规则：

- `sequence` 只保证同 session 内单调，不要求全局单调。
- final、账本和工具结果使用 reliable channel/outbox。
- partial、VAD probability 和 UI 波形可以丢弃，不进入可靠事件表。
- 事件升级只能新增可选字段；破坏性变化提升 `eventVersion`。

## 5. 事件分类

| 域 | 事件示例 |
| --- | --- |
| Session | created/connected/active/ending/ended/failed |
| Participant | joined/left/removed/language_changed |
| Speech | vad_started/turn_final/transcript_partial/transcript_final |
| Translation | requested/completed/failed/superseded |
| Playback | queued/started/interrupted/ended/failed |
| Agent | run_started/plan_updated/tool_requested/handoff_requested/completed |
| Provider | degraded/restored/rate_limited |
| Billing | hold_created/settled/released/refunded |

## 6. 存储分层

### 6.1 当前阶段

- SQLite WAL 保存 session、segments、legs、playbacks、ledger 和事件。
- API 仍是唯一数据库写入者。
- `app_records.payload` 兼容旧数据，但新增实体优先进入独立严格表。

### 6.2 生产多实例

- PostgreSQL 承担事务、唯一约束和并发写。
- Redis 承担租约、限流、短期 presence 和 dispatch 状态。
- Object Storage 保存授权录音、声音参考和导出。
- 数据仓库只接收脱敏指标事件，不接收默认字幕正文。

## 7. 当前模型迁移映射

| 当前对象 | 目标对象 |
| --- | --- |
| `SessionRecord` | `communication_sessions` |
| `CallLinkMetadata` | session room binding |
| `CallLegRecord` | `session_participants` + `media_legs` |
| `SessionSegmentDto` | `speech_turns` + `transcript_segments` + `translations` |
| `CallPlaybackDto` | `tts_playbacks` |
| `AgentCallRecord` | `agent_tasks` + `agent_runs` + session |
| `providerWebhookEventIds[]` | `provider_operations/inbox_events` |

迁移期间 API DTO 保持兼容，由 mapper 聚合新表，不让 Flutter 同步承担数据库迁移。

## 8. 隐私与生命周期

- 默认不保存原始 PCM。
- 手机号明文只在拨号瞬间解密，数据库保存加密值、hash 和 masked 值。
- voice embedding、参考音频和录音使用独立对象权限，不进入普通 session JSON。
- 用户删除 session 时删除正文、摘要和媒体对象；账本保留必要脱敏关联。
- Agent prompt 只获取完成任务所需的最小字段，工具参数单独审计。
