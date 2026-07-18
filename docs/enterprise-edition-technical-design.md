# 无界AI企业版详细技术设计

版本：v1.14
日期：2026-07-18
状态：统一通讯平台与 PostgreSQL Primary 收敛详细技术方案

## 1. 设计原则

- 复用无界AI统一通讯会话、媒体 leg、segment、playback、Provider operation 和 usage ledger。
- 企业业务保存自己的聚合状态，但媒体、翻译、TTS 和 Worker 调度结果都引用统一 `communicationSessionId`。
- 企业版由平台统一托管；客户配置业务策略，不配置服务器、数据库或模型地址。
- 所有状态迁移由服务端执行；客户端只提交命令。
- LLM 输出使用 JSON Schema，并在进入业务状态机前校验。
- 外部 Provider 必须通过 Adapter 和能力声明接入。

### 1.1 当前实现边界

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| Tenant/Member | `ready_for_acceptance` | 已有契约、记录、Repository、租户与 owner 原子创建及成员 API |
| RBAC | `ready_for_acceptance` | 已有17个 scope、九角色矩阵、统一服务端 guard 和越权测试 |
| SaaS tenant lifecycle | `ready_for_acceptance` | 已有幂等开通、暂停、导出/删除执行器、租约、有界恢复和 receipt 校验；真实对象存储/Provider 清理服务尚待验收 |
| Append-only audit | `ready_for_acceptance` | 已有 tenant-scoped 查询、HMAC cursor、成员/RBAC/租户生命周期埋点和 SQLite/PostgreSQL 不可变约束；受控导出和真实 PostgreSQL 验收尚待后续任务 |
| PostgreSQL schema | `implemented` | 已有十一段 up/down migration、tenant-first 索引、复合 FK、强制 RLS、user directory、cell pending projection、opaque subject identity、企业通讯绑定、受保护回滚、checksum/锁和归档 smoke；尚无真实 migrate/restore/PITR 证据 |
| Tenant-scoped Repository | `ready_for_acceptance` | 已有 tenant/user/cell scoped transaction、subject guard、单一 `legacy|postgres` runtime、HTTP 全链路注入、独立 cell Worker，以及 Tenant/Member/Audit、Directory、lifecycle、Inbox/Outbox、pending discovery 和共享 unit-of-work；尚无真实 PostgreSQL H3 证据 |
| Enterprise Inbox/Outbox | `ready_for_acceptance` | 已有 tenant-scoped 去重、稳定 payload hash、领域/inbox/outbox 原子提交、lease/retry/recovery 和100次重放门禁；真实 PostgreSQL 并发与 Provider sandbox 尚待验收 |
| SQLite/JSON 演示数据导入 | `ready_for_acceptance` | 已有维护窗口、SQLite 临时副本与 quick_check、空目标事务导入、六集合 count/SHA-256 读回对账和不一致回滚；仅限内部演示数据 |
| 公共 Primary Runtime 收敛 | `ready_for_acceptance` | 已合入上游稳定提交 `fe1c3c2`；公共31段与 enterprise 11段 manifest 由一个启动编排验证，driver、数据库身份和分权连接失败均在监听前闭合；尚无真实 PostgreSQL H3 证据 |
| 公共通讯 tenant scope | `ready_for_acceptance` | 公共 manifest 已增至31段；12张通讯资源表具有不可空 scope、复合 FK、写入 guard 和 forced RLS，企业 unit-of-work 只暴露 tenant-bound 白名单 Repository；尚无真实双租户 A1/H3 证据 |
| 企业统一通讯会话绑定 | `ready_for_acceptance` | enterprise `0011` 和 tenant unit-of-work 已建立 Meeting/Support/Marketing 唯一绑定、route/policy/entitlement 快照及 generation/event-sequence 收敛状态机；尚无真实多实例、cell 迁移和 A1/H3 证据 |
| PostgreSQL 控制面/业务聚合 | `designed` | 后续 CORE/MTG/CS/MKT 领域任务范围，不能从公共 Repository runtime 推导为已实现 |
| SQLite | `demo_only` | 仅本地开发、自动化和封闭演示，不承载真实企业试点数据 |
| PSTN/CRM/Calendar/OCR | `not_ready` 或按环境探测 | 未配置必须明确降级，不生成虚假外部对象或成功状态 |

状态含义统一为：`designed` 仅完成设计，`implemented` 表示代码存在，`verified` 表示自动化/环境证据通过，`production_ready` 还要求真实 Provider、容量、安全、备份和运维门禁。

### 1.2 无界AI上游对齐边界

