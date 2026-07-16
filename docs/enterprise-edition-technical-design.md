# AI Phone 企业版详细技术设计

版本：v1.1
日期：2026-07-15
状态：SaaS 详细技术方案基线待评审

## 1. 设计原则

- 复用现有 `translation_sessions`、`call_legs`、segment、playback 和 usage ledger。
- 企业业务保存自己的聚合状态，但媒体和翻译结果仍引用统一 session。
- 企业版由平台统一托管；客户配置业务策略，不配置服务器、数据库或模型地址。
- 所有状态迁移由服务端执行；客户端只提交命令。
- LLM 输出使用 JSON Schema，并在进入业务状态机前校验。
- 外部 Provider 必须通过 Adapter 和能力声明接入。

### 1.1 当前实现边界

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| Tenant/Member | `ready_for_acceptance` | 已有契约、记录、Repository、租户与 owner 原子创建及成员 API |
| RBAC | `ready_for_acceptance` | 已有17个 scope、九角色矩阵、统一服务端 guard 和越权测试 |
| PostgreSQL schema | `implemented` | 已有三段可逆 migration、tenant-first 索引、复合 FK、强制 RLS、checksum/锁和归档 smoke；尚无真实 migrate/restore/PITR 证据 |
| PostgreSQL Repository/控制面/业务聚合 | `designed` | `ENT-DATA-002` 及后续任务范围，不能从 schema 代码推导为已实现 |
| SQLite | `demo_only` | 仅本地开发、自动化和封闭演示，不承载真实企业试点数据 |
| PSTN/CRM/Calendar/OCR | `not_ready` 或按环境探测 | 未配置必须明确降级，不生成虚假外部对象或成功状态 |

状态含义统一为：`designed` 仅完成设计，`implemented` 表示代码存在，`verified` 表示自动化/环境证据通过，`production_ready` 还要求真实 Provider、容量、安全、备份和运维门禁。

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
| 营销主管 | `tenant:read`、`knowledge:read`、`knowledge:publish`、`campaign:read`、`campaign:write`、`campaign:approve` |
| 营销人员 | `tenant:read`、`knowledge:read`、`campaign:read`、`campaign:write` |
| 客服主管 | `tenant:read`、`knowledge:read`、`knowledge:publish`、`support:read`、`support:manage`、`support:takeover` |
| 客服坐席 | `tenant:read`、`knowledge:read`、`support:read`、`support:takeover` |
| 会议主持人 | `tenant:read`、`meeting:read`、`meeting:write`、`screen_share:stop` |
| 普通成员 | `tenant:read`、`meeting:read` |
| 审计员 | `tenant:read`、`member:read`、`knowledge:read`、`campaign:read`、`support:read`、`meeting:read`、`audit:read`、`audit:export` |

完整 scope 集合以 `packages/contracts/src/api/enterprise.ts` 的 `enterpriseScopes` 为唯一代码真值。owner/admin 的“全部”仅指该版本声明的17个 scope，不隐含未声明权限。

