# 生产数据架构与模型

版本：v1.0
日期：2026-07-17
状态：目标模型与迁移基线

## 1. 设计目标

数据层必须同时支持：

- 面对面同传、聆听、Call Link、PSTN 翻译和 AI 代打。
- 字幕 revision、双向独立播放、抢话、重连和 Worker 重派。
- 录音、导出、会后纪要、待办和 Agent 工具证据。
- 幂等 webhook、一次结算、删除、保留策略和审计。
- 单机 SQLite 内测到 PostgreSQL 多实例的可验证迁移。

## 2. 真值分层

| 层 | 真值 |
| --- | --- |
| PostgreSQL/SQLite | session、授权、状态、账本、可靠事件和 artifact 元数据 |
| LiveKit | 当前 Room/participant/track 的实时媒体状态 |
| Redis | 短期租约、容量、限流、presence 和缓存 |
| Object Storage | 授权录音、导出、声音参考和诊断对象 |
| Metrics Store | 脱敏时序指标，不保存业务终态 |

禁止：

- 用 Redis 恢复账本或 session 终态。
- 用 Room presence 覆盖数据库状态。
- 把录音 URL、字幕正文或工具结果只保存在 provider metadata。
- 把 JSON payload 当作全部核心字段的长期生产模型。

## 3. ID 与归属

所有核心表使用 UUID/ULID 风格的不透明 ID。外部 ID 单独存储：

```text
session_id
  participant_id
    leg_id
      provider_binding_id
  turn_id
    segment_id + revision
      translation_id
        playback_id + generation
  agent_task_id
    agent_run_id
      agent_step_id / tool_execution_id
  recording_job_id
    recording_artifact_id
```

当前个人版以 `user_id` 作为访问归属。若与企业版共用数据库，新增
`scope_type + scope_id` 必须通过独立 migration 和 RLS 设计完成，不能在个人版
代码中用可空 `tenant_id` 临时拼接权限。

## 4. 核心关系模型

### 4.1 Session

`communication_sessions`

| 字段 | 类型/约束 |
| --- | --- |
| `id` | PK |
| `user_id` | NOT NULL，访问归属 |
| `mode` | CHECK 枚举 |
| `orchestration_mode` | translation/agent/hybrid |
| `status` | 状态机枚举 |
| `duplex_mode` | full/half/captions_only |
| `source_language_policy` | JSONB 小对象或规范化列 |
| `target_language_policy` | JSONB 小对象或规范化列 |
| `model_profile_id` | 冻结的模型路由 |
| `version` | bigint，CAS |
| `event_sequence` | bigint，同 session 事件序号 |
| `started_at/answered_at/ended_at` | 权威时间 |
| `end_reason/failure_code` | 结构化终态 |
| `billable_seconds` | 非负 |
| `created_at/updated_at` | 审计时间 |

索引：

- `(user_id, created_at DESC, id DESC)`
- `(status, updated_at)` 仅用于恢复扫描
- `(mode, created_at)` 用于脱敏运营统计

`status` 和 `version` 使用条件更新，禁止 read-modify-write 后无版本覆盖。

### 4.2 Participant 与 Room

`session_participants`

- `id/session_id`
- `kind`：human/agent/worker/recorder/external_media
- `role`：host/guest/callee/translator/assistant/operator
- `display_name/preferred_language`
- `consent_snapshot_id`
- `status/joined_at/left_at`

唯一约束：`(session_id, id)`；同一 participant 可经历多条 leg。

`media_rooms`

- `id/session_id`
- `provider`
- `provider_room_name/provider_room_sid`
- `attempt`
- `status`
- `created_at/closed_at`

唯一约束：

- `(provider, provider_room_sid)`，SID 为空时不参与
- `(session_id, attempt)`

Room 恢复或迁移可创建新 attempt，不改变 session ID。

### 4.3 Media Leg 与 Provider Binding

`media_legs`

- `id/session_id/participant_id/media_room_id`
- `transport`：local/livekit/sip/websocket/ingress
- `direction`
- `status`
- `capabilities`
- `route_epoch`
- `started_at/active_at/ended_at`
- `disconnect_reason`

