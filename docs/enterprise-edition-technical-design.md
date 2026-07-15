# AI Phone 企业版详细技术设计

版本：v1.0
日期：2026-07-15
状态：SaaS 基线待评审

## 1. 设计原则

- 复用现有 `translation_sessions`、`call_legs`、segment、playback 和 usage ledger。
- 企业业务保存自己的聚合状态，但媒体和翻译结果仍引用统一 session。
- 企业版由平台统一托管；客户配置业务策略，不配置服务器、数据库或模型地址。
- 所有状态迁移由服务端执行；客户端只提交命令。
- LLM 输出使用 JSON Schema，并在进入业务状态机前校验。
- 外部 Provider 必须通过 Adapter 和能力声明接入。

## 2. 核心数据模型

### 2.1 租户和权限

```text
enterprise_tenants(
  id, name, status, home_region, cell_id, plan_code,
  trial_ends_at, billing_customer_ref, data_retention_days,
  created_at, updated_at, version
)

enterprise_members(
  id, tenant_id, user_id, role, status, joined_at, updated_at, version
)

enterprise_api_credentials(
  id, tenant_id, name, secret_hash, scopes, expires_at, revoked_at
)

tenant_entitlements(
  tenant_id, entitlement_key, limit_value, enabled,
  effective_from, effective_until, source_plan_version, version
)

tenant_subscriptions(
  id, tenant_id, plan_code, status, seats, billing_cycle,
  current_period_start, current_period_end, version
)
```

唯一约束：`enterprise_members(tenant_id, user_id)`。

#### 2.1.1 RBAC scope

服务端只从当前 active membership 的 role 推导 scope；客户端提交的 role、scope 或权限头不能扩权。guard 先解析 tenant membership，再校验 scope，最后由 tenant-scoped Repository 查询资源。

| 角色 | 服务端授予的 scope |
| --- | --- |
| 企业所有者 | 全部 enterprise scope |
| 企业管理员 | 全部 enterprise scope |
| 营销主管 | `tenant:read`、`knowledge:read/publish`、`campaign:read/write/approve` |
| 营销人员 | `tenant:read`、`knowledge:read`、`campaign:read/write` |
| 客服主管 | `tenant:read`、`knowledge:read/publish`、`support:read/manage/takeover` |
| 客服坐席 | `tenant:read`、`knowledge:read`、`support:read/takeover` |
| 会议主持人 | `tenant:read`、`meeting:read/write`、`screen_share:stop` |
| 普通成员 | `tenant:read`、`meeting:read` |
| 审计员 | `tenant:read`、`member:read`、`knowledge:read`、`campaign:read`、`support:read`、`meeting:read`、`audit:read/export` |

完整 scope 集合为 `tenant:read/write`、`member:read/write`、`knowledge:read/publish`、`campaign:read/write/approve`、`support:read/manage/takeover`、`meeting:read/write`、`screen_share:stop` 和 `audit:read/export`。owner/admin 的“全部”仅指该版本声明的集合，不隐含未声明权限。

### 2.2 外呼营销

```text
marketing_campaigns(
  id, tenant_id, name, objective, owner_user_id, country_codes,
  language_codes, status, approval_status, policy_version,
  schedule_json, concurrency_limit, created_at, updated_at, version
)

marketing_leads(
  id, tenant_id, external_id, phone_e164, phone_hash, country_code,
  timezone, language, attributes_json, source_id, status, version
)

contact_consents(
  id, tenant_id, lead_id, purpose, channel, evidence_object_id,
  granted_at, expires_at, revoked_at, policy_version
)

suppression_entries(
  id, tenant_id, phone_hash, scope, reason, source, created_at
)

marketing_call_tasks(
  id, tenant_id, campaign_id, lead_id, session_id, scheduled_at,
  status, attempt, idempotency_key, outcome_code, version
)

marketing_outcomes(
  id, tenant_id, task_id, intent_level, disposition, summary,
  next_action, follow_up_at, evidence_segment_ids, created_at
)
```

