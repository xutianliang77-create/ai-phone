# AI 翻译电话数据与运维设计

版本：v0.4
日期：2026-07-14
关联文档：`docs/ai-phone-translation-technical-design.md`、`docs/ai-phone-translation-protocol-design.md`

## 1. 数据模型

### 1.1 唯一会话聚合 `translation_sessions`

普通同传、Call Link、PSTN 和 AI Agent 共用一张会话表。Call Link 的 `callId` 等于 `sessionId`，不得再维护独立的进程内 Call Link Map。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | session/call id |
| user_id | text | 账号归属 |
| mode | text | realtime / call_link / pstn / agent |
| status | text | 会话状态 |
| room_id | text nullable | WebRTC room |
| source_language | text | 源语言策略 |
| target_language | text | 目标语言策略 |
| version | int | 乐观并发版本 |
| started_at/answered_at/ended_at | timestamp nullable | 生命周期时间 |
| duration_seconds | int | 最终计费秒数 |
| failure_code | text nullable | 结构化失败原因 |
| created_at/updated_at | timestamp | 审计时间 |

### 1.2 通话腿 `call_legs`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | call leg id |
| session_id | text FK | 所属会话 |
| role | text | host / guest / callee / agent / worker |
| join_type | text | app / web / pstn / agent / worker |
| participant_identity | text nullable | LiveKit participant identity |
| provider | text nullable | livekit / twilio / telnyx / domestic_bridge |
| provider_call_id | text nullable | 外部 call id |
| media_stream_id | text nullable | 外部媒体流 id |
| playback_mode | text | full_duplex / half_duplex / captions_only |
| display_name | text nullable | 会话内展示名 |
| phone_hash/masked_phone | text nullable | 脱敏号码 |
| status | text | created / joining / active / degraded / ended |
| joined_at/left_at | timestamp nullable | 生命周期时间 |

唯一约束：`provider + provider_call_id`、`session_id + participant_identity`。Provider 外部 ID 不得绑定到两个 session。

### 1.3 片段 `session_segments`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | segment id |
| session_id | text FK | 所属会话 |
| source_leg_id/target_leg_id | text FK nullable | 音频方向 |
| speaker_id | text nullable | 会话内说话人 |
| turn_id | text nullable | speaker turn |
| revision | int | 单调修订版本 |
| raw_text | text | ASR 原文 |
| optimized_text | text nullable | 保守纠错结果 |
| translated_text | text nullable | 译文 |
| source_language/target_language | text | 语言方向 |
| start_ms/end_ms | int | 统一语音时间轴 |
| endpoint_reason | text nullable | silence/max_duration/flush/speaker_boundary |
| is_final/is_highlight | bool | 状态 |
| created_at/updated_at | timestamp | 审计时间 |

唯一约束：`session_id + id`。更新必须满足 `incoming revision >= stored revision`，旧 revision 只能补空译文，不能回滚 speaker、turn、timing 和原文。

### 1.4 可取消播放 `tts_playbacks`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text PK | playback id |
| session_id | text FK | 所属会话 |
| segment_id | text FK | 来源 segment |
| source_leg_id/target_leg_id | text FK | 播放方向 |
| generation | int | target leg 单调代次 |
| status | text | queued / streaming / interrupting / interrupted / completed / failed |
| provider/model | text nullable | 实际 TTS 和 sink |
| audio_duration_ms | int nullable | 译音时长，不含 PCM |
| interrupt_reason | text nullable | barge_in/session_end/superseded/failure/recovery |
| queued_at/started_at/ended_at | timestamp nullable | 生命周期时间 |

部分唯一索引保证每个 `target_leg_id` 最多一个 `queued/streaming/interrupting` 记录；`target_leg_id + generation` 唯一。数据库不保存 TTS PCM。

### 1.5 账本与可靠消息

| 表 | 关键字段和约束 |
| --- | --- |
| usage_ledger | `session_id`、`event_type`、`delta_seconds`、`idempotency_key UNIQUE`；append-only |
| inbox_events | `event_id UNIQUE`、`session_id`、`event_type`、`payload_hash`、`processed_at` |
| outbox_events | `idempotency_key UNIQUE`、`session_id`、`event_type`、`attempts`、`available_at`、`published_at` |
| idempotency_keys | `key UNIQUE`、`session_id`、`request_hash`、`result_ref` |