截至 2026-07-18，公共 PostgreSQL migration、Primary Runtime、fence、可靠事件、
Billing 和 Product Records 已形成稳定提交 `fe1c3c2`，并通过 `ENT-DATA-007` 合入
企业分支。合入只建立代码基线，不继承主产品 staging、容量或灾备结论；公共通讯表已由
`ENT-DATA-008` 完成本地 tenant scope/RLS 代码改造，切换证据仍由 `ENT-DATA-009` 独立产出。

- 一个进程只能选择一个 Storage Driver，并在监听端口前通过同一套 startup readiness；不得按路由回退或双写。
- 一个 Driver 可以使用多个最小权限连接池：migration、应用 tenant、user directory、cell discovery、maintenance 各自分权，不能共享超级角色。
- 公共 schema 保存跨产品可复用的通讯运行原语；`enterprise` schema 保存租户、成员、策略、业务聚合和 forced-RLS 投影。
- 公共表进入企业请求链路后必须具有一等 `scope_type + scope_id`，且企业 scope 的 `scope_id` 必须等于可信 tenant context；可选 `owner_id`/`user_id` 过滤不能充当授权边界。
- 主产品 staging、单机副本或同故障域验证不自动成为企业生产证据；企业版仍需独立的迁移、隔离、切换、恢复和容量验收。

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

### 2.6 统一通讯会话和资源作用域

```text
ai_phone.communication_sessions(
  id, scope_type, scope_id, user_id, mode, status,
  home_region, home_cell_id, routing_generation,
  created_at, ended_at, version
)

enterprise.communication_session_bindings(
  id, tenant_id, communication_session_id, kind,
  meeting_id|support_session_id|marketing_call_task_id,
  status, home_region, cell_id, route_epoch,
  policy_version, entitlement_version, generation,
  last_event_sequence, started_at, ended_at, version
)

session_participants(
  session_id, participant_id, scope_type, scope_id,
  subject_id, role, locale, joined_at, left_at
)

media_legs(
  session_id, leg_id, scope_type, scope_id, provider,
  provider_binding_id, direction, media_type, generation, status
)

worker_dispatches(
  id, session_id, scope_type, scope_id, tenant_id, cell_id,
  route_epoch, generation, capability, status, lease_expires_at,
  worker_id, attempt, idempotency_key, created_at, updated_at
)

provider_operations(
  id, session_id, scope_type, scope_id, operation_type,
  provider, provider_reference, request_hash, status,
  idempotency_key, created_at, completed_at
)

tts_playbacks(
  session_id, playback_id, scope_type, scope_id,
  generation, provider_operation_id, status, started_at, ended_at
)
```

企业请求只允许 `scope_type='tenant'`，并要求 `scope_id = tenant_id =
TenantContext.tenantId`。所有父子关系使用包含 scope 的复合唯一键/外键；按 session、
provider reference、playback 或 dispatch ID 查询时也必须带 scope。Provider 返回的 ID
只能作为 binding，不能成为平台资源主键或授权凭据。

主产品的通用 Product Records 若只提供可选 `owner_id`，不能直接承载企业授权；必须先由
`ENT-DATA-008` 增加不可省略的 scope 契约、forced RLS 和跨租户负向测试。主产品按
`user_id` 聚合的个人账单同样不能直接作为企业账单，企业结算以 tenant billing account
和不可变 usage ledger 为准。

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
GET    /enterprise/v1/provider-capabilities
```

### 3.1 通用请求契约

| 项目 | 规则 |
| --- | --- |
| `Authorization` | 用户访问令牌或租户 API credential；两者必须在服务端解析 actor 和有效 scope |
| `X-Tenant-Id` | 多 membership 账号选择租户；只能选择已有 active membership，不能授予访问权 |
| route document | 数据面校验 tenant、homeRegion、cell、route epoch、过期时间和签名；错误区域或旧 epoch 的写入返回 route mismatch |
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

审计查询要求 `audit:read`，只读取服务端解析出的当前 tenant。支持
`action/resourceType/result` 等值筛选和最多100项的 cursor 分页；cursor 使用
`ENTERPRISE_AUDIT_CURSOR_SECRET`（至少32字节）签名，并绑定 tenant、筛选条件、
`createdAt/id` 排序键和有效期。缺少签名密钥时接口明确返回
`audit_cursor_not_configured`，不生成无签名 cursor。

审计事件只允许原子追加，不提供 POST/PATCH/DELETE API。details 只接受有限数量的
白名单 primitive 字段，并拒绝 token、secret、authorization、idempotency、phone
和 URL 类字段名。当前埋点覆盖成员新增/更新及其 scope deny，租户开通/重试/暂停/
导出/删除的 accepted/completed/failed/denied 结果；重复幂等请求返回原 job，
不重复生成 accepted/terminal 事件。SQLite 使用独立表和 UPDATE/DELETE 拒绝触发器；
PostgreSQL `0006_enterprise_audit_append_only` 增加结果/JSON 对象约束、tenant-first
查询索引和相同不可变触发器。

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
  "scopeType": "tenant",
  "scopeId": "tenant_uuid",
  "homeRegion": "ap-southeast",
  "cellId": "cell-01",
  "routeEpoch": 12,
  "aggregateType": "communication_session|campaign|support_session|meeting|screen_share",
  "aggregateId": "uuid",
  "aggregateVersion": 7,
  "eventType": "meeting.screen_share.started",
  "occurredAt": "ISO-8601",
  "idempotencyKey": "source:event-id",
  "actorSubject": "user_<uuid>-or-system:subject",
  "traceId": "trace-id",
  "policyVersion": "policy-version",
  "entitlementVersion": 9,
  "payload": {}
}
```