| 资源 | scope | 受控操作 |
| --- | --- | --- |
| tenant | `tenant:read`、`tenant:write` | 查看租户/readiness；修改允许的租户设置 |
| member | `member:read`、`member:write` | 成员列表；邀请、角色和状态变更 |
| knowledge | `knowledge:read`、`knowledge:publish` | 查看知识；审核/发布版本 |
| campaign | `campaign:read`、`campaign:write`、`campaign:approve` | 查看；编辑/控制；审批活动 |
| support | `support:read`、`support:manage`、`support:takeover` | 查看会话；队列策略；人工接管 |
| meeting | `meeting:read`、`meeting:write` | 查看/入会；创建、主持和材料发布 |
| screen_share | `screen_share:stop` | 主持人或管理员强制停止共享 |
| audit | `audit:read`、`audit:export` | 查询审计；受控导出 |

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
POST   /saas/v1/tenants/:tenantId/provision
GET    /saas/v1/tenants/:tenantId/route
POST   /saas/v1/tenants/:tenantId/invitations
GET    /saas/v1/tenants/:tenantId/entitlements
POST   /saas/v1/tenants/:tenantId/subscription/change
POST   /saas/v1/tenants/:tenantId/suspend
POST   /saas/v1/tenants/:tenantId/export
POST   /saas/v1/tenants/:tenantId/delete
GET    /saas/v1/tenant-jobs/:jobId
```

### 3.1 通用请求契约

| 项目 | 规则 |
| --- | --- |
| `Authorization` | 用户访问令牌或租户 API credential；两者必须在服务端解析 actor 和有效 scope |
| `X-Tenant-Id` | 多 membership 账号选择租户；只能选择已有 active membership，不能授予访问权 |
| route document | 数据面校验 tenant、homeRegion、cell、过期时间和签名；错误区域的写入返回 route mismatch |
| `Idempotency-Key` | 所有可重试写命令必填；同 tenant、actor、route 和 request hash 返回同一结果 |
| `If-Match`/`expectedVersion` | 更新和状态迁移携带期望版本；冲突返回当前 version，不做 last-write-wins |
| `traceparent`/`X-Request-Id` | 贯通 API、outbox、Worker、Provider 和 ledger；响应回传可安全展示的 trace ID |
| 时间和分页 | 时间使用 UTC ISO-8601；分页 cursor 签名并绑定 tenant、过滤器、排序键和过期时间 |

成功响应统一返回资源或 job；异步副作用使用 `202`：

```json
{
  "job": {
    "id": "job_uuid",
    "type": "knowledge.publish",
    "status": "processing",
    "resourceId": "resource_uuid",
    "submittedAt": "ISO-8601"
  }
}
```

错误响应不返回 SQL、内部 Provider 地址或跨租户资源存在性：

```json
{
  "error": {
    "code": "enterprise_scope_denied",
    "message": "Enterprise scope denied",
    "retryable": false,
    "traceId": "trace_id",
    "details": {}
  }
}
```

`details` 只包含客户端可行动字段，例如当前 version、缺失 capability 或字段校验结果；敏感策略和其他租户 ID 不进入响应。

### 3.2 企业基础

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

### 3.3 外呼营销

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

### 3.4 AI 客服

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

### 3.5 企业会议

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

### 11.1 PostgreSQL 租户隔离

- 所有 tenant-owned 表的 `tenant_id` 为 `NOT NULL`；主键可使用全局 UUID，但同时建立 `UNIQUE (tenant_id, id)`。
- tenant-owned 关系使用复合外键，例如 `(tenant_id, campaign_id)` 引用 `marketing_campaigns(tenant_id, id)`，数据库层拒绝跨租户关联。
- 高频查询索引以 `tenant_id` 开头，再包含状态、时间和稳定排序键；禁止仅按业务状态建立全租户扫描入口。
- Repository 必须接收不可变 `TenantContext`，SQL 模板显式包含 `tenant_id = $n`。无 tenant context 的方法只允许控制面目录和平台级审计模块使用。
- PostgreSQL RLS 作为纵深防御：事务开始后 `SET LOCAL app.tenant_id`，policy 校验当前 tenant；运行时角色不得拥有 `BYPASSRLS` 或表 owner 权限。
- migration、备份、恢复和平台级运维使用独立受审计角色；应用凭证不能执行 DDL 或关闭 RLS。
- RLS 不代替 Repository 条件、复合外键和自动化越权测试，三层门禁必须同时存在。

### 11.2 事务和一致性边界

| 命令 | 单事务必须提交 | 事务外处理 |
| --- | --- | --- |
| 创建租户 | tenant、owner member、provision saga、审计/outbox | 区域 provision、计费客户创建 |
| 发布知识 | version 状态 CAS、发布快照、审计/outbox | embedding、索引预热、旧版本回收 |
| 审批/启动活动 | campaign version、策略/线索/预算快照、任务或 outbox | Scheduler claim、PSTN dispatch |
| marketing task 终态 | task/outcome、hold settle/release、ledger、outbox | CRM 同步、分析聚合 |
| 坐席 claim | session version、assigned user、lease、审计 | 实时通知、外部工单同步 |
| screen share acquire/stop | share lease、generation、meeting version、审计 | token 签发/撤销、RTC track 收敛 |
| 工具执行请求 | request hash、确认状态、idempotency、outbox | Adapter 调用；结果再以 inbox 事务落库 |
| 租户删除 | tombstone、删除范围快照、审计/outbox | 对象删除、Provider 清理、最终校验 |

不能把数据库事务跨越 LLM、PSTN、CRM、对象存储或模型网络调用。外部调用前先提交 outbox；调用结果以带去重键的 inbox 进入新事务。

### 11.3 Idempotency 记录

```text
idempotency_keys(
  tenant_id, actor_id, route, idempotency_key,
  request_hash, status, response_code, response_body_ref,
  resource_id, created_at, expires_at
)
```

同一个 key 和相同 request hash 返回原结果；同 key 不同 hash 返回 `idempotency_conflict`。处理中请求返回相同 job/resource 引用，不能并行执行第二次副作用。

## 12. SaaS 租户开通和路由

```text
Signup -> verify enterprise admin -> create tenant
-> assign homeRegion/cell -> create subscription/entitlements
-> provision regional tenant record -> readiness check
-> issue tenant-scoped session -> active
```

开通使用 saga + outbox。控制面已创建但区域数据面失败时，租户保持 `provisioning_failed`，不得标记 active。重复开通请求使用相同 idempotency key 返回同一 tenant。

区域映射由控制面配置提供；当前实现读取 `ENTERPRISE_REGION_CELLS_JSON` 的
`homeRegion -> cellId` 映射。缺失、格式错误或区域未配置时必须返回
`not_ready`，不得生成临时 cell 或把租户标为 active。暂停可在控制面原子完成；
导出和删除只有外部执行器确认后才能把对应 job 标为 completed。

公开路由配置使用 `ENTERPRISE_PUBLIC_ROUTES_JSON`，以 `cellId` 为键保存
`homeRegion`、HTTPS API 域名和 WSS RTC 域名；签名密钥使用至少 32 字节的
`ENTERPRISE_ROUTE_SIGNING_SECRET`，有效期由 60 至 900 秒之间的
`ENTERPRISE_ROUTE_TTL_SECONDS` 控制。原始 IP、localhost、`.local`、`.internal`
及非 HTTPS/WSS 端点不得进入 route document。企业数据面写入通过
`X-Enterprise-Route-Document` 携带 base64url 文档；缺失、篡改、过期或
tenant/homeRegion/cell 不匹配均在副作用前拒绝。

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

## 17. 服务身份、密钥和数据分类

### 17.1 服务间认证

- API、Gateway、Worker、Scheduler、Agent 和 Adapter 使用短期 workload credential；不共享一个永久内部 token。
- 服务凭证声明允许的 caller、audience、tenant 范围和操作；接收方仍执行 tenant、resource 和 purpose 校验。
- 对象存储使用短期签名 URL，绑定 tenant、object、content type、大小、操作和过期时间。
- PSTN/CRM/Calendar webhook 保存 provider event ID、签名验证结果和接收时间；失败签名不进入业务 inbox。

### 17.2 数据分类

| 级别 | 示例 | 默认处理 |
| --- | --- | --- |
| L1 公开 | 产品帮助、公开状态页 | 可缓存，不包含 tenant 数据 |
| L2 企业内部 | 活动名称、会议标题、聚合指标 | tenant 加密存储，按 RBAC 访问 |
| L3 敏感 | 电话、客户资料、字幕、授权证据、工具参数 | 字段/对象加密，日志脱敏，导出审计 |
| L4 高敏/生物特征 | 原始音频、屏幕录制、声纹 embedding、付款/身份材料 | 单独授权、最短保留、严格 purpose 限制，不进入普通日志/分析 |

模型输入遵循最小化原则；不需要的 L3/L4 字段在进入 Provider 前删除或标记化。Provider 是否允许训练、保存多久、处理区域和删除能力属于 capability/readiness 门禁。

## 18. Provider readiness

每个 Adapter 暴露统一 capability document：

```json
{
  "provider": "provider_name",
  "capability": "pstn.outbound",
  "status": "not_ready",
  "region": "ap-southeast",
  "checkedAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "reasonCode": "credentials_missing",
  "features": {},
  "fingerprint": "redacted-version"
}
```

状态只允许 `not_configured`、`checking`、`ready`、`degraded`、`not_ready`。业务命令在执行时重新校验 capability 和过期时间，不能只依赖控制台上一次绿色状态。

- `not_configured/not_ready`：阻断依赖该能力的新任务，并返回明确原因。
- `degraded`：只开放声明仍安全的子能力，例如保留字幕但关闭 TTS。
- `ready`：只表示 Provider 探测通过，不代表 PostgreSQL、合规、预算和人工接管等整体产品门禁通过。
- 外部创建结果必须有可验证 provider reference；没有 reference 时只能保持 pending/failed，不能伪造 success。

## 19. 错误、重试和客户端动作

| 错误类 | HTTP/协议语义 | 是否重试 | 客户端动作 |
| --- | --- | --- | --- |
| authentication/tenant/scope denied | 401/403 或资源隐藏时404 | 否 | 重新登录/选择有权租户，不自动换 tenant |
| validation/policy denied | 400/422 | 修正后 | 展示字段或策略原因，不重复原请求 |
| version/idempotency conflict | 409/412 | 刷新后 | 获取当前资源；相同命令复用原 key |
| entitlement/quota/rate limit | 402/403/429 | 按策略 | 展示套餐/预算/重试时间，保留安全结束能力 |
| provider not ready | 424/503 | readiness 恢复后 | 明确降级或阻断，不显示假成功 |
| transient dependency | 502/503/504 | 有界退避 | 服务端 outbox 优先；客户端只重试幂等请求 |
| accepted async job | 202 | 轮询/订阅 | 使用 job ID 查询，不重复提交命令 |

所有自动重试都有次数、截止时间、抖动退避和 dead-letter/人工处理路径。高风险动作不得由客户端无限重试。

## 20. 测试与验收映射

| 设计不变量 | 自动化门禁 | 真实环境门禁 |
| --- | --- | --- |
| tenant/RBAC 不越权 | 九角色×全部 scope、跨租户 ID、伪造 header/body、RLS/复合 FK 测试 | 两真实租户并发攻击演练 |
| 命令幂等 | 相同 key 重放100次、不同 hash 冲突、API 重启恢复 | Provider webhook 重放和网络超时演练 |
| 单一状态机 | 非法迁移、CAS 冲突、迟到事件/generation 测试 | Worker/API 重启、断网恢复 |
| 不重复外部副作用 | inbox/outbox、claim、ledger 唯一约束和故障注入 | PSTN/CRM sandbox 或真实白名单账号 |
| Provider 不伪造成功 | 未配置、超时、部分响应、错误 reference contract test | 真实 credentials/readiness 证据 |
| 屏幕共享可停止 | lease、双 acquire、revoke 后旧 track 测试 | Web/iOS/Android 真机与弱网 |
| AI 不越权 | JSON Schema、Policy deny、知识无答案、工具风险矩阵 | 坐席接管和高风险人工流程 |
| 生产数据门禁 | migration、RLS、backup/restore、负载和数据对账 | PostgreSQL/PITR/cell 恢复演练 |

设计评审通过不等于功能验收。任务只有在代码、自动化、目标环境证据和 `enterprise-edition-acceptance-plan.md` 对应条目齐全后才能从 `ready_for_acceptance` 进入 `accepted`。