会话终态、最终 segments、usage settle/hold release 和 outbox 必须在同一 SQLite 事务提交。任何一步失败都整体回滚。

### 1.6 session_speakers 与 segment 归属

普通同传、Call Link、PSTN 和 AI Agent 共用 `SpeakerAttribution`：

| 字段 | 说明 |
| --- | --- |
| speaker_id | 会话内稳定键，例如 `speaker_1`、`host` |
| role | self/peer/host/guest/agent/worker/speaker/unknown |
| source | participant_track/diarization/voice_identity/language_role/manual/unknown |
| display_name | 会话内用户别名，可空 |
| confidence | 归属置信度，可空 |

`session_segments` 保存 `speaker_id`、`start_ms`、`end_ms`、`timing_source`、`speaker_overlap`。任何跨 speaker 的片段都必须在翻译前拆分。

旧 JSON 记录只作为一次性迁移输入；生产写入统一进入 SQLite Repository。旧记录缺失字段即视为 `unknown`，迁移不得根据文本猜测 speaker。

会话内重命名必须在一次 Repository 写事务中更新同一 `speaker_id` 的全部 segment，并使已有 review 失效。声纹 embedding 不得进入 session JSON、日志、导出或 LLM prompt。

### 1.7 Agent 灰度与并发写入

Agent 草稿按 `user_id + draft_id` 归属。授权、灰度策略复核、状态转为 queued、usage hold 和 outbox 必须在同一事务内完成。`start` 使用幂等结果，两个并发请求不能生成两个 provider call、两个 hold 或越过小时频控。禁拨号码和紧急号码配置只存规范化号码，不进入客户端日志。

### 1.8 Voice Profile 与 Voice Identity

`voice_profiles` 保存账号级朗读资料、参考音频对象引用、质量报告和 ready 状态；原始参考音频位于服务器对象目录，不进入 SQLite JSON 字段。只有质量门禁通过且 Provider 同步成功后才可置为 ready。

`voice_identities` 保存 `user_id`、显示名、同意版本/时间、状态、匹配阈值和不透明 `embedding_ref`。外部 DTO 删除 `user_id` 和 `embedding_ref`。撤回先在本地事务中将状态改为 revoked，再删除 Provider embedding；远端删除失败时保留仅供补偿任务使用的引用，匹配查询立即排除该记录。补偿成功后清除引用，删除状态不可逆。

### 1.9 扫描翻译数据边界

OCR 图片、block 坐标和译文默认只存在手机当前流程；未点击保存时不上传服务器。保存/分享只写用户明确选择的导出对象。block 坐标使用左上原点归一化值，逐块译文与源 block 使用同一顺序；不得把临时图片路径、原图二进制或 OCR 全文写入诊断日志。

## 2. 当前存储、并发和恢复策略

当前只有单服务器 SQLite WAL，不引入 Redis。内存队列、session mutex 和 PCM ring buffer 只用于性能，不能作为状态真值。

并发规则：

- API 是 SQLite 唯一写入者；Gateway、Worker、PSTN Bridge 通过内部命令写入。
- 每个写命令必须携带 `sessionId + idempotencyKey + expectedVersion`，同时校验 URL ID、请求体 ID 和账号归属。
- 同一 session 使用数据库事务和 `version` 条件更新；不同 session 可并行，不使用全局写锁串行全部通话。
- inbox 先去重再执行业务；业务变更和 outbox 同事务提交。进程内锁仅减少冲突，不能替代唯一索引和条件更新。
- SQLite 启用 WAL、foreign_keys、busy_timeout；遇到 busy 使用有界重试，超过门槛返回可重试错误，不静默丢事件。

恢复规则：

- API 启动和周期任务均扫描超时非终态 session、未发布 outbox 和 active playback。
- API 重启后 Call Link 可从 `translation_sessions + call_legs` 恢复，不依赖旧进程内 Map。
- Worker 重启后未完成 playback 收敛为 `interrupted(recovery)`，禁止自动重播旧音频。
- usage hold、settle 和 refund 只由 ledger 幂等键决定；恢复扫描不得产生第二条 settle。
- PCM、AEC reference、pre-roll、逐帧 VAD 和声纹 embedding 不持久化；重启后从新音频继续。