关键唯一约束：

- `marketing_call_tasks(tenant_id, idempotency_key)`。
- 同一活动、线索和 attempt 只能有一个任务。
- suppression 使用 `tenant_id + phone_hash + scope` 去重。

### 2.3 AI 客服

```text
support_channels(
  id, tenant_id, type, provider, config_ref, status, version
)

customer_profiles(
  id, tenant_id, external_id, phone_hash, display_name,
  locale, attributes_json, consent_scope, version
)

support_sessions(
  id, tenant_id, customer_id, channel_id, translation_session_id,
  status, queue_id, assigned_user_id, intent, priority, version
)

support_cases(
  id, tenant_id, customer_id, session_id, subject, status,
  summary, resolution, external_ticket_id, version
)

tool_executions(
  id, tenant_id, session_id, tool_name, risk_level, request_hash,
  confirmation_status, status, external_result_ref,
  idempotency_key, created_at, completed_at
)
```

### 2.4 企业会议和屏幕共享

```text
enterprise_meetings(
  id, tenant_id, title, host_user_id, translation_session_id,
  scheduled_at, status, policy_json, retention_until, version
)

meeting_participants(
  id, tenant_id, meeting_id, user_id, external_identity,
  role, language, display_name, joined_at, left_at, version
)

meeting_screen_shares(
  id, tenant_id, meeting_id, participant_id, track_sid,
  source_type, includes_system_audio, quality_mode,
  status, lease_expires_at, started_at, paused_at, ended_at, version
)

meeting_artifacts(
  id, tenant_id, meeting_id, type, object_id, provider_fingerprint,
  status, created_at, published_at, version
)

meeting_action_items(
  id, tenant_id, meeting_id, owner_participant_id, text,
  due_at, status, evidence_segment_ids, version
)
```

同一会议只允许一个 `status=active|paused` 的 screen share，数据库使用条件唯一约束或事务内 CAS 保证。

### 2.5 公共模型

```text
enterprise_knowledge_sources
enterprise_knowledge_versions
enterprise_term_packs
policy_decisions
audit_events
usage_ledger
inbox_events
outbox_events
idempotency_keys
```

`audit_events` 和 `usage_ledger` 只追加，不允许更新历史记录。

## 3. API 设计

所有企业 API 使用 `/enterprise/v1`，并从访问令牌解析 tenant membership。客户端提交的 `tenantId` 只用于一致性校验，不能决定权限。

SaaS 控制面使用 `/saas/v1`，只负责租户发现、开通、套餐和区域路由。实时业务 API 只存在于租户所属区域数据面。

```text
POST   /saas/v1/tenants
GET    /saas/v1/tenants/:tenantId/route
POST   /saas/v1/tenants/:tenantId/invitations
GET    /saas/v1/tenants/:tenantId/entitlements
POST   /saas/v1/tenants/:tenantId/subscription/change
POST   /saas/v1/tenants/:tenantId/suspend
POST   /saas/v1/tenants/:tenantId/export
POST   /saas/v1/tenants/:tenantId/delete
```

### 3.1 企业基础

```text
GET    /enterprise/v1/me
GET    /enterprise/v1/members
POST   /enterprise/v1/members
PATCH  /enterprise/v1/members/:memberId
GET    /enterprise/v1/knowledge/sources
POST   /enterprise/v1/knowledge/sources
POST   /enterprise/v1/knowledge/sources/:id/publish
GET    /enterprise/v1/audit-events
```

### 3.2 外呼营销

```text
POST   /enterprise/v1/campaigns
GET    /enterprise/v1/campaigns
GET    /enterprise/v1/campaigns/:campaignId
POST   /enterprise/v1/campaigns/:campaignId/leads/import
POST   /enterprise/v1/campaigns/:campaignId/validate
POST   /enterprise/v1/campaigns/:campaignId/approve
POST   /enterprise/v1/campaigns/:campaignId/start
POST   /enterprise/v1/campaigns/:campaignId/pause
POST   /enterprise/v1/campaigns/:campaignId/cancel
GET    /enterprise/v1/campaigns/:campaignId/tasks
GET    /enterprise/v1/campaigns/:campaignId/analytics
POST   /enterprise/v1/suppression
```