`provider_bindings`

- `id/session_id/leg_id`
- `provider/provider_resource_type`
- `external_id/external_parent_id`
- `attempt`
- `status`
- `capability_snapshot`
- `last_observed_at`

唯一约束：

- `(provider, provider_resource_type, external_id)`
- `(leg_id, provider, attempt)`

LiveKit participant identity、SIP call ID、track SID、egress ID 和 ingress ID 均放在
binding 中。

### 4.4 Speech Turn

`speech_turns`

- `id/session_id/participant_id/leg_id`
- `sequence`
- `start_ms/end_ms`
- `status`：open/final/superseded
- `dominant_language/detected_languages`
- `speaker_source/speaker_confidence`
- `overlap`
- `endpoint_reason`
- `vad_profile_id/asr_session_id`

唯一约束：

- `(session_id, sequence)`
- `end_ms >= start_ms`

索引：

- `(session_id, start_ms, id)`
- `(session_id, participant_id, start_ms)`

### 4.5 Transcript 与 Translation

`transcript_segments`

- `id/session_id/turn_id`
- `revision`
- `raw_text/display_text`
- `language/confidence`
- `start_ms/end_ms`
- `is_final/status`
- `asr_provider/asr_model/asr_fingerprint`
- `created_at`

主键可使用 `(id, revision)`，并建立：

- UNIQUE `(turn_id, id, revision)`
- INDEX `(session_id, turn_id, revision DESC)`
- CHECK `revision >= 1`

旧 revision 不删除；当前版本由查询选最大 revision。正文较长时仍放 PostgreSQL
TEXT，不放 Redis。

`translations`

- `id/session_id/segment_id/segment_revision`
- `target_language`
- `text`
- `provider/model/prompt_version`
- `latency_ms/status`
- `created_at`

唯一约束：

`(segment_id, segment_revision, target_language)`

同一个 segment revision 的重试写入 provider operation，不新建重复成功译文。

### 4.6 Playback

`tts_playbacks`

- `id/session_id/translation_id`
- `source_leg_id/target_leg_id`
- `generation/route_epoch`
- `status`
- `audio_format/sample_rate`
- `sink_provider/provider_playback_id`
- `first_audio_at/started_at/ended_at`
- `clear_supported/stop_latency_ms`
- `interrupt_reason`

约束：

- UNIQUE `(session_id, target_leg_id, generation)`
- 每个 target leg 最多一个 active playback 的 partial unique index
- 终态不可逆
- generation 和 route epoch 只增不减

当前 SQLite 的 `targetLegId + generation` 正确设计继续保留。

### 4.7 Agent

`agent_tasks`

- 用户目标、目标号码/对象、约束、风险级别、授权快照和状态。

`agent_runs`

- `session_id/task_id/mode/attempt`
- `status/policy_version/model_profile_id`
- primary request hash，用于跨 command 的业务幂等载荷冲突检测。
- `started_at/ended_at/failure_code`

`agent_steps`

- 输入 turn、决策类型、输出摘要、latency、status、idempotency key/request hash。

`tool_executions`

- tool schema/version、arguments hash、risk、approval、provider operation、result、
  idempotency key/request hash；给定 step 必须属于同一 run。

`handoff_records`

- takeover/transfer 原因、脱敏摘要、目标、接受和失败时间、幂等键/request hash。

`agent_consults`

- run、handoff、session、主房间、私密咨询房间和 operator participant identity。
- 只保存 HMAC phone hash，不保存原始外部坐席号码。
- requested/dialing/connected/merging/merged/rejected/no_answer/failed/completed 状态、
  版本、过期时间、provider operation 和各阶段时间戳。
- 一个 run 同时最多一个活动 consult；`run_id + idempotency_key` 唯一。
- room move 结果未知时以 LiveKit 两个房间的实际 presence 恢复，不依赖 App 猜测。

约束：