## 3. Credits 结算

拨号前：

- 校验订阅和 credits。
- 预扣最低 3-5 分钟。
- 写入 `reserve` ledger。

通话中：

- 每 15 秒写 `tick`。
- 余额不足 60 秒时发事件。
- 余额耗尽前自动结束。

结束后：

- provider completed webhook 触发结算。
- 按实际秒数写 `settle`。
- 未接、忙线、失败写 `refund`。
- settle 幂等 key 为 `settle:{session_id}`。
- 同一事务更新 session 终态、释放 hold、写 settle 和发布 review outbox；重复 End 或 provider completed 只返回已有结果。

## 4. 安全设计

号码：

- 明文手机号只用于拨号请求。
- 数据库存 `phone_hash` 和 `masked_phone`。
- 日志不得输出完整手机号。

Webhook：

- 验证 Twilio/Telnyx 签名。
- 只允许 HTTPS。
- 记录 event id、签名校验结果、接收时间。

记录：

- 默认不保存原始音频。
- 用户删除记录后删除 segments、summary、export 文件。
- 保留必要账单 ledger，但脱敏展示。

## 5. 日志和指标

日志字段：

- callId。
- roomId。
- provider。
- providerCallId。
- userId hash。
- segmentId。
- state transition。

核心指标：

- call_create_count。
- call_answer_rate。
- average_setup_latency。
- media_stream_disconnect_count。
- translation_latency_p95。
- tts_first_audio_latency_p95。
- asr_error_rate。
- provider_cost_per_minute。
- credits_settlement_error_count。
- speaker_attribution_rate。
- speaker_switch_latency_ms。
- speaker_span_dropped。
- speaker_provider_degraded。
- playback_interrupt_latency_ms。
- playback_false_interrupt_count。
- playback_stale_frame_dropped。
- playback_clear_failure_count。
- aec_degraded_count。
- call_recovery_count。

## 6. 环境变量

```text
CALL_PROVIDER=twilio|telnyx|mock
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TELNYX_API_KEY=
TELNYX_CONNECTION_ID=
TELNYX_PHONE_NUMBER=
CALL_WEBHOOK_BASE_URL=
CALL_MIN_RESERVED_CREDITS=15
CALL_CREDITS_PER_MINUTE=3
CALL_MAX_DURATION_SECONDS=1800
```

## 7. 测试计划

单元测试：

- 状态机合法迁移。
- credits reserve/settle/refund。
- webhook 签名和幂等。
- 电话号码脱敏。
- segment 保存和摘要输入生成。
- playback 状态机、generation 和迟到帧拒绝。
- 同 session 版本冲突、跨 session ID 拒绝和 inbox/outbox 幂等。

集成测试：

- 创建 Call Link。
- Web Guest 入会。
- 通话结束保存记录。
- mock PSTN answered/completed。
- mock media frames -> transcript -> translation。
- API/Worker 重启后 Call Link、playback、outbox 和结算恢复。
- 50 个并发 session 的 segment、end、webhook 和 cancel 不串写、不重复结算。

真机测试：

- iPhone App 加入房间。
- Android App 加入房间。
- 浏览器 Guest 加入房间。
- 真实美国/加拿大手机号拨号。
- 10 分钟电话不断线。
- 余额不足自动阻止拨号。
- 译音播放中抢话可停止当前 target leg，另一方向继续；不支持 clear 的 PSTN 明确降级半双工。

## 8. 发布门槛

P1 Call Link：

- WebRTC 房间稳定。
- 双向字幕和译文保存。
- 历史详情可打开。
- 失败不扣费。
- API/Worker 重启后链接和历史可恢复，旧译音不重播。
- 双向同时讲话不交叉取消，TTS-only 30 分钟无回声字幕和误抢话。

P2 PSTN 拨号：

- 至少一个 provider 真机拨号通过。
- answered/completed webhook 幂等。
- 双向媒体流稳定。
- Provider 能力声明真实；只有支持 clear/stop 时开启全双工抢话。
- credits 结算准确。
- 合规提示可见。

P2 AI Agent：

- 用户确认后才拨号。
- 可实时接管。
- 高风险信息请求接管。
- 生成结果和摘要。