`tenantId/scopeId/homeRegion/cellId/routeEpoch` 均由可信服务端上下文写入，不能从
客户端 header、baggage 或 Provider payload 复制。消费者在副作用前重新核对 scope、
当前 route epoch、策略和权益版本；旧 generation/route epoch 的迟到事件只允许收敛或
审计，不能恢复已取消的 Worker、媒体 leg 或播放。

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
communication_session.created / routed / degraded / ended
worker_dispatch.requested / leased / cancelled / fenced / completed
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
- Worker dispatch ticket 必须携带服务端签名的 `tenantId + communicationSessionId + cellId + routeEpoch + generation + capability + expiresAt`；Worker 不接受缺 scope、过期或跨 cell 的裸任务。

### 11.1 PostgreSQL 租户隔离

- 所有 tenant-owned 表的 `tenant_id` 为 `NOT NULL`；主键可使用全局 UUID，但同时建立 `UNIQUE (tenant_id, id)`。
- tenant-owned 关系使用复合外键，例如 `(tenant_id, campaign_id)` 引用 `marketing_campaigns(tenant_id, id)`，数据库层拒绝跨租户关联。
- 高频查询索引以 `tenant_id` 开头，再包含状态、时间和稳定排序键；禁止仅按业务状态建立全租户扫描入口。
- Repository 必须接收不可变 `TenantContext`，SQL 模板显式包含 `tenant_id = $n`。无 tenant context 的方法只允许控制面目录和平台级审计模块使用。
- PostgreSQL RLS 作为纵深防御：事务开始后 `SET LOCAL app.tenant_id`，policy 校验当前 tenant；运行时角色不得拥有 `BYPASSRLS` 或表 owner 权限。
- migration、备份、恢复和平台级运维使用独立受审计角色；应用凭证不能执行 DDL 或关闭 RLS。
- RLS 不代替 Repository 条件、复合外键和自动化越权测试，三层门禁必须同时存在。

#### 11.1.1 公共 Primary Runtime 收敛

`ENT-DATA-007` 负责把企业 Repository runtime 收敛到主产品稳定版本的 Primary
Runtime，而不是在两个 runtime 之间长期保留旁路。收敛时必须满足：

1. 公共 migration manifest 与 enterprise migration manifest 按固定顺序执行、分别校验 checksum，并由一个启动门禁给出完整 schema 结论。
2. 每个进程只选择一个 Storage Driver；旧 `ENTERPRISE_REPOSITORY_DRIVER` 可作为迁移期兼容输入，但最终解析为同一个进程级 driver，不能产生 route-level fallback、shadow read 或 dual write。
3. API tenant pool、user directory pool、cell discovery pool、migration pool 和 maintenance pool 仍保持独立角色、连接上限与审计身份；“统一 runtime”不等于“统一数据库高权限凭证”。
4. 公共通讯聚合只有在 `ENT-DATA-008` 完成 scope 列、复合约束、forced RLS、Repository context 和负向测试后，才允许企业流量读写。
5. `user_tenant_directory` 和 `platform_pending_work` 继续在所属 tenant 事务内同步更新；异步最终一致投影不能承担授权或恢复发现。
6. 数据切换由 `ENT-DATA-009` 输出全量 count/hash、增量水位、writer fence、旧写入者清退和回滚决策证据；仅连接成功或跑通一组本地测试不算完成。

当前首批实现通过工厂创建带私有 brand 的 frozen `TenantContext`，绑定
`tenantId + actorUserId + actorRole + traceId`；业务代码不能用普通对象替代。
成员和审计 Repository 的所有 tenant-owned 入口，以及生命周期 Worker 的
claim/finalize，都必须接收该 context。后台 sweep 只允许平台级发现
`tenantId + jobId + actorUserId` 引用，随后为单个 job 创建 context，不能仅按
全局 jobId 执行。