### 3.3 AI 客服

```text
POST   /enterprise/v1/support/channels
GET    /enterprise/v1/support/queues
GET    /enterprise/v1/support/sessions
GET    /enterprise/v1/support/sessions/:sessionId
POST   /enterprise/v1/support/sessions/:sessionId/takeover
POST   /enterprise/v1/support/sessions/:sessionId/transfer
POST   /enterprise/v1/support/sessions/:sessionId/end
POST   /enterprise/v1/support/sessions/:sessionId/tools/:toolName
GET    /enterprise/v1/support/cases
PATCH  /enterprise/v1/support/cases/:caseId
```

### 3.4 企业会议

```text
POST   /enterprise/v1/meetings
GET    /enterprise/v1/meetings
GET    /enterprise/v1/meetings/:meetingId
POST   /enterprise/v1/meetings/:meetingId/join-token
POST   /enterprise/v1/meetings/:meetingId/start
POST   /enterprise/v1/meetings/:meetingId/end
POST   /enterprise/v1/meetings/:meetingId/screen-shares/acquire
POST   /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/pause
POST   /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/resume
POST   /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/stop
POST   /enterprise/v1/meetings/:meetingId/screen-translation/enable
GET    /enterprise/v1/meetings/:meetingId/artifacts
POST   /enterprise/v1/meetings/:meetingId/artifacts/:artifactId/publish
```

## 4. 状态机

### 4.1 营销活动

```text
draft -> validating -> pending_approval -> approved -> scheduled
scheduled -> running <-> paused
running|paused -> completed|cancelled|failed
```

只有 `approved` 可以进入 `scheduled`。start 命令必须在事务中复核活动版本、审批、国家策略、预算和有效线索数量。

### 4.2 营销任务

```text
pending -> suppressed|scheduled -> dispatching -> ringing
ringing -> answered|no_answer|busy|failed
answered -> in_progress -> completed|handoff|failed
```

任务到达终态时，结果、usage settle、hold release 和 outbox 同事务提交。

### 4.3 客服会话

```text
created -> waiting -> ai_active -> handoff_requested
handoff_requested -> human_active|ai_active|ended
ai_active|human_active -> ended|failed
```

### 4.4 会议和共享

```text
meeting: scheduled -> active -> ending -> ended
share: requested -> active <-> paused -> stopping -> ended
```

主持人停止共享时提高 generation 并撤销 publish 权限，旧轨道迟到事件不能恢复 active。

## 5. 事件协议

事件统一包含：

```json
{
  "eventId": "uuid",
  "tenantId": "tenant_uuid",
  "aggregateType": "campaign|support_session|meeting|screen_share",
  "aggregateId": "uuid",
  "aggregateVersion": 7,
  "eventType": "meeting.screen_share.started",
  "occurredAt": "ISO-8601",
  "idempotencyKey": "source:event-id",
  "payload": {}
}
```

关键事件：

```text
campaign.approved / started / paused / completed
lead.suppressed / consent.revoked
marketing_call.dispatched / answered / completed / failed
support_session.created / handoff_requested / assigned / ended
tool_execution.requested / confirmed / completed / rejected
meeting.started / participant.joined / ended
meeting.screen_share.started / paused / resumed / stopped
meeting.artifact.generated / published
policy.denied / pipeline.degraded / pipeline.restored
```

## 6. 外呼执行设计

Scheduler claim 任务时执行原子条件更新：

```sql
UPDATE marketing_call_tasks
SET status='dispatching', version=version+1, claimed_at=:now
WHERE id=:id AND tenant_id=:tenant_id
  AND status='scheduled' AND version=:expected_version;
```

