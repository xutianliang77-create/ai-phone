# AI 翻译电话数据与运维设计

版本：v0.1  
日期：2026-07-02  
关联文档：`docs/ai-phone-translation-technical-design.md`、`docs/ai-phone-translation-protocol-design.md`

## 1. 数据库表

### 1.1 call_sessions

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | call id |
| user_id | text | 用户 |
| mode | text | call_link / pstn / agent |
| status | text | 状态 |
| room_id | text | WebRTC room |
| provider | text | twilio / telnyx / livekit |
| provider_call_id | text | 外部 call id |
| host_language | text | 用户语言 |
| peer_language | text | 对方语言 |
| started_at | timestamp | 开始 |
| answered_at | timestamp | 接通 |
| ended_at | timestamp | 结束 |
| duration_seconds | int | 计费秒数 |
| failure_reason | text | 失败原因 |

### 1.2 call_participants

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | participant id |
| call_id | text | 通话 |
| role | text | host / guest / callee / agent |
| join_type | text | app / web / pstn / agent |
| display_name | text | 展示名 |
| phone_hash | text | 脱敏手机号哈希 |
| joined_at | timestamp | 加入时间 |
| left_at | timestamp | 离开时间 |

### 1.3 call_segments

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | segment id |
| call_id | text | 通话 |
| speaker | text | host / peer / agent |
| source_language | text | 原语言 |
| target_language | text | 目标语言 |
| source_text | text | 原文 |
| translated_text | text | 译文 |
| is_final | bool | 是否最终 |
| is_highlight | bool | 是否重点 |
| created_at | timestamp | 时间 |

### 1.4 call_usage_ledger

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | text | ledger id |
| call_id | text | 通话 |
| user_id | text | 用户 |
| event_type | text | reserve / tick / settle / refund |
| credits_delta | int | credits 变化 |
| provider_cost_usd | decimal | 服务商成本 |
| model_cost_usd | decimal | 模型成本 |
| duration_seconds | int | 时长 |
| created_at | timestamp | 时间 |

## 2. Redis 缓存

```text
call:{callId}:state
call:{callId}:participants
call:{callId}:usage
call:{callId}:provider:{providerCallId}
call:{callId}:event_dedupe:{eventId}
```

规则：

- 状态缓存 TTL 默认为通话最大时长 + 1 小时。
- 事件去重 TTL 保留 24 小时。
- usage heartbeat 每 15 秒刷新。
- 结算结果以数据库 ledger 为准。

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
- settle 幂等 key 为 `call_id + settle`。

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

集成测试：

- 创建 Call Link。
- Web Guest 入会。
- 通话结束保存记录。
- mock PSTN answered/completed。
- mock media frames -> transcript -> translation。

真机测试：

- iPhone App 加入房间。
- Android App 加入房间。
- 浏览器 Guest 加入房间。
- 真实美国/加拿大手机号拨号。
- 10 分钟电话不断线。
- 余额不足自动阻止拨号。

## 8. 发布门槛

P1 Call Link：

- WebRTC 房间稳定。
- 双向字幕和译文保存。
- 历史详情可打开。
- 失败不扣费。

P2 PSTN 拨号：

- 至少一个 provider 真机拨号通过。
- answered/completed webhook 幂等。
- 双向媒体流稳定。
- credits 结算准确。
- 合规提示可见。

P2 AI Agent：

- 用户确认后才拨号。
- 可实时接管。
- 高风险信息请求接管。
- 生成结果和摘要。