PostgreSQL scoped session 在独立事务中执行
`set_config('app.tenant_id', tenantId, true)`，只向 Repository 暴露自动把 tenant
注入 `$1` 的 query 方法。SELECT/UPDATE/DELETE 缺少显式 `tenant_id = $1`、
仅在 SQL 注释中伪造 predicate，或 INSERT 的 `tenant_id` 未对应 `$1` 时均在发往
数据库前拒绝；异常路径回滚并释放连接。该层是 `ENT-DATA-002` 的 SQL 和事务
基础门禁；是否启用 PostgreSQL 由唯一 runtime driver 决定，不能由单个 Repository
或路由自行选择。

第二批实现新增 Tenant/Member/Audit 的异步 PostgreSQL unit-of-work。tenant 根表
没有 `tenant_id` 列，因此只能使用专用 `queryTenantRecord`，并强制
`enterprise.tenants + id = $1`、单一 FROM、无 JOIN/子查询/UNION/OR；其他表继续要求显式
`tenant_id = $1`。Repository 支持当前 tenant 读取、成员列表、tenant-scoped
insert、expectedVersion CAS update、append-only audit 写入和与 HMAC cursor
一致的倒序分页。PostgreSQL bigint/timestamptz/jsonb 行会转换为现有领域记录，
输入记录和数据库返回行都再次核对 tenant，防止错误 SQL 或测试替身绕过 context。

forced RLS 带来的关键安全发现是：普通 tenant session 只能看到一个
`app.tenant_id`，不能直接扫描 `members` 来发现用户属于哪些 tenant；为目录查询授予
`BYPASSRLS`、表 owner 或平台 migration 角色会破坏应用运行角色边界。`0008` 因此增加
`user_tenant_directory` 投影和 `current_user_id()`。目录会话只设置 transaction-local
`app.user_id`，只允许单表、单 SELECT、显式 `user_id = $1` 的查询，并由 forced RLS
再次限制为本人记录。目录只返回 `tenantId + memberId` 候选引用；随后为每个候选创建
独立 tenant session，重新读取 tenant/member，并核对 active 状态、userId 和 memberId。
请求指定的 tenant 不在本人目录时直接拒绝，不先探测该 tenant 是否存在。

成员 insert/CAS update 和租户暂停会在同一 tenant transaction 内同步目录投影。
第三批同时增加 tenant lifecycle、enterprise Inbox/Outbox PostgreSQL Repository：
job 幂等冲突返回原记录供 request hash 比对，job/tenant/member 更新使用锁或 CAS；
inbox/outbox 重复键返回原事件，outbox claim 使用 due/lease 条件原子递增 attempt，
finalize 使用 attempt CAS。Tenant、lifecycle 和 event Repository 可由同一
PostgreSQL unit-of-work 组合，任一领域错误都会整体回滚。

第四批实现解决 forced RLS 下的平台恢复发现。`0009` 增加
`platform_pending_work` 投影，只保存 `cellId + tenantId + workKind + resourceId`
以及 lifecycle 必需的 actor 和 due/lease 时间，不保存 payload、request hash、
Provider reference 或业务结果。tenant job、outbox 和 tenant cell 变化通过数据库
trigger 在原 tenant transaction 内自动维护投影；未分配 cell 的记录保留但无法被
cell policy 发现，cell 分配后 trigger 自动更新路由。

cell discovery session 只设置 transaction-local `app.cell_id`，同时写入
`app.worker_id` 和 `app.trace_id` 供数据库日志/审计关联；SQL 只允许
`platform_pending_work` 单表、单 SELECT、显式 `cell_id = $1`，拒绝 JOIN、子查询、
UNION、OR、多语句和其他 enterprise 表。forced RLS 使 Worker 只能看到当前 cell 的
due 且 lease 已过期的最小引用。发现结果不能直接授权 claim：代码随后创建独立 tenant
unit-of-work，重新读取 tenant 并核对其当前 `cellId`；路由已迁移或伪造引用时整体
回滚。复核使用 `SELECT ... FOR UPDATE` 锁定 tenant 路由行，避免 cell 迁移在检查与
claim 之间穿透；通过复核后，lifecycle/outbox 才分别执行 attempts/lease 原子 claim。