- UNIQUE `(task_id, mode, attempt)`，每个 task/mode 最多一个活动 run。
- 一个 run 同时最多一个敏感 tool execution
- Consult 创建必须在一个 fenced transaction 内同时写 requested Handoff、
  takeover_requested Run 和 Consult；失败恢复与完成同样不得拆事务。
- 一个 run 同时最多一个活动 operator consult
- 工具结果不可由 LLM 输出直接标记成功，必须来自 Tool Gateway

### 4.8 Recording 与 Ingress

`consent_snapshots`

- session、participant、policy version、用途、录音/转写/Agent 同意和时间。

`recording_jobs`

- `session_id`
- `recording_type`
- `consent_snapshot_id`
- `status/provider/provider_operation_id`
- `retention_policy_id`
- `started_at/ended_at/failure_code`

`recording_artifacts`

- `recording_job_id`
- object key、content type、size、sha256、duration、track/participant binding
- `verified_at/deleted_at`

`external_media_sources`

- ingress 类型、来源策略、目标 room、状态、`external_ingress_id`、SRT 场景的
  `external_bridge_id` 和 retention。

原始 RTMP stream key、SRT passphrase/streamid、对象凭据和签名 URL 不进入普通
业务表或 PostgreSQL projection；SRT bridge 重启后若无法恢复内存任务，API 必须将
LiveKit ingress 清理并把 source 置为失败，不能生成第二条未知外部流。

## 5. 可靠事件和外部操作

`inbox_events`

- PK `event_id`
- `producer/event_type/event_version`
- `session_id`
- `payload_hash`
- `received_at/processed_at`
- `processing_result`

相同 event ID 但 payload hash 不同必须报警并拒绝。

`outbox_events`

- PK `id`
- UNIQUE `idempotency_key`
- `session_id/aggregate_version/sequence`
- `event_type/event_version/payload`
- `available_at/lease_owner/lease_until/attempts`
- `published_at/dead_lettered_at`

`provider_operations`

- `id/session_id/provider`
- `operation_type/idempotency_key`
- `request_hash`
- `external_operation_id/external_resource_id`
- `status`
- `attempt/next_retry_at`
- `last_error_class`
- `created_at/updated_at`

`primary_command_inbox`

- `command_id/aggregate_type/aggregate_id/command_type`
- command request hash 与首次 result payload；同 ID 不同 request/result 必须冲突。
- `retain_until` 和 retention 索引；保留期内的重试返回原始命令结果，不重新产生副作用。
- command inbox、领域记录和 reliable outbox 必须在同一个 fenced transaction 提交。

`reliable_inbox_events`

- 外部 event ID、session、event type、稳定 payload hash、处理结果和保留时间。
- 先在事务内 reserve；只有首次事件执行领域 mutation，完成后在同一事务保存 result。
- 并发 duplicate 等待首次事务后返回原始 result；改写 payload/session/type 必须冲突。
- 未处理 reservation 不得提交；过期记录按 `SKIP LOCKED` 有界清理。

唯一约束：

- `(provider, operation_type, idempotency_key)`
- `(provider, external_operation_id)`，非空时

拨号、dispatch、egress、ingress、transfer 和 provider tool 都必须先创建
provider operation。调用超时后先查询或等待 webhook 对账，不直接生成第二个
不可区分的副作用。

## 6. 账本

`usage_holds` 可更新，但必须有：

- UNIQUE `(user_id, idempotency_key)` 和单 session 单 active hold
- version/CAS
- active、settled、released 状态及 expires/released/settled 时间
- 过期 hold 不计入 available balance；创建新 hold 前原子关闭同 session 的过期 hold

`usage_accounts` 以用户为余额串行化点：

- `user_id/plan_code/monthly_seconds/remaining_seconds/version`
- Session fence 防止同一会话双结算，`usage_accounts` 行锁防止同一用户跨会话超扣
- 首次账户并发创建依靠唯一键回滚后重读，禁止无锁 read-modify-write

`billing_ledger_entries` append-only：

- `id/user_id/session_id`
- `entry_type`
- `delta_seconds/balance_after`
- `idempotency_key`
- command `request_hash`，同幂等键不同载荷必须失败关闭
- `source/order_id/product_id`
- `created_at`