claim 后仍需执行：

1. consent 未撤回且未过期。
2. suppression 不命中。
3. 当前时间位于国家允许窗口。
4. 活动仍为 running。
5. 租户和活动并发未超限。
6. usage hold 成功。

PSTN webhook 使用 provider event ID 去重。重复 answered/completed 不得重复创建 session、结果或 ledger。

## 7. Agent Runtime

每个 Agent turn 输入：

- 当前状态和业务目标。
- 当前客户可见资料。
- 已发布知识片段和引用。
- 允许的工具 schema。
- 当前国家和企业策略。
- 最近 turns 的压缩上下文。

输出：

```json
{
  "spokenText": "...",
  "intent": "qualify|answer|handoff|end",
  "toolRequest": null,
  "riskSignals": [],
  "knowledgeCitations": ["knowledge_version:block_id"],
  "conversationState": "qualifying"
}
```

禁止输出思考过程。`spokenText` 在发送 TTS 前经过品牌、禁语、事实引用和国家告知检查。

## 8. RAG 和知识版本

- 上传文档先进入 `draft`，解析、分块和审核后才能 `published`。
- embedding 和 chunk 都携带 `tenantId + knowledgeVersionId`。
- 检索必须同时过滤租户、语言、国家、产品和生效时间。
- 每次回答保存引用 ID，不保存完整检索提示词中的敏感内容。
- 新版本发布不修改历史会话引用。

## 9. 工具调用安全

工具定义包含：

```text
name
tenant_scope
required_role
risk_level
input_schema
confirmation_policy
timeout
idempotency_strategy
redaction_fields
```

执行顺序：schema 校验 -> 权限 -> 客户归属 -> 风险 -> 确认 -> Adapter -> 结果落库 -> 对客确认。任一步失败不得向客户声称成功。

## 10. 屏幕共享详细设计

### 10.1 客户端采集

- Web：`getDisplayMedia`，允许 screen/window/tab 和可用的 tab audio。
- iOS：ReplayKit Broadcast Upload Extension。
- Android：MediaProjection + foreground service。
- Flutter 通过 `ScreenShareController` 暴露统一状态，不复制 RTC 会话逻辑。

### 10.2 权限和租约

`acquire` 在事务中校验 meeting active、participant role、主持人策略和当前租约。成功后签发仅允许发布 `screen_share`/`screen_share_audio` 的短期 token。

租约每 10 秒续期；客户端断开、token 失效或主持人停止后，服务端在宽限期内把共享收敛为 ended。

### 10.3 自适应订阅

- 发布 360p/720p/1080p simulcast。
- 缩略图订阅低档，全屏订阅高档。
- 拥塞时先降低 screen track，保留音频和字幕。
- 暂停共享保留租约但停止发送新画面；最长暂停时间由企业策略决定。

### 10.4 屏幕 OCR

OCR Worker 每 1 至 2 秒获取低码率关键帧，先计算感知 hash；变化不足则跳过。结果结构：

```json
{
  "shareId": "uuid",
  "frameRevision": 18,
  "sourceSize": {"width": 1920, "height": 1080},
  "blocks": [
    {"id":"b1", "rect":{"left":0.1,"top":0.2,"width":0.3,"height":0.08},
     "sourceText":"...", "translatedText":"..."}
  ]
}
```

布局事件经 data channel 发布。OCR/翻译失败只显示原共享画面。

## 11. 数据隔离和并发

- Repository 方法必须接收 tenant context，禁止先按资源 ID 查询再在内存判断租户。
- 外部可猜测 ID 使用 UUID/ULID，不暴露 SQLite rowid。
- 写入使用事务、唯一约束、CAS version 和幂等键。
- 50 个并发租户任务不得共享进程级全局“当前租户”。
- 分页游标包含 tenant 和排序键签名，不能跨租户复用。
- 导出任务生成时固化数据范围和权限快照。
- 每个 access token 固化 `tenantId + homeRegion + cellId + roles + entitlementVersion`；区域不匹配时拒绝写入并要求重新发现路由。
- entitlement 由服务端读取和缓存，缓存失效时采取保守策略；客户端不得自行开启未购买功能。
- 租户级并发 semaphore、速率限制和预算在 claim/dispatch 前再次校验。