第五批冻结 identity 契约。账号 ID 的代码真值是 `user_<uuid>`，审计、策略和幂等
还需要 `system:enterprise-outbox` 等非用户 actor；因此 identity 是 opaque subject，
不能继续误建模为资源 UUID，也不采用不可逆 hash/UUID 映射表。`0010` 将 members、
Directory、created/owner/assigned/host/participant user references、tenant job actor、
pending actor、policy/audit/idempotency actor 改为 text。账号引用由数据库函数和
Repository 双层强制 `user_<uuid>`；通用 actor 允许账号 subject 或长度受限的
namespace subject。

`current_user_id()` 同步改为 text，因此 Directory forced RLS 直接比较完整账号
subject，不剥离前缀或产生碰撞。迁移会把旧 UUID 值规范化为 `user_<uuid>`；down
migration 只有在全部 actor 都仍是 account subject 时才允许还原，存在 `system:*`
等非账号 actor 时以明确错误阻断，避免丢失身份语义。schema verify 逐列确认12个
user/actor 列均为 text；Directory、Member、Audit、Lifecycle 和 Pending Repository
在发 SQL 前及读取返回行时再次验证 subject。

第六批增加 API fail-closed PostgreSQL 启动门禁。默认
`ENTERPRISE_POSTGRES_STARTUP_MODE=disabled`，不会读取连接串或连接数据库；
`verify` 只连接并执行 schema verify；只有显式 `migrate_verify` 才先运行 checksum、
advisory lock 和事务 migration，再执行相同 verify。非法 mode、缺连接串、连接失败、
migration checksum/schema/RLS/identity 列不满足均在任何恢复任务、Fastify 构建和
端口监听之前终止进程。校验结束后连接立即关闭，不把管理连接复用为应用连接池。

第七批完成 Enterprise Repository runtime。`ENTERPRISE_REPOSITORY_DRIVER` 只接受
`legacy|postgres`，并作为兼容输入服从 `API_STORAGE_DRIVER`；选择 `postgres` 时必须先得到启动 gate 的
`verified` 结果，再创建一个应用连接池并把同一 runtime 注入 tenant、member、
RBAC、audit、route 和 lifecycle 路由。不存在按路由选择、失败回退、shadow read、
双写或 `dual_write` 模式。PostgreSQL 创建租户使用
`ownerUserId + idempotencyKey` 的确定性 UUID，以便 forced RLS 下不做全租户 job
扫描也能恢复同一 provision 事务；同 key 不同 request hash 返回冲突。

API 在 PostgreSQL 模式不启动平台级 lifecycle sweep。独立
`enterprise-postgres-worker` 必须显式配置 `cellId + workerId`，poll、batch 和 lease
都有上限；它先用 cell session 读取 `platform_pending_work` 最小引用，再以 tenant
session 锁定并复核 tenant 当前 cell，随后 claim/finalize lifecycle 或 outbox。
单条记录异常只计入 failed，不阻断同批其他记录；poll 失败会报告并继续下一轮。
Outbox publisher 必须是无内嵌凭证的 HTTPS URL 且配置 token，使用 event ID 作为
稳定幂等键；未配置时 Worker 启动失败，不伪造投递成功。

第八批完成 `ENT-DATA-004` 演示数据导入。维护工具只处理当前已实现的
Tenant、Member、TenantJob、Audit、Inbox 和 Outbox 六类记录。JSON 直接读取；
SQLite 在 API/Worker 停止的维护窗口复制主文件及 WAL/SHM 到临时目录，执行
`quick_check` 后读取，原文件不被打开或修改。导入使用独立受审计的 maintenance
数据库角色（允许受审计的 `BYPASSRLS`，不得复用应用凭证）和 serializable
transaction，获取 advisory lock，要求目标六集合为空，
按依赖顺序写入，再在同一事务读回。源和目标均按稳定键排序、规范化 timestamptz，
分别计算每集合 count/SHA-256 与总 hash；任一差异或约束失败即 rollback。
该工具不是客户生产迁移通道，也不替代全域 `ENT-DATA-005`、PITR 或真实 H3 演练。

第九批完成 `ENT-DATA-007` Primary Runtime 收敛。企业分支合入上游稳定提交
`fe1c3c2` 的公共 migration 和 Primary Runtime；`API_STORAGE_DRIVER` 成为唯一
driver，旧企业变量只能与其一致。启动编排先校验公共签名 cutover evidence、manifest
和数据库身份，再以独立 migration 连接校验 enterprise manifest、forced RLS、
identity 和数据库身份；两个 verdict 的 database name/OID 不同即关闭已创建资源并拒绝启动。

API 的 enterprise tenant Repository 适配并复用公共 Primary pool，由公共 runtime
唯一负责关闭；user directory 使用独立最小权限 pool。cell Worker 也先通过同一 Primary
启动编排，再以独立 cell discovery pool 读取最小引用、以共享 tenant pool claim/finalize，
且不会创建或持有 directory 凭证。directory、cell、migration、maintenance 在生产环境
必须提供各自显式 URL；TLS 模式统一使用 `POSTGRES_SSL_MODE`，生产门禁仍要求
`verify-full`。不存在 fallback、shadow read、dual write 或路由级 driver。

