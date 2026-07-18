# 无界AI企业版详细技术设计

版本：v1.33
日期：2026-07-19
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
| Append-only audit | `ready_for_acceptance` | 已有 tenant-scoped 查询、HMAC cursor、成员/RBAC/租户生命周期埋点和 SQLite/PostgreSQL 不可变约束；受控导出已进入 UI-008 开发，真实 PostgreSQL 验收仍待执行 |
| PostgreSQL schema | `implemented` | 已有二十四段 up/down migration、tenant-first 索引、复合 FK、强制 RLS、user directory、cell pending projection、opaque subject identity、企业通讯/dispatch/策略、usage/billing、knowledge/terminology、observability trace、受控审计导出、Meeting 聚合/创建/翻译和屏幕共享租约；尚无真实 migrate/restore/PITR 证据 |
| Tenant-scoped Repository | `ready_for_acceptance` | 已有 tenant/user/cell scoped transaction、subject guard、单一 `legacy|postgres` runtime、HTTP 全链路注入、独立 cell Worker，以及 Tenant/Member/Audit、Directory、lifecycle、Inbox/Outbox、budget、billing/entitlement、usage accounting、knowledge、terminology 和共享 unit-of-work；尚无真实 PostgreSQL H3 证据 |
| Enterprise Inbox/Outbox | `ready_for_acceptance` | 已有 tenant-scoped 去重、稳定 payload hash、领域/inbox/outbox 原子提交、lease/retry/recovery 和100次重放门禁；真实 PostgreSQL 并发与 Provider sandbox 尚待验收 |
| SQLite/JSON 演示数据导入 | `ready_for_acceptance` | 已有维护窗口、SQLite 临时副本与 quick_check、空目标事务导入、六集合 count/SHA-256 读回对账和不一致回滚；仅限内部演示数据 |
| 公共 Primary Runtime 收敛 | `ready_for_acceptance` | 已合入上游稳定提交 `fe1c3c2`；公共31段与 enterprise 24段 manifest 由一个启动编排验证，driver、数据库身份和分权连接失败均在监听前闭合；尚无真实 PostgreSQL H3 证据 |
| 企业链路追踪 | `in_progress` | 平台 trace 已进入 tenant context、PostgreSQL session、communication binding、usage event/ledger 与会话报告；本轮未执行测试和真实 PostgreSQL 门禁，货币成本因无价格表明确 not configured |
| 企业工作台真值投影 | `in_progress` | Web 已读取 tenant/route、Provider、subscription、budget、usage aggregate 和显式 session trace report；业务聚合与价格表缺失时明确 not ready/not configured，本轮未执行自动化、浏览器或 PostgreSQL 门禁 |
| 审计与分析 | `in_progress` | Web 已接入审计筛选/详情、显式 session 下钻和受控 JSONL 导出；`0020`、Repository/API/cell Worker/加密对象存储边界已实现，本轮未执行 migration、双租户、对象存储或浏览器测试；业务聚合/价格表与物理对象清理仍未完成 |
| 公共通讯 tenant scope | `ready_for_acceptance` | 公共 manifest 已增至31段；12张通讯资源表具有不可空 scope、复合 FK、写入 guard 和 forced RLS，企业 unit-of-work 只暴露 tenant-bound 白名单 Repository；尚无真实双租户 A1/H3 证据 |
| 企业统一通讯会话绑定 | `ready_for_acceptance` | enterprise `0011` 和 tenant unit-of-work 已建立 Meeting/Support/Marketing 唯一绑定、route/policy/entitlement 快照及 generation/event-sequence 收敛状态机；尚无真实多实例、cell 迁移和 A1/H3 证据 |
| Tenant-aware Worker Dispatch | `ready_for_acceptance` | enterprise `0012` 以 scope FK/RLS 绑定公共 dispatch/capacity；短期 HMAC ticket、租户容量、lease/heartbeat、cancel/finalize 和二次 binding fence 已实现；仅有自动化和一次性本地 PostgreSQL 16 证据，尚无真实多实例/H3 容量证据 |
| 企业设备、声音和录制策略 | `ready_for_acceptance` | enterprise `0013`、发布 API、策略解析、purpose-specific 授权和 Worker policy fence 已实现；仅有自动化和一次性本地 PostgreSQL 16 机制证据，尚无真实设备/Provider、A1/H2/H3 证据 |
| Web 屏幕共享 | `in_progress` | 成员 Web 已实现真实 display surface 识别、独立最小权限发布 Room、track SID 续租、当前 generation 订阅过滤和开始/暂停/恢复/停止 UI；未执行自动化、多浏览器、弱网或真实 LiveKit 门禁 |
| 企业用量预算 | `ready_for_acceptance` | enterprise `0014` 已实现 tenant/category/unit/UTC period 预算、hold/settle、阈值告警和 ledger 不可变约束；真实并发与账务抽样待验收 |
| 租户账务和 Entitlement | `ready_for_acceptance` | enterprise `0015` 已实现 tenant billing account、不可变 plan/subscription/entitlement version、服务端账期及 binding/dispatch entitlement fence；真实支付 Provider、关账对账和 A1/H3 待验收 |
| SaaS 计量聚合 | `ready_for_acceptance` | enterprise `0016` 已实现 tenant usage event、event/ledger 一致性、append-only adjustment、负数净额保护及 count/hash/watermark 账期聚合；真实关账、支付对账和 A1/H3 待验收 |
| 企业知识版本 | `ready_for_acceptance` | enterprise `0017`、Knowledge Repository/runtime/API 已实现 source/revision/chunk/review/publish、发布后不可变、四维时间检索和稳定 citation；当前仅有确定性文本检索，本地普通角色验证不代表 embedding Provider、对象存储、恶意文档或 A1/H3 已通过 |
| 企业术语与话术版本 | `ready_for_acceptance` | enterprise `0018`、共享契约、Term Pack/Script Template Repository/runtime/API 已实现稳定资源、递增 revision、review/publish、有效期解析、hash 校验和同一术语版本运行时引用；仅有自动化和本地 PostgreSQL 16 普通角色证据，真实 Worker/Provider、A1/H3 未通过 |
| Primary 全量切换/恢复证据 | `ready_for_acceptance` | 工具按运行时动态校验 manifest/全业务表；`c9b5be2` 历史证据为31+16/81张表，当前31+24/88张表必须重新生成签名证据；异地 WAL/PITR/H3 未通过 |
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
  role, language, caption_language, translated_audio_enabled,
  playback_generation, display_name, joined_at, left_at, version
)