唯一约束：`(user_id, idempotency_key)`。

Session 终态、hold settle/release、ledger 和 outbox 在同一事务完成。录音、摘要、
Egress 或 webhook 延迟不能延迟基础用量结算。

本地静态批次已加入 migration `019_usage_accounting` 及异步 Session/Usage Repository，
但现行同步 snapshot 调用面尚未切换，也没有真实 PostgreSQL 运行证据；在剩余聚合和
统一 runtime driver 完成前不得局部启用或长期双写。

## 7. PostgreSQL 写入模型

当前 SQLite `SqliteSessionChildrenStore` 会删除 session 子记录后整批重写，适合
单机小规模兼容，不适合多实例生产热写。PostgreSQL adapter 必须：

- segment、turn、translation、playback 按行增量写。
- 使用 `INSERT ... ON CONFLICT DO NOTHING/UPDATE` 的明确幂等语义。
- session 状态使用 `WHERE version = expected_version`。
- 不在事务内调用 LiveKit、SIP、模型或对象存储。
- 事务提交后由 outbox 执行外部副作用。
- 单个 HTTP 请求只开启一个短事务。

正文读取使用分页和投影，列表页不加载完整 transcript、诊断或 provider payload。

## 8. Redis 模型

推荐 key：

```text
session:presence:{sessionId}
dispatch:lease:{sessionId}
worker:capacity:{pool}:{workerId}
ratelimit:{scope}:{subject}:{window}
provider:circuit:{provider}:{capability}
room:route:{sessionId}
```

规则：

- 所有 key 有 TTL。
- 值仅保存小型标量或摘要。
- lease 丢失不等于 session 结束。
- 不保存完整字幕、Agent memory、账本或录音 manifest。
- Redis 清空后系统可从 PostgreSQL 恢复正确性，只损失短期性能。

## 9. 对象存储

对象 key 不包含手机号、姓名或字幕正文：

```text
sessions/{sessionId}/recordings/{artifactId}
sessions/{sessionId}/exports/{artifactId}
users/{userId}/voice-references/{referenceId}
diagnostics/{date}/{evidenceId}
```

数据库保存 object key、hash、size、retention 和删除状态。上传使用临时 key，
校验 hash 后原子发布 manifest。删除任务必须幂等并有 tombstone。

## 10. 分区和归档

早期不为所有表预先分区。满足以下任一条件再启用：

- 单表超过 1000 万行。
- vacuum/index 维护影响 SLO。
- 合规需要按月快速删除。

优先分区：

- inbox/outbox/provider operations 按月。
- transcript/translation 按 session 创建月。
- metrics/trace 在专用时序系统。

Session 列表和账本保留在小型主表，正文和 artifact 可冷热分层。

## 11. 迁移步骤

1. 冻结统一 ID、状态机和事件合同。
2. 在 SQLite 增加 mapper 和缺失字段，不改变客户端 DTO。
3. 建 PostgreSQL schema、约束和 Repository contract tests。
4. 离线导出 SQLite/JSON，生成 count/hash manifest。
5. 导入隔离 PostgreSQL，逐表 count/hash/关系对账。
6. shadow read 比对，不执行双副作用。
7. 维护窗口切换单一写主。
8. 失败时回退旧数据库和旧 read path；禁止双主写。
9. 稳定一个发布周期后再删除旧兼容字段。

迁移验收必须覆盖 session、segment、call leg、playback、inbox/outbox、hold、
ledger、Agent、voice reference 和对象 hash，不能只对比行数。

## 12. 保留与删除

- 默认不保存 PCM。
- partial 默认不持久化，只保存 final/revision。
- 用户删除后删除正文、summary、artifact 和 voice reference；账本保留必要的
  脱敏关联。
- 录音、Agent 工具证据和企业数据使用独立 retention policy。
- 删除事件进入 outbox，失败可重试并可审计。
- backup/PITR 中的删除遵循既定保留窗口，产品文案必须准确披露。