该实现已完成本地代码和自动化门禁，但没有运行真实企业 PostgreSQL 双 manifest、角色
授权、并发 claim、PITR 或跨故障域恢复；因此状态仅为 `ready_for_acceptance`，不得宣称
企业试点或生产门禁通过。公共通讯和账单表也必须等待各自 scope、业务写路径及
`ENT-DATA-009` 切换证据完成后才能承载真实企业租户流量。

第十批完成 `ENT-DATA-008` 公共通讯 tenant scope。公共 migration manifest 新增
`031_communication_resource_scope`，将历史个人数据从 session 的 `user_id` 确定性回填为
`scope_type=user`，所有 child scope 都从所属 session/job 派生；无法找到合法父记录时
`SET NOT NULL` 或复合 FK 会使整段事务失败，不生成无归属记录。session、leg、transcript、
playback、Provider operation、dispatch/capacity、participant consent、recording 和 ingress
共12张表都启用并强制 RLS，policy 同时匹配 transaction-local scope type 和 scope ID。

写入 trigger 要求事务已设置 scope，禁止更新资源归属，并使现有 projection function 在
INSERT 时也只能写入当前 scope。企业 tenant session 在 `app.tenant_id` 之外固定设置
`app.scope_type=tenant` 和 `app.scope_id=TenantContext.tenantId`。它只暴露
`queryCommunication` 单 SELECT 白名单，SQL 必须同时包含 `scope_type=$1` 与
`scope_id=$2`，拒绝 OR、UNION、子查询、多表和通用 `projection_records`；session、leg、
dispatch、Provider operation、playback 和 participant consent 返回行还会再次核对 tenant。

第十一批完成 `ENT-CORE-013` 企业统一通讯会话绑定。enterprise `0011` 建立
`communication_session_bindings`，用生成的 `scope_type=tenant/scope_id=tenant_id` 与公共
session 复合外键绑定，并以三个互斥业务外键保证 Meeting、Support、Marketing 只能选择一个归属；
同一业务对象和同一 communication session 均只能绑定一次。route epoch、home region/cell、
policy/entitlement 版本及业务身份由数据库 trigger 固定，旧 `translation_session_id uuid` 仅保留为
明确标注的 legacy 字段，新写路径不得使用。

tenant unit-of-work 新增受限 communication mutation 和 binding Repository。创建命令在同一事务内
先写 tenant-scoped 公共 session，再写企业绑定；全局 session ID 冲突、业务 FK 不存在、跨租户引用或
重放参数漂移都会回滚。状态机以 `route_epoch + generation + last_event_sequence + version CAS`
判定事件：新 generation 可从低序号恢复，旧 route/generation、重复序号、非法倒退和终态恢复均拒绝；
企业状态同步投影为公共 session 的 created/active/ended/failed。

当前代码、定向矩阵和一次性本地 PostgreSQL 16 普通应用角色 forced-RLS/down-up 验证已完成，
但尚未在真实企业 PostgreSQL、两个真实租户、多实例 Worker 或 cell 迁移环境执行。也未接通
`ENT-CORE-014` 签名 dispatch ticket，因此只能标记 `ready_for_acceptance`，不能宣称 A1、H3、
企业试点或生产门禁通过。

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
| 创建/路由通讯会话 | tenant-scoped session、route epoch、policy/entitlement snapshot、dispatch outbox | LiveKit/ASR/翻译/TTS Worker 分配 |
| 取消通讯会话 | session generation、dispatch fence、媒体/播放取消意图、审计/outbox | Worker/Provider 实际停止和迟到回执收敛 |
| 企业用量结算 | tenant billing account、usage hold/settle、不可变 ledger、账单调整 outbox | 支付 Provider、发票和财务系统同步 |

不能把数据库事务跨越 LLM、PSTN、CRM、对象存储或模型网络调用。外部调用前先提交 outbox；调用结果以带去重键的 inbox 进入新事务。