meeting_translation_events(
  id, tenant_id, meeting_id, communication_session_id, dispatch_grant_id,
  route_epoch, generation, event_key, event_type,
  source_participant_id, source_display_name, source_track_sid,
  target_participant_id, segment_id, revision,
  source_language, target_language, source_text, caption_text,
  translated_audio_enabled, translated_audio_status,
  playback_generation, occurred_at, created_at
)

meeting_screen_shares(
  id, tenant_id, meeting_id, participant_id, communication_session_id,
  route_epoch, generation, track_sid,
  source_type, includes_system_audio, quality_mode,
  status, lease_expires_at, started_at, paused_at, ended_at,
  idempotency_key, request_hash, created_at, updated_at, version
)

meeting_screen_share_commands(
  id, tenant_id, meeting_id, share_id, command, actor_id,
  idempotency_key, request_hash, expected_version,
  result_status, result_version, result_generation,
  revoked_generation, created_at
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
enterprise_term_pack_versions
enterprise_script_templates
enterprise_script_template_versions
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

enterprise.communication_policy_versions(
  id, tenant_id, version, status, execution_config,
  sensitive_feature_config, published_by, published_at, retired_at
)

enterprise.communication_authorization_evidence(
  id, tenant_id, purpose, subject_ref, evidence_hash,
  granted_at, expires_at, revoked_at, policy_version
)

enterprise.communication_policy_snapshots(
  id, tenant_id, binding_id, policy_id, policy_version,
  route_epoch, generation, asr_engine, translation_engine, tts_engine,
  voice_identity_enabled, recording_enabled, diagnostic_audio_enabled,
  authorization_evidence_ids, allowed_capabilities, runtime_state,
  provider_fingerprints, readiness_expires_at, status, invalidated_at
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

每次 dispatch 只引用一个与 binding generation/route epoch 完全匹配的不可变策略快照。
策略发布后只能退役，授权证据只能撤回；撤回 trigger 会立即 invalidated 引用该证据的活动快照。
快照保留当时的引擎选择、敏感能力决策、Provider/device fingerprint 和 readiness 有效期，
以便 Worker 重启后仍能验证原决策，而不是重新解释客户端配置。

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
GET    /enterprise/v1/knowledge/sources/:sourceId/versions
POST   /enterprise/v1/knowledge/sources/:sourceId/versions
PUT    /enterprise/v1/knowledge/versions/:versionId/chunks
POST   /enterprise/v1/knowledge/versions/:versionId/publish
POST   /enterprise/v1/knowledge/search
GET    /enterprise/v1/terminology/packs
POST   /enterprise/v1/terminology/packs
GET    /enterprise/v1/terminology/packs/:packId/versions
POST   /enterprise/v1/terminology/packs/:packId/versions
PUT    /enterprise/v1/terminology/pack-versions/:versionId/content
POST   /enterprise/v1/terminology/pack-versions/:versionId/publish
GET    /enterprise/v1/script-templates
POST   /enterprise/v1/script-templates
GET    /enterprise/v1/script-templates/:templateId/versions
POST   /enterprise/v1/script-templates/:templateId/versions
PUT    /enterprise/v1/script-template-versions/:versionId/content
POST   /enterprise/v1/script-template-versions/:versionId/publish
POST   /enterprise/v1/runtime-terminology/resolve
GET    /enterprise/v1/audit-events
POST   /enterprise/v1/communication-policies
```

通讯策略发布要求 `tenant:write` 和有效签名 route document；请求体 tenant 与当前 membership
不一致时拒绝。接口只在 verified PostgreSQL runtime 可用，legacy/SQLite 明确返回
`enterprise_postgres_required`，不会把内存或演示写入伪装为已发布企业策略。

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
PUT    /enterprise/v1/meetings/:meetingId/translation-preference
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

### 8.1 数据和状态机

`knowledge_sources` 表示租户内稳定的逻辑来源，名称在未归档 source 中大小写不敏感唯一；
`knowledge_versions` 的 revision 在 source 行锁内由服务端递增，客户端不能指定；`knowledge_chunks`
以 `(tenantId, knowledgeVersionId, blockId)` 和 sequence 双唯一保存有序分块。三表均使用复合 tenant FK、
forced RLS 和 tenant transaction。

允许的首批路径为 `draft -> review -> published`。chunk 集只能在 draft 中一次性插入，提交成功后同时
写入逐 chunk SHA-256、长度前缀聚合 content hash、review actor/time 并递增 optimistic version。
publish 要求当前状态 review、expectedVersion 命中、至少一个 chunk、审核/发布 actor 与生效窗口齐全；
数据库 trigger 再次执行相同不变量。published/expired version 和任何 chunk UPDATE 均失败，不能为修正
内容改写历史版本。

### 8.2 API 和权限

- `POST/GET /enterprise/v1/knowledge/sources`
- `POST/GET /enterprise/v1/knowledge/sources/:sourceId/versions`
- `PUT /enterprise/v1/knowledge/versions/:versionId/chunks`
- `POST /enterprise/v1/knowledge/versions/:versionId/publish`
- `POST /enterprise/v1/knowledge/search`

所有路由先解析 active membership，再校验 `knowledge:read|knowledge:publish` 和签名 tenant route
document；请求体中的 tenantId 只允许与服务端上下文相同。legacy/SQLite runtime 不持久化企业知识，
明确返回 `enterprise_postgres_required`。create/review/publish 写入 append-only audit。

### 8.3 检索和引用

检索固定叠加 `tenantId + locale + countryCode + productCode + serverNow`，country/product 允许显式
`ALL/all` source 作为租户内通配版本。SQL 只选择 `status=published`、已生效且未过期的版本，并以
`DISTINCT ON (sourceId)` 取每个 source 的最高 revision；draft、processing、review、failed、未来和
过期版本不会进入候选集。返回 citation 固定为 `knowledgeVersionId:blockId`，业务会话只保存 citation
和必要证据，不保存完整敏感提示词；后续发布新 revision 不改写历史引用。

当前代码没有伪造 embedding readiness：未配置 embedding/向量 Provider 时仅执行大小受限的确定性
文本匹配。向量生成、恶意文档扫描、对象存储内容提取和召回质量门禁必须作为后续 Provider/验收证据，
不能从 `ENT-CORE-004` 本地结果推导为已完成。

### 8.4 一致性和限制

单次 chunk 提交限定1..200块、单块最多12000字节、总内容最多1MB，blockId 唯一；revision 创建、
chunk 审核和发布分别使用 source/version 行锁及 expectedVersion，冲突不产生半成品。Repository SQL
除 forced RLS 外仍显式包含 `tenant_id = $1`；批量 `INSERT ... SELECT` 也通过 tenant scope 子查询满足
SQL fence。任何 Provider 未配置、检索无证据或结果为空时，上层必须明确降级并提供人工路径。

### 8.5 术语包、话术模板和统一运行时引用

`term_packs` 和 `script_templates` 是租户内稳定资源；`term_pack_versions` 与
`script_template_versions` 保存不可复用 revision。创建 version 时分别锁定稳定资源行并由服务端
分配 revision；客户端不能指定 revision、tenant、审核/发布 actor 或 content hash。

术语版本以 `sourceLocale + targetLocale + countryCode + productCode + usageScope` 解析，最多500条、
总 JSON 不超过1MB；term ID 和原词在包内唯一。话术版本以 `locale + countryCode + productCode` 解析，
模板稳定资源另存 purpose；提示文本、必说语、禁语和变量经过数量、大小、重复和交叉冲突校验。
服务端规范化内容并计算 SHA-256。

两类版本只允许 `draft -> review -> published`。评审时一次性写入内容、hash、review actor/time；发布
要求 expectedVersion、审核元数据、publisher、effectiveFrom 和合法 expiresAt。数据库 trigger 冻结
身份/维度/revision，禁止评审后更改内容或 hash，并禁止更新/删除 published/expired 版本。

运行时 resolver 强制叠加 `tenantId + locale + country + product + purpose + serverNow`，只选择当前有效
published revision 并重新计算内容 hash。返回 context 的顶层、`asr`、`translation` 和 `llm` 使用同一
`termPackVersionId`；可选 `scriptTemplateVersionId` 只进入 LLM 引用。任一资源处于 draft/review、未来、
过期、跨租户、用途不匹配或 hash 不一致时失败闭合，不回退旧草稿，也不把未配置外部 Provider 标记成功。

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
- Worker dispatch ticket 必须携带服务端签名的 `tenantId + communicationSessionId + cellId + routeEpoch + generation + capability + policySnapshotId + policyVersion + expiresAt`；Worker 不接受缺 scope、过期、跨 cell、策略不匹配或授权失效的裸任务。

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
但尚未在真实企业 PostgreSQL、两个真实租户、多实例 Worker 或 cell 迁移环境执行。该会话绑定和
下述 dispatch 实现均只能标记 `ready_for_acceptance`，不能宣称 A1、H3、企业试点或生产门禁通过。

第十二批完成 `ENT-CORE-014` Tenant-aware Worker Dispatch。enterprise `0012` 新增
`worker_dispatch_grants`，用 tenant/session 复合 FK 绑定当前 communication binding，并用 scope FK
绑定公共 `worker_dispatches` 与 `worker_capacity_reservations`。grant 固化 capability、cell、route
epoch、generation、idempotency/request hash 和最多五分钟有效期；身份字段不可变，表启用 forced RLS。

签发入口不接收客户端 tenant/cell/route/generation baggage，而是在 tenant transaction 锁定租户与
当前 binding 后派生 ticket，并以租户级容量统计、lease 和唯一 generation fence 原子创建公共记录与
grant。ticket 使用至少32字节密钥的 HMAC，签名覆盖 ticket/tenant/session/cell/route epoch/
generation/capability/issuedAt/expiresAt；篡改、弱密钥、未来票据、过期和五分钟以上 TTL 均失败闭合。

Worker accept、heartbeat、每次副作用授权和 finalize 都先验签，再按签名 tenant 建立 Repository context，
重读并锁定 grant、当前 binding、公共 dispatch 和 capacity lease。错误 tenant/cell/capability、旧 route/
generation、过期 lease、取消或终态均不能更新公共状态。取消在同一事务把 grant 置为 cancelled、公共
dispatch 置为 failed 并释放 capacity；迟到 finalize 只返回 fenced 状态。一次性本地 PostgreSQL 16
普通角色验证了 `created -> accepted -> authorized -> cancelled`、错误 cell、取消后迟到结果、跨租户
RLS 0行可见/0行可写及 `0012` down/forward；该证据不是目标 H3、多实例或生产容量验收。

第十三批完成 `ENT-CORE-015` 企业设备、声音和录制运行策略。enterprise `0013` 新增
`communication_policy_versions`、`communication_authorization_evidence` 和
`communication_policy_snapshots` 三张 forced-RLS tenant 表，并把 dispatch grant 升级为必须引用
具体 policy snapshot/version。策略版本发布后不可改写，只允许 published 到 retired；授权证据按
`voice_identity`、`recording`、`diagnostic_audio` 三种 purpose 保存 hash、期限和撤回状态，不能跨目的复用。

`POST /enterprise/v1/communication-policies` 只允许 `tenant:write`，校验 membership、请求 tenant 和签名
route document，并在 PostgreSQL unit-of-work 内原子发布版本与审计事件。策略解析器以当前 binding 的
route epoch/generation、有效 Provider/device readiness 和 purpose-specific 授权生成不可变快照；端侧/云端
ASR、翻译、TTS 缺配置、fingerprint 或 readiness 过期时只返回 `captions_only`、`half_duplex` 或 `blocked`，
不能伪造可用。legacy/SQLite 接口失败闭合为 `enterprise_postgres_required`。

Worker dispatch ticket 升级为 v2，并将 `policySnapshotId + policyVersion` 纳入 HMAC。签发、accept、heartbeat、
副作用授权和 finalize 都重读策略快照；快照失效、readiness 过期、capability 未授权或敏感授权撤回时，
在 capacity/dispatch 副作用前拒绝。数据库 revoke trigger 会立即 invalidated 引用证据的活动快照，同时保留
历史冻结字段以供审计。一次性本地 PostgreSQL 16 普通角色验证了 13 段 forward、forced RLS 跨租户 0 行、
撤回即失效、不可变 trigger、`0013` 单段 down/forward 和恢复校验；该证据只说明机制可执行，不代表真实
设备/Provider、双租户 A1、H2/H3、企业试点或生产门禁通过。

#### 11.1.2 Primary 全量切换、对账与恢复证据

`ENT-DATA-009` 的维护工具在 `REPEATABLE READ READ ONLY` 快照内枚举 `ai_phone` 与
`enterprise` 全部业务表（排除 migration 元表），要求每张表存在主键，按复合主键
keyset pagination 读取 `to_jsonb(row)` 规范文本。每行以字节长度前缀加入 SHA-256，
形成 table count/hash/last-key hash，再汇总公共31段、企业21段 checksum、8张关键表、
总行数和全库 hash。维护账号必须是受审计的 superuser 或 `BYPASSRLS` 全读角色，不能复用
tenant/directory/cell 应用凭证。

证据分为 `baseline`、`cutover`、`restore` 三类，并用独立 HMAC key 签名、以 `0600`
临时文件原子替换。证据身份包含 run/cutover ID、local/staging 环境、Git commit、image digest、
topology hash、数据库 system identifier/OID、snapshot 和 WAL LSN。`cutover` 必须引用已验签
baseline 文件 hash，验证源库默认只读、写探针返回 SQLSTATE `25006`、旧 writer 角色在集群中
无会话、目标默认可写且写探针成功，再对源/目标执行第二次全量 manifest。任何表缺失、数量、
整行 hash、主键、migration 或 server version 不一致都会生成签名 `mismatch` 并以非零退出。

生产 startup gate 只接受 `environment=staging` 的 matched cutover evidence，且运行时
commit/image/topology、cutover ID、target logical ID、当前 system identifier/OID 和31+24
manifest 必须逐项一致。本地 PostgreSQL 16 演练已验证81张表、8张含记录关键表、增量后17行
全库 hash、writer fence、隔离 `pg_dump/pg_restore` 和单行篡改失败；证据见
`docs/evidence/ent-data-009-local-drill-2026-07-18.md`。这只证明机制可执行，不是异地主机
不可变 WAL/PITR、跨故障域自动选主或 RPO/RTO 证据，后者仍属于 `ENT-REL-003`/H3。

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
retention 窗口和受控审计导出的创建/下载已由 `ENT-UI-008` 实现；业务表/对象清单、
对象物理删除和 Provider 删除收敛继续由 `ENT-REL-002` 完成，不能仅凭基础 lifecycle job 和本地审计代码宣称
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

### 13.1 第一批企业用量预算实现（ENT-CORE-007）

enterprise migration `0014_enterprise_usage_budgets` 增加 `usage_budgets`、`usage_holds` 和
`usage_budget_alerts`，并为既有 `usage_ledger` 增加 entry type、budget/hold 引用、稳定 source ref、
request hash 和 recorded time。三张新表均 forced RLS；ledger/alert 由 trigger 拒绝 UPDATE/DELETE，
hold 的身份字段不可变且只能从 `held` 单向进入终态。

预算键为 `tenant + category + unit + UTC period`。reserve 在 tenant 行锁内依次过期旧 hold、汇总已
settle ledger 和有效 hold，再决定是否创建新 hold；超过上限在任何 Worker/capacity 副作用前拒绝。
settle 锁定同一 tenant 与 hold，校验实际量不超过预留量，并在同一事务追加唯一 ledger 后推进 hold。
相同幂等键只有 request hash、hold 和 amount 全相同才重放；阈值告警以
`tenant + budget + threshold` 唯一，只追加一次。外部预算 API 使用 `billing:read/write`、active
membership 和签名 route document；演示存储返回 `enterprise_postgres_required`。

本批只完成用量分类、预算、hold/settle 和告警，不提前宣称套餐 entitlement、账期聚合或支付结算完成；
这些边界分别由 `ENT-CORE-010/012` 收敛。

### 13.2 租户账务和版本化 Entitlement（ENT-CORE-010）

enterprise migration `0015_enterprise_billing_entitlements` 增加 forced-RLS `billing_accounts`、
`billing_plan_versions`、`entitlement_snapshots` 和 append-only
`billing_subscription_changes`。每个 tenant 只有一个 billing account；活动 subscription 以部分
唯一索引限制为一个。plan version、entitlement snapshot 和 subscription identity 由 trigger
拒绝改写/删除，entitlement projection、communication binding 和 Worker grant 均以 tenant
复合外键绑定精确 snapshot/version。

`POST /saas/v1/tenants/:tenantId/subscription/change` 只接受服务端已发布 plan 的 code/version、
席位数、billing cycle 和幂等键；账期起止和 entitlement map 由服务端生成。tenant 行锁串行化
变更，席位超过 plan limit、账户非 active、plan 退役或同键不同 hash 均在写入前拒绝。同一事务
退役旧 subscription/snapshot、创建新版本、替换 entitlement projection、追加 change history、
更新 tenant plan 并写审计。

新 communication binding 从当前活动 entitlement 读取并冻结 version。Worker dispatch ticket v3
携带该 version，签发时再次核对 billing account、与 snapshot 对应的活动 subscription、服务端
账期、plan identity、effective window 和 capability limit；请求不再接受客户端 `maxUnits`。
legacy/SQLite 返回 `enterprise_postgres_required`。本批没有支付、开票、退款 Provider；原始
usage event、账期聚合和 adjustment 由后续 `ENT-CORE-012` 实现，见 13.3。

席位按账期快照计费，用量按租户时区之外的统一 UTC 账期切分，避免时区修改导致重复计费。

企业账单的授权和归属主键是 `billing_account_id + tenant_id`，付款人 subject 只是该
账单账户的受控联系人，不能替代 tenant。来自主产品的 `user_id` 个人订阅、余额或账单
记录不得通过 ID 映射直接升级为企业账单；迁移必须生成 tenant billing account、期初
余额/权益快照和可对账 adjustment，并保留源记录哈希和审计引用。

### 13.3 不可变 Usage Accounting（ENT-CORE-012）

enterprise migration `0016_enterprise_usage_accounting` 增加 forced-RLS
`tenant_usage_events`、`usage_adjustments` 和 `usage_period_aggregates`，并为
`usage_ledger` 增加唯一 `usage_event_id`。原始 event 和 adjustment 使用 append-only trigger；
event 与 settle ledger 通过双向延迟复合外键和 deferred constraint trigger，在事务提交时逐字段核对
tenant、billing account、budget/hold、category/unit/amount、source、hash、时间、metadata 和 event ID。

通用 `recordUsageEvent` 先锁 tenant、读取活动 billing account，再同事务写 event/settle ledger；
budget hold 的 settle 路径复用相同写入器，因此不会出现“hold 已结算但原始 event 缺失”的新记录。
相同 tenant/idempotency key 只有请求 hash 和核心字段完全一致才重放；同键不同载荷拒绝。

`adjustUsage` 只存在于内部 Repository runtime，不暴露租户自助写 API。它锁 tenant 和目标 settle
ledger，服务端生成 request hash，追加 adjustment ledger 与 adjustment record，并写 actor 审计；
数据库 trigger 再次核对目标/调整流水的 account、category、unit、amount、source、hash 和时间，
按目标行锁串行汇总历史 delta，累计净额小于零时失败闭合。任何流程都不得 UPDATE/DELETE 原始 event、
settle ledger 或 adjustment。

`rebuildUsagePeriod` 以 `tenant + billing account + category + unit + [periodStart, periodEnd)` 查询
ledger，按 `occurred_at,id` 稳定排序，计算 settle/adjustment/net、usage event/settlement/
adjustment/ledger 四类 count、最新 recorded watermark
和带长度分隔的 SHA-256 ledger hash。聚合表只允许 identity 不变、version 加一、computed time 与
watermark 单调前进的更新；调用方可用 expected version 拒绝并发覆盖。公开
`GET /enterprise/v1/usage/aggregates` 只允许 active membership、`usage:read` 和有效签名 route
document，SQLite/JSON 明确返回 `enterprise_postgres_required`。

本批本地 PostgreSQL 16 证据只覆盖 migration、forced RLS、不可变/一致性/负净额 guard、runtime
和 count/hash 对账机制。它不连接支付、开票或退款 Provider，也不替代 A1、H3、真实关账或生产验收。

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

## 19. 企业链路追踪、质量与成本报告

入口 API 在 `onRequest` 创建或继承 W3C trace，并以安全的 `x-trace-id` 返回。Enterprise route 不再把
Fastify request id 当作业务 trace：`EnterpriseTenantContext.traceId` 统一读取当前平台 trace，tenant
PostgreSQL transaction 同时设置 `app.trace_id`。外部 baggage 不能写入 tenant、role、scope、cell 或
route epoch，trace 只用于关联，永不参与授权。

enterprise migration `0019_enterprise_observability_trace` 为
`communication_session_bindings`、`tenant_usage_events` 和 append-only `usage_ledger` 增加不可空
`trace_id` 与 tenant-first index。新 usage event 与 settle ledger 在同一事务写入同一 trace，数据库
deferred consistency trigger 逐字段连同 trace 一起核对；调整 ledger 也保存发起调整的 trace。历史记录
只能标记为 `legacy`，不能编造不存在的父链路，报告不会用 `legacy` 关联审计事件。
outbox publisher 在 API 线程外执行时，处理器从不可变 outbox event 恢复原 trace 到异步上下文；Provider
operation 和 finalize 继续使用该业务 trace，Worker poll/claim trace 只描述 Worker 自身调度，不覆盖父链路。

`GET /enterprise/v1/observability/sessions/:sessionId/report` 需要 `audit:read`，Repository 在 tenant
transaction 和公共通讯 forced RLS 下读取：

- 精确 communication binding、policy version、entitlement version 和创建 trace；
- 每个 segment 最新 revision 的翻译覆盖率、实际 latency 样本、平均值与 p95；无 segment 时返回
  `quality.status=no_samples`，所有比率/延迟为 null 或 0 样本，不绘制假趋势；
- tenant usage event、对应 immutable ledger ID、category/unit/amount/source/trace；
- Provider operation 的类型、状态、trace 和起止时间，以及同 trace 的脱敏审计事件。

当前 billing plan 只有币种、套餐和 entitlement，没有按 category/provider/version 生效的单位价格表。
因此报告的 `monetaryCost.amount` 固定为 null，状态为 `not_configured`，reason 为
`pricing_not_configured`；usage amount 只能解释为秒、帧、字符或 token，不能显示为账单、余额或货币成本。
后续若引入定价，必须版本化价格、有效期、币种、舍入规则和 Provider 归属，并以不可变 ledger 重算对账，
不能在 UI 端估价。

### 19.1 企业工作台真值投影

`ENT-UI-004` 不建立第二套 Dashboard 聚合存储。当前 Web 分别读取 tenant context/route document、Provider
capability、billing entitlement、usage budget、UTC period aggregate，以及需要 `audit:read` 的单会话报告；
每类资源独立保留 loading/ready/failed 状态，缺少 `billing:read`、`usage:read` 或 `audit:read` 时不发起对应请求。

预算告警只在 budget 与 aggregate 的 `category + unit + periodStart + periodEnd` 全部一致时计算百分比，禁止把秒、
字符、token 或帧相加。用量表逐行显示不可变 ledger 聚合；无记录时显示 empty，不补零或绘制趋势。会话质量只按
用户明确输入的 session ID 查询，当前没有“最近会话”列表 API，因此前端不得猜测最新会话。营销、客服和会议的
服务端聚合尚未交付，业务状态区固定显示 not_ready；货币成本继续使用报告的 `pricing_not_configured`，前端不估价。

本批只完成静态 typecheck 和 Enterprise Web 生产构建，尚未执行 component/API/browser/PostgreSQL 验证，任务保持
`in_progress`。

本批尚未运行 migration up/down、双租户攻击、API/Repository 自动化、真实 Provider 和 H1 长稳，任务保持
`in_progress`，不能宣称企业生产门禁通过。

### 19.2 审计查询与受控导出

`ENT-UI-008` 复用 append-only audit，不建立可编辑的审计副本。事件列表继续使用与 tenant、action、
resource type、result 绑定的 HMAC cursor；Web 只默认缩略 actor/resource 标识，完整 trace 仅在详情中显示。
审计详情在写入层只允许有限 primitive 字段，并拒绝 token、secret、password、authorization、idempotency、
phone 和 URL 类键；导出读取同一批已过滤记录。

`POST /enterprise/v1/audit-exports` 要求 `audit:export`、有效 tenant route document 和 idempotency key。
请求固定目的、半开 `[from, until)` 范围、可选 action/resource/result 和1至30天保留期；范围最长31天。
enterprise migration `0020_enterprise_audit_exports` 保存不可变请求与终态、forced RLS、tenant-first index，
并把 processing job 投影到 cell-scoped pending work。Repository Worker 在 tenant transaction 中重新读取范围，
最多接受10000条事件和10MiB JSONL，写入 manifest + event records 后保存 event count、size、SHA-256、
expiresAt 和终态审计。重试使用 lease/attempt fence，永久失败不伪造完成。

artifact store 只有在 `ENTERPRISE_AUDIT_EXPORT_ENABLED=true` 且加密 S3 配置完整时生产可用；凭据使用
SDK 默认链/工作负载身份，或同时提供 Access Key 与 Secret Key，禁止只配置其中一项；
`ENTERPRISE_AUDIT_EXPORT_LOCAL_DIR` 仅允许非生产封闭演示。API 下载不返回 bucket、object key 或凭据，
而是重新执行 membership/RBAC/route guard，从对象存储读取后同时核对数据库 size/hash 与实际 SHA-256，
并记录 completed/failed/denied 下载审计。到期对象返回410；S3 Expires 元数据不等于物理删除证据，
真实 purge、对象清单和恢复对账继续由 `ENT-REL-002/003` 验收。

数据分析页当前只支持用户明确输入 session ID 的质量、Provider、usage/ledger 与 trace 下钻。
会议/客服/营销聚合 API 和版本化单位价格表未实现，页面固定显示 not_ready/not_configured，
不补零、不拼客户端估算、不绘制示例趋势。本批按指令未执行测试，任务保持 `in_progress`。

### 19.3 响应式、主题与无障碍运行时

`EnterpriseThemeProvider` 只管理客户端显示偏好 `system|light|dark`，使用固定版本的 localStorage key；
解析结果写入根节点 `data-theme` 和 `color-scheme`。system 模式监听系统色彩变化，存储不可用时降级为 system，
不把主题写入 tenant、member、API 或审计数据。浅深色语义继续复用 Flutter 品牌令牌，小字号风险前景使用单独
`color-signal-text`，避免改变品牌 Signal 色本身。

壳在960px以下用顶部 tenant selector 替代被折叠的侧栏 selector，600px以下使用可横向滚动且保留文字的底部主导航。
页面内容容器始终 `min-width: 0`；高密度表格和设置导航在自身容器滚动并可键盘聚焦，禁止用页面级隐藏溢出掩盖
布局错误。字号、行高、控件、顶部栏和侧栏基准改用 `rem`，默认视觉尺寸不变；路由切换后主区域获得程序化焦点，
壳提供 skip link，普通交互使用 `:focus-visible` 两像素主色焦点环。原先不完整的 tab ARIA 改为普通
`aria-pressed` 按钮组，数据表增加 caption，图标按钮保持可访问名称。

以上只构成 AC-UI-008/009/010 的代码候选。本批未执行真实浏览器、320/600/960/1280/1440 截图、200% 缩放、
动态字体、横屏、键盘流程、axe、forced-colors 或视觉回归，任务保持 `in_progress`。

### 19.4 Web release gate 与客户端遥测

Enterprise Web release matrix 固定九角色、八页面状态、320/600/960/1280/1440、light/dark 和
Chromium/Firefox/WebKit；Vitest 负责状态/契约，Playwright 负责 route discovery、直接 URL、页面溢出、主题持久化、
动态字体、键盘、axe 和截图。视觉 snapshot 缺失或差异超过0.5%、任一浏览器失败、测试被 `only`、初始 JavaScript
超过512KiB、全部按需 JavaScript 超过1MiB、CSS超过96KiB，或存在 source map/fixture/debug code/本地或内部地址/密钥时，
release candidate 失败闭合。LiveKit 只在用户入会时动态加载，不能回灌控制台首屏包。
发布 version/commit 必须编译进入 bundle、匹配 clean Git HEAD；CI 使用 Node 24 并保留 trace、截图、视频和 JSON/HTML 结果。

浏览器只上报 `kind/code/path/appVersion/releaseCommit/occurredAt` 及本地 SHA-256 截断 fingerprint，或有界 performance
metric；message、stack、query、tenantId、token 和任意额外字段不发送。`POST /enterprise/v1/observability/client-events`
要求 Bearer、active membership、`tenant:read` 和当前签名 route document，服务端补 tenant/homeRegion/cell/routeEpoch/
actorRole/traceId 后写结构化 error/info 日志。遥测传输失败被吞掉，不能递归产生用户可见错误或伪造上报成功。

当前只完成自动化与门禁实现、typecheck、生产构建和静态扫描；未运行测试、未生成视觉基线、未验证 CI artifact，
因此 `ENT-UI-010` 保持 `in_progress`。

### 19.5 Flutter 企业工作区入口

个人版 `MainShellPage` 继续保留同传、通话、Lens、记录和我的导航；企业版不替换个人导航，而是从“我的”进入独立
`EnterpriseEntryPage`。入口只复用账号 Bearer 会话，不复用个人同传、Call Link 或 AI 代打的资源与成功状态。
会话不存在、格式无效、过期或 API 返回401时，客户端同时清理账号会话和已选 tenant；网络错误不恢复缓存工作区。

进入状态机依次读取 `/enterprise/v1/tenants`、短期 `/saas/v1/tenants/:tenantId/route`、tenant-scoped
`/enterprise/v1/me` 和 `/enterprise/v1/provider-capabilities`。单一 active membership 可自动进入；多租户在没有仍然
有效的本地选择时必须显式选择。工作区创建前核对 selected/context member identity、active 状态、tenant、region、
cell、route epoch、expiry、非本地 HTTPS/WSS URL、非空签名和 capability region/status；任一不一致失败闭合。本地只在
完整校验成功后持久化 tenant ID，scope 与 route document 不落本地作为授权真值。

`EnterpriseShellPage` 由工作台、会议、接管、告警和我的组成，统一使用 Material `NavigationBar` 和 outlined/filled
图标对。会议只在 `meeting:read` 时发现，接管只在 `support:takeover` 时发现；入口隐藏不替代服务端 guard。当前
工作台只展示 tenant/route/scope/Provider document，告警只从 tenant 状态和非 ready capability 派生。会议页把完整
route document 用 base64url JSON 放入 `x-enterprise-route-document`，从 route 的 `apiBaseUrl` 读取租户 Meeting 列表并
换取短期 RTC grant；独立 `EnterpriseMeetingRoomClient` 只启用麦克风和远端音频订阅，不复用个人 Call Link 客户端。
接管队列 API 尚未实现，继续固定 `not_ready`。

本批仅通过 Flutter 静态分析；未运行 test、build、真机、动态字体或横竖屏，故 `ENT-UI-011` 保持 `in_progress`。

### 19.6 Web 访客参会壳

公开路由固定为 `/join/:meetingId#token=<opaque>`，在 React 路由最外层优先匹配，完全绕过成员
`AuthProvider/AppShell`。因此访客页不会恢复账号 session、请求 membership/tenant route、渲染企业导航或暴露成员数据。
meeting ID 只接受8至128位 URL-safe 标识；guest token 只接受32至4096位不含空白的 URL-safe opaque 值。
query token 一律拒绝，避免被服务端 access log/referrer 捕获；fragment 读取后立即用 `history.replaceState` 清除地址栏，
清除失败即失败闭合。凭据只驻留当前 JavaScript 内存，不写 local/session storage、不显示、不记录。

访客点击入会后才把内存中的邀请提交给 `/enterprise/v1/meetings/:meetingId/guest-join`。成功响应必须为 LiveKit、
meeting ID 与路径一致、未过期，并声明 microphone/subscribe=true、camera/data/screenShare=false；随后独立
`EnterpriseMeetingRoomClient` 才连接 RTC 并申请麦克风。原始异常、token 和 access token 均不显示或记录。
字幕现由 `ENT-MTG-003` 的 tenant-aware topic、target participant 和 generation 绑定消费；运行时未就绪时明确
`not_ready`，不生成示例字幕。`ENT-MTG-005` 只向已认证成员 Web 接入共享采集；访客 grant 继续固定
`screenShare=false`，ReplayKit 仍等待 `ENT-MTG-006`。当前未执行 token/ticket 攻击、四人媒体、
浏览器权限、弱网、axe 或设备矩阵，`ENT-UI-012` 保持 `in_progress`。

### 19.7 Meeting 创建、邀请和短期入会授权

成员端 API 为 `GET /enterprise/v1/meetings`、`GET /enterprise/v1/meetings/:id`、
`POST /enterprise/v1/meetings`、`POST /enterprise/v1/meetings/:id/invitations` 和
`POST /enterprise/v1/meetings/:id/join`。全部先解析 active membership，再校验 `meeting:read|write` 与签名 route；
body 中可选 tenantId 只能与上下文相同。公开 guest-join 不接受 tenant header，而是先验证密文邀请，再从已认证 claims
派生 tenant context，避免由访客提供租户归属。

创建请求必须携带 `Idempotency-Key`。`0022` 给 Meeting 增加 tenant-scoped creation key/request hash 唯一约束并把
policy 收紧为 `allowGuests + screenShareRole + optional defaultLanguage`；历史不合规 policy 在 migration 中降级为
`allowGuests=false, screenShareRole=host_only`。同一事务锁定 tenant，要求 active tenant/cell、当前 published
communication policy 和 active entitlement，然后写 Meeting、host participant、communication binding、audit 与
`meeting.provision.requested` outbox。相同 key+hash 返回 replay，不同 hash 返回409；任何前置条件或 binding 失败都不
留下部分 Meeting。

访客邀请由 `ENTERPRISE_MEETING_INVITE_SECRET` 派生 AES-256-GCM key，使用独立 AAD，密文绑定 tenant、meeting、
participant、guest role、issuedAt、expiresAt 和 tokenId，默认600秒、允许60至1800秒。服务端验证 AEAD、结构、时间窗和
路径 meeting ID 后，才读取对应 guest participant。邀请写入也要求 Idempotency-Key，并以 tenant+meeting+key 唯一；
相同 actor/body hash 重放复用 participant 并签发新短期密文，异 hash 返回409。邀请密钥未配置时返回
`meeting_not_ready`，且不会先落 participant 或生成调试 token。

RTC grant 只在 binding 与当前 tenant route/cell/epoch 一致且 communication session 非 terminal 时签发。
`CALL_ROOM_PROVIDER=livekit`、WSS route、`LIVEKIT_API_KEY/SECRET` 缺一即失败闭合；默认 TTL 120秒、上限300秒。
LiveKit identity/metadata/attributes 绑定 tenant、meeting、communication session、participant 和 role，VideoGrant 只允许
加入指定 room、订阅和发布 microphone source，明确禁止 data、camera 与 screen share。owner/admin/meeting_host/member
可作为成员入会，auditor 被拒绝；只有 host 可在预约时间前15分钟内把 scheduled CAS 到 provisioning；guest 必须使用
预创建 participant 和精确邀请。token 签发成功/失败只审计 participant/role/reason，不审计 token 内容。

以上是 `ENT-MTG-002` 代码候选，不代表动态授权矩阵、forced-RLS、真实 LiveKit、浏览器或真机已验证；任务保持
`in_progress`。

### 19.8 企业会议实时翻译运行时

`0023` 给 participant 增加 `caption_language`、`translated_audio_enabled` 和独立递增的
`playback_generation`，并创建 forced-RLS、append-only 的 `meeting_translation_events`。事件唯一键绑定
dispatch grant/generation、source participant/track、target participant、segment/revision 和文本 hash；Worker
重试只能读回同一条记录，不能重复追加或跨 target 复用。

成员或访客 join 在签发 RTC grant 前调用 `prepareMeetingTranslation`：服务端读取当前 meeting/binding，按
`ENTERPRISE_MEETING_RUNTIME_READINESS_JSON` 解析 ASR/翻译/TTS readiness，冻结 communication policy snapshot，
原子签发 `translation_runtime` grant/capacity lease 和 HMAC v3 ticket，再由 LiveKit server dispatch 指定
enterprise agent。任一配置、secret、readiness、policy capability 或 dispatch 缺失时只把翻译状态降为
`not_ready`，不阻断基础音频入会，也不伪造 Worker ready。

企业 Translation Agent 按 participant identity `ent:<participantId>:<role>` 和 track SID 建立独立 Speech Pipeline；
不把多人音频映射成 host/guest 两条共享队列。Worker 通过强内部鉴权依次调用 snapshot、heartbeat、credential
refresh、events 和 finalize；每一步由 API 验证 ticket 签名并在 tenant transaction 中重读 grant、cell、lease、
route epoch、generation、policy snapshot 和 meeting binding。heartbeat 不再复用 accept；短期 ticket 轮换只允许
accepted grant 在 readiness 有效期内延长，旧凭证不能继续提交副作用。

Worker 只提交 `transcript.final|translation.final`。Repository 先确认 source participant 已加入且未离开，再按每个
active target 的 `caption_language` fan-out：原文只发给 source language 目标，译文只发给 target language 目标。
落库成功后 API 使用 LiveKit server SDK、固定 topic `wujie.enterprise.meeting.translation.v1` 和单一
`destinationIdentity` 发布可靠 data packet。Web/Flutter 只接受无 remote participant sender 的服务端包，并复核
topic、meeting、communication session、target participant、generation、playback generation、语言、eventId 和大小；
最多保留有界字幕窗口并去重。

当前没有可证明的 per-target audio track/订阅授权实现，因此 `translatedAudioAvailable=false`；请求译音只记录偏好，
翻译事件写 `not_ready`，Worker 禁用 TTS provider，禁止复用全局 TTS track。以上仅是代码候选：本轮按要求未运行测试，
也未执行 `0023`、forced-RLS、跨租户/旧 ticket/重放、真实四人 LiveKit、ASR/翻译 Provider、浏览器和真机验收，
`ENT-MTG-003` 保持 `in_progress`。

### 19.9 屏幕共享租约与发布撤销

`0024_enterprise_meeting_screen_share_leases` 把早期 screen-share 骨架升级为 tenant-scoped 租约模型：记录绑定
`meeting + participant + communicationSessionId + routeEpoch`，以 `generation` 形成发布 fencing，并增加 acquire
幂等键/hash、严格状态/时间约束、同会议 active/paused 条件唯一索引和 append-only 命令账本。命令账本保存 actor、
expected version、结果状态/version/generation 及被撤销 generation；身份字段和 generation/version 单调性由数据库
trigger 保护。新表与 pending-work 均使用 forced RLS，participant、binding、share 的复合外键拒绝跨会议或跨租户拼接。

成员 API 固定为：

- `GET /enterprise/v1/meetings/:meetingId/screen-shares/current`
- `POST /enterprise/v1/meetings/:meetingId/screen-shares/acquire`
- `POST /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/{pause|resume|renew|stop}`

所有入口先验证 Bearer、active membership、`meeting:read` 和签名 route document；mutation 必须携带
`Idempotency-Key` 与 expected meeting/share version。acquire 在 tenant/meeting 行锁内重读 active participant、
`screenShareRole`、当前 communication binding、route epoch 和 `meeting.screen_share.concurrent` entitlement；
system audio 还必须有独立 entitlement。相同 key/hash 返回原结果，不同 hash 返回冲突；同会议已有租约或租户并发
达到限额时不创建第二条记录。pause 和 stop 递增 generation 并撤销旧 identity；resume 使用暂停后新 generation；
renew 只允许 active 状态，首次可绑定 track SID，之后拒绝替换成另一轨道。

发布 identity 为 `ent-share:<shareId>:g<generation>`。LiveKit grant 只允许加入绑定 room 并发布
`SCREEN_SHARE`，显式禁止 microphone、camera、data 和 subscribe；只有 entitlement 允许时才附加
`SCREEN_SHARE_AUDIO`。token TTL 不超过租约剩余时间。RTC URL、API key/secret 或 route 不匹配时，在数据库 mutation
前返回 `screen_share_provider_not_ready`；不会生成调试 token 或假 Provider reference。

active 租约按短周期续期；pause 直接把到期时间推进到服务端最大暂停窗口且不能继续 renew。share trigger 把当前
到期时间同步到 cell-scoped `platform_pending_work`。即使客户端崩溃或停止请求，cell Worker 到期后仍在 tenant
transaction 内把租约改为 expired、递增 generation，并原子写 `meeting.screen_share.revoke.requested` outbox。
API 的 pause/stop/fence 也写同一幂等撤销事件并立即尝试 LiveKit `removeParticipant`；Worker outbox publisher 负责重试。
404 视为幂等完成，未配置、超时或 Provider 错误保持 `pending/retry`，不能对客户端宣称已撤销。

本任务不采集或存储屏幕帧，也不实现 Web `getDisplayMedia`、ReplayKit、MediaProjection、simulcast、系统音频处理、
主持人 force-stop UI 或 OCR；这些仍属于 `ENT-MTG-005..010/012`。本轮按要求只完成静态门禁，未执行 `0024`
up/down、forced-RLS、双 acquire/CAS、Worker 到期、outbox 重放、真实 LiveKit 撤销、浏览器或真机测试，
因此 `ENT-MTG-004` 保持 `in_progress`，不代表 A1 或企业生产门禁通过。

### 19.10 Web 屏幕共享采集、发布与观看

成员 Web 在显式按钮事件内调用 `navigator.mediaDevices.getDisplayMedia({ video, audio: false })`。`auto` 使用浏览器
默认约束，`smooth` 以1080p/30fps为目标，`high` 以1440p/15fps为目标且允许最高4K/30fps；这些是采集偏好，不是
服务端保证。客户端读取 `MediaStreamTrack.getSettings().displaySurface`，只接受 monitor/window/browser 并分别映射
为 screen/window/tab。缺失视频轨道、用户拒绝或来源未知均停止全部临时轨道，不发送 acquire，避免来源伪造。

取得真实来源后，客户端读取最新 meeting version，再调用 acquire。麦克风会议 Room 的 grant 固定
`screenShare=false`；屏幕使用第二个 `Room({ autoSubscribe:false })` 和 generation 专属 grant，只发布原始 video track，
source 固定 `Track.Source.ScreenShare`，不发布系统音频、麦克风、摄像头或 data。发布返回 track SID 后立即执行一次
renew 绑定 SID，之后每10秒 renew。capture、MediaStream 和像素帧只留在浏览器与 RTC 媒体路径，不进入业务 API、
PostgreSQL、日志或对象存储。

主会议 Room 继续自动订阅媒体，但渲染层同时要求 remote participant identity 等于 current API 返回的
`publisherIdentity` 且 publication source 为 `screen_share`。current share 改变、暂停、结束或 generation 前移时，
客户端立即清除旧 video；迟到的旧 participant/track 不能重新进入画面。单独的屏幕 publisher identity 不计入页面的
远端参会者人数。

pause 先禁用并取消发布本地 track、断开屏幕 Room，再以原 expected version 调服务端；capture 保留以便 resume。
resume 取得新 generation grant 后复用仍存活的 capture track 重新发布并重新绑定 SID。stop、页面离开或浏览器原生
track ended 先停止本地所有 track，然后提交 stop；撤销 pending 使用同一 idempotency key 有界重试，耗尽后仍保留
pending 文案，由服务端 outbox 最终收敛。发布或续租建立阶段失败时客户端 fail closed，停止本地 capture 并尝试结束
已取得的活动租约，不显示共享成功。

本实现只覆盖已认证成员 Web。访客发布、系统音频、ReplayKit、MediaProjection、simulcast/自适应布局、主持人强停和
OCR 分别由 `ENT-MTG-006..010/012` 交付。按本轮要求未执行 unit/API/Playwright、screen/window/tab、多浏览器权限、
弱网/重连、多发布者竞争或真实 LiveKit 测试，因此 `ENT-MTG-005` 保持 `in_progress`。

## 20. 错误、重试和客户端动作

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

## 21. 测试与验收映射

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
| 企业通讯运行策略 | policy version/snapshot 不可变、readiness/fingerprint 过期、capability deny、授权缺失/过期/撤回和 ticket policy mismatch 测试 | 真实端侧/云端 ASR/翻译/TTS 与声纹/录音/诊断 purpose 撤回演练 |
| 企业会议定向翻译 | source participant/track、target language/identity、event idempotency、ticket/route/generation/playback fence、客户端 server-sender 校验 | 四人中英真实媒体、Worker/API 重启、弱网、Web/Flutter 和定向 TTS 演练 |
| 企业账单归属 | tenant billing account、跨租户账单 ID、ledger/adjustment 幂等和对账测试 | 支付 sandbox、账期关闭和财务抽样对账 |
| 企业链路报告 | `x-trace-id` 到 binding/provider/usage/ledger/audit 的关联、legacy/no-sample/no-price、跨租户 session/trace 负测 | 两租户真实会话、Provider、OTLP、账务抽样和 H1 长稳 |
| 生产韧性 | writer fence、route epoch、旧 Worker generation、备份清单和恢复脚本测试 | 跨故障域自动切换、旧主隔离、异地主机不可变备份和 PITR |

设计评审通过不等于功能验收。任务只有在代码、自动化、目标环境证据和 `enterprise-edition-acceptance-plan.md` 对应条目齐全后才能从 `ready_for_acceptance` 进入 `accepted`。