## 12. SaaS 租户开通和路由

```text
Signup -> verify enterprise admin -> create tenant
-> assign homeRegion/cell -> create subscription/entitlements
-> provision regional tenant record -> readiness check
-> issue tenant-scoped session -> active
```

开通使用 saga + outbox。控制面已创建但区域数据面失败时，租户保持 `provisioning_failed`，不得标记 active。重复开通请求使用相同 idempotency key 返回同一 tenant。

客户端登录后先从控制面获取短期 route document：

```json
{
  "tenantId": "uuid",
  "homeRegion": "ap-southeast",
  "cellId": "cell-01",
  "apiBaseUrl": "https://api-ap.example.com",
  "rtcUrl": "wss://rtc-ap.example.com",
  "expiresAt": "ISO-8601",
  "signature": "..."
}
```

业务 Provider 内部地址、密钥和模型端口永不返回客户端。

## 13. 用量、套餐和成本

用量按功能拆分：

```text
meeting_audio_seconds
screen_share_seconds
screen_ocr_frames
support_ai_seconds
support_human_seconds
marketing_call_seconds
pstn_seconds
asr_seconds
tts_characters
llm_input/output_tokens
```

营销和客服电话先 hold，再按终态真实时长 settle。失败重试使用新的 attempt id，但同一 provider call 只能结算一次。

SaaS 计量形成三层记录：原始 usage event、不可变 ledger、账期聚合。套餐权益和账单聚合错误不能改写原始 ledger；使用调整流水进行纠正。

席位按账期快照计费，用量按租户时区之外的统一 UTC 账期切分，避免时区修改导致重复计费。

## 14. 降级策略

| 故障 | 降级 |
| --- | --- |
| ASR | 请求重复一次，仍失败则转人工或仅保留通话 |
| 翻译 | 保留原文字幕，明确显示翻译不可用 |
| TTS | 保留字幕；外呼 Agent 无安全声音输出时转人工或结束 |
| LLM | 使用确定性 FAQ/结束语，不生成自由回答 |
| RAG | 不回答企业事实，转人工 |
| OCR | 继续屏幕共享，关闭共享内容翻译 |
| Speaker | 匿名说话人，不影响会议字幕 |
| PSTN clear | 强制半双工或纯字幕，不开启抢话 |
| CRM | 写 outbox 重试，不阻塞通话终态和结算 |
| SaaS 控制面 | 已登录租户可在短时 route/token 有效期内使用区域数据面；禁止新开通和套餐变更 |
| Entitlement | 缓存过期后禁止新增高成本任务，保留历史只读和安全结束能力 |

## 15. 数据保留

- 默认不保存原始屏幕帧。
- 原始录音、屏幕录制和声纹需独立授权和保留策略。
- transcript、summary、audit 和授权证据分别配置期限。
- 删除采用租户范围 tombstone + object deletion outbox；远端删除失败持续重试并可审计。
- 租户注销分为 suspended、retention、deleting 和 deleted；删除期间禁止重新激活同一租户 ID。

## 16. 配置门禁

企业功能只有满足以下条件才标记 ready：

- tenant/RBAC、数据库和审计可用。
- 对应 Provider 配置、能力和 webhook 校验通过。
- 国家策略版本存在且未过期。
- 外呼活动必须同时满足 PSTN、consent、suppression 和人工接管 readiness。
- 屏幕共享必须满足 LiveKit、短期 token 和主持人策略 readiness。
- 客服工具必须有 schema、权限和幂等策略。
- SaaS 试点必须使用 PostgreSQL、正式域名、TLS、租户限流、备份和账单审计；SQLite 环境必须报告 `environment=demo_only`。