当前 `ENT-DATA-003` 实现要求 inbox 处理器同步完成：领域状态、已处理 inbox 和
待发送 outbox 由同一个本地存储事务提交，回调抛错或返回 Promise 均整体回滚。
PostgreSQL 版本通过共享 tenant unit-of-work 提供同一原子边界，并由单一 runtime
接入 HTTP 与 cell Worker。平台恢复使用 cell-scoped forced-RLS 投影先发现最小
tenant/event/job 引用，再进入
独立 tenant transaction 复核 cell 并 claim；应用角色不使用 `BYPASSRLS`，projection
也不包含 payload 或领域结果。
provider payload 先转换为键排序的有限深度 JSON 并计算 SHA-256；相同
`tenant + source + sourceEventId` 的相同 payload 返回 duplicate，不再次执行领域
逻辑，payload 或 event type 改变则返回冲突。outbox 的
`tenant + idempotencyKey` 唯一，聚合、事件、payload、trace 和创建时间不可在
投递阶段修改。

outbox Worker 使用30秒 lease，过期后可恢复；失败按1秒起步、最长5分钟的指数
退避重试。数据库内保证同一 inbox 只产生一次领域提交和一条 outbox，但网络调用
仍是至少一次投递：若 Provider 已完成副作用而确认前连接中断，Worker 会再次使用
同一 idempotency key 投递，因此 Adapter 和 Provider 必须返回同一结果。当前未
接入默认或伪造 publisher；未配置真实 Adapter 时保持 not_ready。

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
导出和删除只有执行器确认后才能把对应 job 标为 completed。

导出/删除提交时固化去敏后的 tenant、member、tenant job，以及 actor role/scope
快照。每次执行先获取30秒 job lease；并发重复请求返回同一 job，不启动第二次
副作用。`processing` job 由启动恢复和5秒 sweep 继续执行；临时故障按有界退避
最多自动尝试5次，超过后进入 `executor_retry_exhausted`，原 idempotency key
仍可在配置恢复后人工重试同一个 job。

生产执行器由 `ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL` 和
`ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN` 配置，只允许 HTTPS。执行器完成
回执必须匹配 tenantId/jobId，并返回不含 URL/密钥的 opaque `receiptRef` 和
SHA-256 `receiptHash`；不匹配、错误 schema 或拒绝响应均不能完成 job。
`ENTERPRISE_TENANT_LIFECYCLE_LOCAL_DIR` 只用于非生产封闭演示：导出原子写入
0600 JSON artifact，删除清理该目录下的租户 artifact 并写 receipt；
`NODE_ENV=production` 会明确拒绝本地执行器。未配置任何执行器时 job 返回
`executor_not_configured`，不得无限 processing 或伪造完成。

删除请求先把 tenant 置为 `deletion_requested`；只有 receipt 校验通过后才置为
`deleted` 并停用成员关系。仍有 processing export 时删除返回
`tenant_lifecycle_pending`，避免删除完成后迟到导出重新生成 artifact。执行器失败时
tombstone 保留且可重试。当前生命周期请求、终态和越权尝试已追加审计事件；
retention 窗口、业务表/对象清单、受控审计导出和 Provider 删除收敛继续由
`ENT-UI-008/ENT-REL-002` 完成，不能仅凭基础 lifecycle job 和本地审计代码宣称
数据生命周期生产门禁通过。

公开路由配置使用 `ENTERPRISE_PUBLIC_ROUTES_JSON`，以 `cellId` 为键保存
`homeRegion`、HTTPS API 域名和 WSS RTC 域名；签名密钥使用至少 32 字节的
`ENTERPRISE_ROUTE_SIGNING_SECRET`，有效期由 60 至 900 秒之间的
`ENTERPRISE_ROUTE_TTL_SECONDS` 控制。原始 IP、localhost、`.local`、`.internal`
及非 HTTPS/WSS 端点不得进入 route document。企业数据面写入通过
`X-Enterprise-Route-Document` 携带 base64url 文档；缺失、篡改、过期或
tenant/homeRegion/cell/route epoch 不匹配均在副作用前拒绝。当前 route epoch 取 tenant
路由记录 version；路由或生命周期版本推进后，旧文档不能继续发起写入。

客户端登录后先从控制面获取短期 route document：

```json
{
  "tenantId": "uuid",
  "homeRegion": "ap-southeast",
  "cellId": "cell-01",
  "routeEpoch": 12,
  "apiBaseUrl": "https://api-ap.example.com",
  "rtcUrl": "wss://rtc-ap.example.com",
  "issuedAt": "ISO-8601",
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

企业账单的授权和归属主键是 `billing_account_id + tenant_id`，付款人 subject 只是该
账单账户的受控联系人，不能替代 tenant。来自主产品的 `user_id` 个人订阅、余额或账单
记录不得通过 ID 映射直接升级为企业账单；迁移必须生成 tenant billing account、期初
余额/权益快照和可对账 adjustment，并保留源记录哈希和审计引用。

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
- 公共与 enterprise migration manifest 必须同时通过 checksum/schema verify；任一缺失、漂移或执行顺序不确定都要在监听端口前失败。
- 应用、目录、cell discovery、migration、maintenance 使用独立角色和连接池；生产连接必须 `sslmode=verify-full` 并验证服务端证书与主机名。
- Primary 切换必须配置 writer generation/fence，旧 writer、旧 route epoch 和旧 Worker generation 不能继续提交副作用。
- 依赖漏洞临时例外必须有 owner、适用版本、缓解措施和到期日；例外只表示限期风险接受，不得在界面、文档或验收结果中写成“零漏洞”或“已修复”。

## 17. 服务身份、密钥和数据分类

### 17.1 服务间认证

- API、Gateway、Worker、Scheduler、Agent 和 Adapter 使用短期 workload credential；不共享一个永久内部 token。
- 服务凭证声明允许的 caller、audience、tenant 范围和操作；接收方仍执行 tenant、resource 和 purpose 校验。
- 入口网关删除外部传入的 tenant、role、scope、cell、route epoch 等 tracing baggage，并从已验证身份和 route document 重新生成内部上下文；trace 传播不能授予权限。
- 对象存储使用短期签名 URL，绑定 tenant、object、content type、大小、操作和过期时间。
- PSTN/CRM/Calendar webhook 保存 provider event ID、签名验证结果和接收时间；失败签名不进入业务 inbox。

### 17.2 数据分类

| 级别 | 示例 | 默认处理 |
| --- | --- | --- |
| L1 公开 | 产品帮助、公开状态页 | 可缓存，不包含 tenant 数据 |
| L2 企业内部 | 活动名称、会议标题、聚合指标 | tenant 加密存储，按 RBAC 访问 |
| L3 敏感 | tenant/campaign 绑定的加密电话引用、客户资料、字幕、授权证据、工具参数 | 字段/对象加密，日志脱敏，导出审计；明文电话不得作为跨租户全局主键 |
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

控制面通过 `GET /enterprise/v1/provider-capabilities` 返回 PSTN、CRM、Calendar
和 Channel 四类文档。已配置 Adapter 必须提供 HTTPS health probe 和服务凭据；
只有实时 probe 返回合法 `ready` 才能显示 ready。mock、缺配置、非 2xx、超时或
错误 schema 分别返回明确的 `not_ready/not_configured` 原因。probe URL、凭据和
未列入白名单的响应字段永不返回客户端；features 只保留每类能力的布尔白名单，
文档 60 秒过期，业务命令仍需重新校验。

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
| tenant/RBAC 不越权 | 九角色×全部 scope、跨租户 ID、伪造 header/body、forced-RLS user directory、RLS/复合 FK 测试 | 两真实租户并发攻击演练 |
| 命令幂等 | 相同 key 重放100次、不同 hash 冲突、API 重启恢复 | Provider webhook 重放和网络超时演练 |
| 单一状态机 | 非法迁移、CAS 冲突、迟到事件/generation 测试 | Worker/API 重启、断网恢复 |
| 不重复外部副作用 | inbox/outbox、claim、ledger 唯一约束和故障注入 | PSTN/CRM sandbox 或真实白名单账号 |
| Provider 不伪造成功 | 未配置、超时、部分响应、错误 reference contract test | 真实 credentials/readiness 证据 |
| 屏幕共享可停止 | lease、双 acquire、revoke 后旧 track 测试 | Web/iOS/Android 真机与弱网 |
| AI 不越权 | JSON Schema、Policy deny、知识无答案、工具风险矩阵 | 坐席接管和高风险人工流程 |
| 生产数据门禁 | migration、RLS、backup/restore、负载和数据对账 | PostgreSQL/PITR/cell 恢复演练 |
| 公共 Primary 收敛 | 双 manifest checksum、单 driver、无 fallback/双写、角色池和启动 fail-closed | 隔离企业库全量 migrate/verify/cutover/rollback 演练 |
| 统一通讯 tenant scope | session/leg/dispatch/provider/playback 复合约束、forced RLS、伪造 scope 和可选 owner 负向测试 | 两租户同时通话、取消、迟到事件和 cell 迁移攻击演练 |
| 企业账单归属 | tenant billing account、跨租户账单 ID、ledger/adjustment 幂等和对账测试 | 支付 sandbox、账期关闭和财务抽样对账 |
| 生产韧性 | writer fence、route epoch、旧 Worker generation、备份清单和恢复脚本测试 | 跨故障域自动切换、旧主隔离、异地主机不可变备份和 PITR |

设计评审通过不等于功能验收。任务只有在代码、自动化、目标环境证据和 `enterprise-edition-acceptance-plan.md` 对应条目齐全后才能从 `ready_for_acceptance` 进入 `accepted`。
