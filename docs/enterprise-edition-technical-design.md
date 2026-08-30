# 无界AI企业版详细技术设计

版本：v1.74
日期：2026-08-31
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
| RBAC | `ready_for_acceptance` | 已有23个 scope、九角色矩阵、统一服务端 guard 和越权测试；新增质检 scope 的自动化尚未恢复执行 |
| SaaS tenant lifecycle | `ready_for_acceptance` | 已有幂等开通、暂停、导出/删除执行器、租约、有界恢复和 receipt 校验；真实对象存储/Provider 清理服务尚待验收 |
| Append-only audit | `ready_for_acceptance` | 已有 tenant-scoped 查询、HMAC cursor、成员/RBAC/租户生命周期埋点和 SQLite/PostgreSQL 不可变约束；受控导出已进入 UI-008 开发，真实 PostgreSQL 验收仍待执行 |
| PostgreSQL schema | `implemented` | 已有五十四段 up/down migration、tenant-first 索引、复合 FK、强制 RLS、user directory、cell/control-plane pending projection/coordination、opaque subject identity、企业通讯/dispatch/策略、usage/billing、knowledge/terminology、observability trace、受控审计导出、数据生命周期、Release Control、Meeting、客服、Campaign/Lead/Consent/Suppression/Country Policy、活动审批快照、Scheduler、PSTN dispatch、Marketing Agent、人工接管、Outcome 和 CRM sync 栅栏；尚无真实 migrate/restore/PITR 证据 |
| Tenant-scoped Repository | `ready_for_acceptance` | 已有 tenant/user/cell scoped transaction、subject guard、单一 `legacy|postgres` runtime、HTTP 全链路注入、独立 cell Worker，以及 Tenant/Member/Audit、Directory、lifecycle、Inbox/Outbox、budget、billing/entitlement、usage accounting、knowledge、terminology 和共享 unit-of-work；尚无真实 PostgreSQL H3 证据 |
| Enterprise Inbox/Outbox | `ready_for_acceptance` | 已有 tenant-scoped 去重、稳定 payload hash、领域/inbox/outbox 原子提交、lease/retry/recovery 和100次重放门禁；真实 PostgreSQL 并发与 Provider sandbox 尚待验收 |
| 企业安全门禁 | `in_progress` | 已有21条高置信 SAST/密钥规则、精确依赖例外、隔离 test/staging 渗透 runner、commit/计划/时间窗 HMAC evidence verifier 和 CI 静态 job；本轮静态 P0/P1 为0且依赖无 high/critical，但14个 moderate 仍为限期 OpenTelemetry 例外，真实渗透/独立复核/密钥轮换未执行 |
| 数据生命周期 | `in_progress` | `0051` 已登记 audit export retention/object 删除 job，复用 Cell queue 协调，Delete 后实体复核、attempt CAS、append-only receipt/audit 和 tenant delete 三段收敛回执已形成候选；未执行真实 migration/S3/Provider/故障注入 |
| SQLite/JSON 演示数据导入 | `ready_for_acceptance` | 已有维护窗口、SQLite 临时副本与 quick_check、空目标事务导入、六集合 count/SHA-256 读回对账和不一致回滚；仅限内部演示数据 |
| 公共 Primary Runtime 收敛 | `ready_for_acceptance` | 已合入上游稳定提交 `fe1c3c2`；公共31段与 enterprise 54段 manifest 由一个启动编排验证，driver、数据库身份和分权连接失败均在监听前闭合；尚无真实 PostgreSQL H3 证据 |
| 企业链路追踪 | `in_progress` | 平台 trace 已进入 tenant context、PostgreSQL session、communication binding、usage event/ledger 与会话报告；本轮未执行测试和真实 PostgreSQL 门禁，货币成本因无价格表明确 not configured |
| 企业工作台真值投影 | `in_progress` | Web 已读取 tenant/route、Provider、subscription、budget、usage aggregate 和显式 session trace report；业务聚合与价格表缺失时明确 not ready/not configured，本轮未执行自动化、浏览器或 PostgreSQL 门禁 |
| 审计与分析 | `in_progress` | Web 已接入审计筛选/详情、显式 session 下钻和受控 JSONL 导出；`0020/0051`、Repository/API/cell Worker/加密对象存储与到期物理清理边界已实现，本轮未执行 migration、双租户、对象存储或浏览器测试；业务聚合/价格表与真实对象清理验收仍未完成 |
| 公共通讯 tenant scope | `ready_for_acceptance` | 公共 manifest 已增至31段；12张通讯资源表具有不可空 scope、复合 FK、写入 guard 和 forced RLS，企业 unit-of-work 只暴露 tenant-bound 白名单 Repository；尚无真实双租户 A1/H3 证据 |
| 企业统一通讯会话绑定 | `ready_for_acceptance` | enterprise `0011` 和 tenant unit-of-work 已建立 Meeting/Support/Marketing 唯一绑定、route/policy/entitlement 快照及 generation/event-sequence 收敛状态机；尚无真实多实例、cell 迁移和 A1/H3 证据 |
| Tenant-aware Worker Dispatch | `ready_for_acceptance` | enterprise `0012` 以 scope FK/RLS 绑定公共 dispatch/capacity；短期 HMAC ticket、租户容量、lease/heartbeat、cancel/finalize 和二次 binding fence 已实现；仅有自动化和一次性本地 PostgreSQL 16 证据，尚无真实多实例/H3 容量证据 |
| 企业设备、声音和录制策略 | `ready_for_acceptance` | enterprise `0013`、发布 API、策略解析、purpose-specific 授权和 Worker policy fence 已实现；仅有自动化和一次性本地 PostgreSQL 16 机制证据，尚无真实设备/Provider、A1/H2/H3 证据 |
| Web/Flutter 屏幕共享 | `in_progress` | 已实现真实来源/系统授权、独立最小权限发布 Room、Web 可选独立系统音轨、显式 screen simulcast/dynacast、renderer 尺寸驱动订阅、当前 generation 过滤、三种画面/字幕布局和 scope 受控主持人强停；移动端系统音频仍关闭，未执行自动化、多浏览器/真机、回声、弱网或真实 LiveKit 门禁 |
| 企业会议会后材料 | `in_progress` | `0025`、Repository/runtime/API 和 Web/Flutter 已实现服务端冻结逐字稿、材料修订、逐项 evidence、当前会议 speaker label、action CAS 和人工发布；未执行 migration/RLS、自动化、真实复核 Provider、浏览器/真机或导出 Adapter 门禁 |
| 企业用量预算 | `ready_for_acceptance` | enterprise `0014` 已实现 tenant/category/unit/UTC period 预算、hold/settle、阈值告警和 ledger 不可变约束；真实并发与账务抽样待验收 |
| 租户账务和 Entitlement | `ready_for_acceptance` | enterprise `0015` 已实现 tenant billing account、不可变 plan/subscription/entitlement version、服务端账期及 binding/dispatch entitlement fence；真实支付 Provider、关账对账和 A1/H3 待验收 |
| SaaS 计量聚合 | `ready_for_acceptance` | enterprise `0016` 已实现 tenant usage event、event/ledger 一致性、append-only adjustment、负数净额保护及 count/hash/watermark 账期聚合；真实关账、支付对账和 A1/H3 待验收 |
| 企业知识版本 | `ready_for_acceptance` | enterprise `0017`、Knowledge Repository/runtime/API 已实现 source/revision/chunk/review/publish、发布后不可变、四维时间检索和稳定 citation；当前仅有确定性文本检索，本地普通角色验证不代表 embedding Provider、对象存储、恶意文档或 A1/H3 已通过 |
| 客服 Tenant RAG | `in_progress` | 已将客服活动会话绑定到 tenant-scoped Knowledge Repository，返回逐条 evidence/citation 或确定性无答案转人工指令，并固化不含 query/content 的引用审计；未执行测试、真实 PostgreSQL、召回质量或 Support Agent 生成门禁 |
| Support Agent | `in_progress` | `0029`、strict JSON schema Provider、API-owned turn runtime、独立 LiveKit Worker cell、上下文压缩、无证据/超时降级和 generation-bound TTS authorize fence 已形成代码候选；未执行自动化、migration/RLS、真实 LLM/ASR/TTS/LiveKit、取消竞态或接管验收 |
| Tool Registry | `in_progress` | `0030`、不可变工具 revision、固定风险/scope/确认映射、封闭输入 schema、签名 Worker fence、幂等授权记录和 DB insert guard 已形成代码候选；Agent 仍不输出工具请求，只读执行见 CS-006，客户确认/高风险流程属于 CS-007/008，未执行自动化、migration/RLS 或真实 Provider 验收 |
| 只读 Tool Adapter | `in_progress` | `0031`、order/logistics/inventory 严格 Adapter contract、默认 not_configured runtime、可注入 simulated mock、claim/事务外调用/fenced finalize、结果 hash/稳定回放和客户归属 guard 已形成代码候选；Agent 仍不输出工具请求，未执行自动化、migration/RLS、并发租约或真实 Provider 验收 |
| 可逆写 Tool Adapter | `in_progress` | `0032`、ticket/callback/note 严格 Adapter contract、120秒客户 turn 确认、AES-GCM Outbox、Cell Worker 重试、Provider 幂等/fingerprint fence 和 execution/outbox 原子终结已形成代码候选；默认 not_configured、mock simulated=true，Agent 仍不输出工具请求，未执行自动化、migration/RLS、崩溃恢复或真实 Provider 验收 |
| 高风险人工接管 | `in_progress` | `0033`、forced-RLS/不可变 handoff request、run/session/customer/revision/arguments/risk evidence 绑定、幂等冲突和 run/session 原子 handoff 已形成代码候选；不创建 execution/Outbox/Provider 调用，坐席队列属于 CS-009，未执行自动化、migration/RLS、并发或真实接管验收 |
| 坐席队列 | `in_progress` | `0034`、queue SLA/lease、forced-RLS exclusive claim、session deferred binding、self-claim/release/renew 和 manager reassign API 已形成代码候选；测试已定义但未运行，真实 migration/RLS/并发/坐席未验收 |
| 工单与回拨 | `in_progress` | `0035`、forced-RLS callback/followup、claim/session 双 version、确定性幂等业务 ID、AES-GCM Outbox、Worker 同键重试、case/callback 原子收敛和 Web 表单已形成代码候选；默认 Provider not_configured，未执行自动化、migration/RLS、崩溃恢复或真实 Ticket/Callback 验收 |
| 客服质检分析 | `in_progress` | `0036`、`quality:read/manage`、不可变规则/复核/发现、终态会话 source hash、五类确定性结构规则和 Web Dashboard 已形成代码候选；语义模型未配置且错误回答率为空，未执行自动化、migration/RLS、浏览器或语义质量验收 |
| Campaign 聚合 | `in_progress` | `0037..0045`、共享契约、Lead/Consent/Suppression/Policy/Approval、确定性 task 物化、Scheduler claim/lease/hold、scoped PSTN dispatch、tenant Repository/runtime/API 和同风格 Web 页面已形成代码候选；未执行自动化、migration/RLS、真实 PSTN、并发或浏览器验收 |
| Marketing Agent | `in_progress` | `0046`、版本化国家/locale profile、PSTN 同事务 run、服务端 disclosure/turn/TTS 状态机、短期签名 runtime ticket、严格 LLM Adapter、knowledge citation/禁语校验、退订 suppression 和 Campaign Web 配置已形成代码候选；未执行自动化、migration/RLS、真实 LLM/PSTN 通话或浏览器验收 |
| Marketing 实时监控 | `in_progress` | 已有 `campaign:read` 的 tenant-scoped 汇总/单通话只读投影、最终字幕/Agent/Provider 证据、延迟/新鲜度/失败分类和同风格 Web 快照面板；当前明确为5秒非流式快照，未执行自动化、真实 PostgreSQL/RLS、通话、浏览器或 Realtime Gateway 验收 |
| Marketing 真实人工接管 | `in_progress` | `0047`、审批冻结策略、Marketing→Support Session 桥接、复用 exclusive claim、AI 数据库停播 fence、HTTPS Provider 300ms停音/坐席加入回执、超时收敛和 Web 分层状态已形成代码候选；未执行自动化、migration/RLS、真实 PostgreSQL/PSTN/坐席或300ms验收 |
| Marketing Outcome | `in_progress` | `0048` 升级不可变 Outcome 并新增 forced-RLS requested action；终态 task/dispatch/run、最终字幕/已交付 turn、handoff/suppression/Provider 失败证据、稳定 hash、单 task 唯一、幂等/并发 guard、API 与同风格 Web 面板已形成代码候选；不执行外部动作，未运行自动化、migration/RLS、真实通话或浏览器验收 |
| Marketing CRM Adapter | `blocked` | `0049` CRM sync、AES-GCM Outbox、稳定 External ID、Salesforce OAuth/REST upsert、GET 对账 receipt、Worker finalize、API/Web 和 mock/contract 测试已形成候选；真实 Salesforce sandbox 缺失且未运行 migration/RLS/故障注入/浏览器验收 |
| Marketing 活动分析 | `in_progress` | PostgreSQL repeatable-read 只读投影、漏斗/Outcome/明确投诉/usage+adjustment/CRM receipt 指标、国家/冻结执行版本拆分和 lazy Web 面板已形成候选；无价格表保持 pricing_not_configured，未运行自动化/真实 PostgreSQL/RLS/浏览器/容量验收 |
| 营销授权证据 | `in_progress` | `0039`、对象实体验证、Campaign/Lead/purpose 绑定、不可变登记/撤回、服务端有效性解析、task insert/reschedule 数据库 guard 和同风格 Web 面板已形成代码候选；真实 S3/KMS、PostgreSQL/RLS、并发、浏览器和法务抽样未验收 |
| 营销禁拨名单 | `in_progress` | `0040`、tenant/global 不可变记录、拒绝/撤回来源、Repository/runtime/API、同号码事务锁、task insert/reschedule guard、跨活动待任务取消和同风格 Web 面板已形成代码候选；全局注册表明确 not_configured，真实 PostgreSQL/RLS、并发、浏览器和名单同步未验收 |
| 企业术语与话术版本 | `ready_for_acceptance` | enterprise `0018`、共享契约、Term Pack/Script Template Repository/runtime/API 已实现稳定资源、递增 revision、review/publish、有效期解析、hash 校验和同一术语版本运行时引用；仅有自动化和本地 PostgreSQL 16 普通角色证据，真实 Worker/Provider、A1/H3 未通过 |
| Primary 全量切换/恢复证据 | `ready_for_acceptance` | 工具按运行时动态校验 manifest/全业务表；`c9b5be2` 历史证据为31+16/81张表，当前31+54必须重新生成签名证据；异地 WAL/PITR/H3 未通过 |
| PostgreSQL 备份和灾备 | `in_progress` | schema-v2 HMAC 结果已绑定当前 enterprise cutover、候选版本、数据库 identity 与31+54 manifest，并定义自动切换/三层 fencing/第三故障域不可变备份/PITR marker+hash 门禁；测试定义未执行，真实跨故障域、异地主机、RPO/RTO 和 H3 未通过 |
| 灰度和熔断 | `in_progress` | `0052/0053` forced-RLS 控制/追加事件及 tenant root policy、PostgreSQL runtime、内部变更/探针 API 和三条服务端 guard 已形成；本机 PostgreSQL 16.14 普通角色双租户、并发和双 API 进程已通过，真实 Provider 故障、kill SLO、告警和 on-call 演练未完成 |
| SaaS 控制面高可用 | `in_progress` | `0054`、独立 control-plane role/session、实例和 provision projection 租约、SKIP LOCKED Worker、异步202开通、套餐变更 fail-closed、同候选 status CLI 和运行手册已形成；测试定义未执行，真实 PostgreSQL/双实例/故障域/kill/区域自治未验收 |
| PostgreSQL 控制面/业务聚合 | `designed` | 后续 CORE/MTG/CS/MKT 领域任务范围，不能从公共 Repository runtime 推导为已实现 |
| SQLite | `demo_only` | 仅本地开发、自动化和封闭演示，不承载真实企业试点数据 |
| PSTN/CRM/OCR | `not_ready` 或按环境探测 | 未配置必须明确降级，不生成虚假外部对象或成功状态 |
| Google Calendar Adapter | `in_progress` | 已有稳定 event ID、加密 outbox、service-account Provider 和 Web/Flutter 主持人入口；尚未运行 contract、真实账号、PostgreSQL 或客户端验收 |

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
| 客服主管 | `tenant:read`、`knowledge:read`、`knowledge:publish`、`support:read`、`support:manage`、`support:takeover`、`quality:read`、`quality:manage` |
| 客服坐席 | `tenant:read`、`knowledge:read`、`support:read`、`support:takeover` |
| 会议主持人 | `tenant:read`、`meeting:read`、`meeting:write`、`screen_share:stop` |
| 普通成员 | `tenant:read`、`meeting:read` |
| 审计员 | `tenant:read`、`member:read`、`knowledge:read`、`campaign:read`、`support:read`、`quality:read`、`meeting:read`、`billing:read`、`usage:read`、`audit:read`、`audit:export` |

完整 scope 集合以 `packages/contracts/src/api/enterprise.ts` 的 `enterpriseScopes` 为唯一代码真值。owner/admin 的“全部”仅指该版本声明的23个 scope，不隐含未声明权限。

| 资源 | scope | 受控操作 |
| --- | --- | --- |
| tenant | `tenant:read`、`tenant:write` | 查看租户/readiness；修改允许的租户设置 |
| member | `member:read`、`member:write` | 成员列表；邀请、角色和状态变更 |
| knowledge | `knowledge:read`、`knowledge:publish` | 查看知识；审核/发布版本 |
| campaign | `campaign:read`、`campaign:write`、`campaign:approve` | 查看；编辑/控制；审批活动 |
| support | `support:read`、`support:manage`、`support:takeover` | 查看会话；队列策略；人工接管 |
| quality | `quality:read`、`quality:manage` | 读取质检 Dashboard/证据；发布规则并触发终态会话分析 |
| meeting | `meeting:read`、`meeting:write` | 查看/入会；创建、主持和材料发布 |
| screen_share | `screen_share:stop` | 主持人或管理员强制停止共享 |
| audit | `audit:read`、`audit:export` | 查询审计；受控导出 |

### 2.2 外呼营销

```text
marketing_campaigns(
  id, tenant_id, name, objective, owner_user_id, country_codes,
  language_codes, status, approval_status, policy_version,
  schedule_json, concurrency_limit, creation_key, creation_request_hash,
  created_at, updated_at, version
)

marketing_leads(
  id, tenant_id, external_id, phone_e164_encrypted, phone_input_encrypted,
  phone_hash, phone_hint, country_code, timezone, language, attributes_json,
  source_id, created_by_batch_id, status, created_at, updated_at, version
)

marketing_lead_import_batches(
  id, tenant_id, campaign_id, source_kind, source_reference, status,
  total_rows, created_count, linked_count, duplicate_count, created_by,
  idempotency_key, request_hash, rollback_by, rollback_key,
  rollback_request_hash, created_at, committed_at, rolled_back_at,
  updated_at, version
)

marketing_campaign_leads(
  id, tenant_id, campaign_id, lead_id, import_batch_id, status,
  linked_by, created_at, rolled_back_at, version
)

marketing_lead_import_rows(
  id, tenant_id, batch_id, row_number, result, lead_id, campaign_lead_id,
  phone_hint, country_code, created_at
)

contact_consents(
  id, tenant_id, campaign_id, lead_id, purpose, channel,
  evidence_object_id, evidence_sha256, evidence_size_bytes,
  evidence_content_type, source_reference, granted_at, expires_at,
  revoked_at, policy_version, created_by, created_at, updated_at,
  version, creation_key, creation_request_hash, revoked_by,
  revocation_reason, revocation_key, revocation_request_hash
)

suppression_entries(
  id, tenant_id, phone_hash, scope, reason, source, created_at,
  origin_campaign_id, lead_id, source_reference, created_by, updated_at,
  version, creation_key, creation_request_hash, cancelled_task_count
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
- `marketing_leads(tenant_id, phone_hash)` 和非空 external ID 在 tenant 内唯一；号码 hash 使用独立长期 HMAC
  key，不能把普通 SHA-256 当作不可逆匿名化。
- import batch 使用 `tenant_id + campaign_id + idempotency_key` 唯一；规范化 request hash 不包含号码原始排版。
- `marketing_campaign_leads` 只允许一个 active `tenant + campaign + lead`，历史 rolled_back 关联保留。
- 三张导入表全部 forced RLS；batch/link/row 禁止删除，row append-only，batch 只允许
  `processing -> committed -> rolled_back`，Lead 只允许 active/inactive 版本迁移。
- Consent evidence object 在 tenant 内唯一；登记键按 tenant + actor 唯一，撤回键按 tenant + actor 唯一。
- Consent 固定 `automated_marketing_call` purpose，Campaign/Lead/member 使用 tenant-first 复合 FK；历史记录不可删除，
  身份、对象摘要、用途、时间和创建信息不可改写，只允许一次 expectedVersion 撤回。
- Suppression 使用 `tenant_id + phone_hash + scope` 唯一，新增请求按 tenant + actor + creation key 唯一。tenant scope
  必须来自 active Campaign Lead 和 account actor；global scope 必须来自 namespaced system actor 与
  `global_registry`，两者均不可更新删除。

#### 2.2.2 营销授权 Repository 与 API

API 路由：

```text
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/consent-eligibility
POST /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
POST /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents/:consentId/revoke
```

所有路由先解析 active membership、`campaign:read/write` 和签名 route document；客户端 `tenantId` 只能用于一致性
核对。登记请求严格包含固定 purpose、允许的 collection channel、对象 UUID/SHA-256/size/content type、来源、
granted/expires 和声明版本；未知字段、未来 granted、非法窗口或非 PostgreSQL runtime 均失败闭合。

`EnterpriseMarketingConsentEvidenceStore` 默认 disabled。生产只允许 S3-compatible store，要求对象路径绑定 tenant，
读取实体后校验 metadata `tenant-id/object-id`、内容 SHA-256、size、content type、SSE 类型及可选 KMS key；25MiB
以上拒绝。`ENTERPRISE_MARKETING_CONSENT_EVIDENCE_LOCAL_DIR` 仅在非生产显式启用，生产配置该值直接 not ready。

Repository 在同一 tenant Unit of Work 内锁定幂等键、Campaign、Campaign Lead 和 Lead，只允许
`draft/not_submitted + active link/Lead` 登记。审计只保存 Campaign/Lead、purpose、channel、对象 UUID/hash/size 和
声明版本，不写电话明文或对象内容。撤回可在活动离开草稿后执行，以便立即停止后续执行；它追加 actor/reason/time
和 version，并由 trigger 取消没有替代有效 Consent 的 pending/scheduled/retry task。

eligibility 使用 API 服务器当前时间，只有 `granted_at <= now < expires_at`（或无失效时间）、`revoked_at IS NULL`
且 Campaign Lead/Lead active 才返回 eligible。`marketing_call_tasks` 的 INSERT 或 Campaign/Lead/scheduledAt 变更还会
由数据库按计划时间重验同一条件；缺授权时 SQL 拒绝，因此客户端、Scheduler 或 Repository 遗漏都不能绕过。
本层不校验 Suppression、Country Policy、审批快照、预算或 PSTN readiness，它们仍由后续任务共同组成最终执行门禁。

#### 2.2.3 营销禁拨 Repository、全局投影与 API

API 路由：

```text
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppressions
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppression-eligibility
POST /enterprise/v1/suppression
```

公开 POST 只接受固定 `scope=tenant`、当前 Campaign/Lead、`manual|contact_request|consent_withdrawal|complaint`
来源、1..500字节原因、1..200字节来源标识和幂等键；号码/hash/scope actor/创建时间/取消数均由服务端或数据库生成。
GET/POST 分别要求 `campaign:read/write`、active membership 和签名 route document；body tenant 只做一致性核对，
legacy/SQLite/JSON 固定返回 PostgreSQL required。

global 不是普通租户可写的“更大 scope”。权威平台注册表只能通过受信控制面以 namespaced system actor 和固定
`global_registry` source 投影为 tenant HMAC 记录；这避免共享跨租户稳定号码 hash。当前没有配置真实注册表
Provider，默认 Adapter 返回 `global_suppression_registry_not_configured`，所以本地名单未命中也只返回 not_ready。

Repository 在 tenant transaction 中锁 actor/idempotency key 和 Campaign/Lead。`0040` trigger 以
`tenant_id + phone_hash` 取得 advisory transaction lock，验证 phone hash 确实属于当前 Lead，写入不可变记录前取消
相同号码跨 Campaign 的 pending/scheduled/retry task，并把真实取消数固化进记录。相同 phone/scope 已存在时返回
原记录而不重复写入。

`guard_marketing_task_consent` 使用同一 advisory lock；task insert 或变更 tenant/Campaign/Lead/scheduledAt 时，先拒绝
任一 tenant/global suppression，再继续验证覆盖计划时间的有效 Consent。因此 task 与 suppression 并发无论谁先提交，
最终可执行待任务数均为零。本层尚不具备 Scheduler dispatch generation、PSTN cancel 或已开始媒体物理停止能力。

#### 2.2.4 Country Policy Repository、API 与数据库栅栏

```text
marketing_country_policy_versions(
  id, tenant_id, country_code, policy_version, calling_windows,
  max_attempts, frequency_window_hours, min_retry_interval_minutes,
  disclosure_version, brand_disclosure, ai_identity_disclosure,
  marketing_purpose_disclosure, voicemail_mode, voicemail_version,
  voicemail_message, compliance_reference, content_hash,
  effective_from, expires_at, published_by, published_at,
  creation_key, creation_request_hash, version
)

marketing_call_tasks(..., country_policy_version_id)
```

API 路由：

```text
GET  /enterprise/v1/marketing/country-policies
POST /enterprise/v1/marketing/country-policies
GET  /enterprise/v1/campaigns/:campaignId/country-policy-readiness
```

POST 要求 `campaign:approve`，只接受一个国家、1..28 个同日不跨午夜且不重叠的星期/分钟窗口、1..20 次最大尝试、
1..720 小时滚动窗口、1..10080 分钟重试间隔、三段非空告知、语音信箱 union、合规确认依据和规范 ISO 时间。
`disabled|human_only` 必须没有留言版本/内容，`compliant_message` 必须同时固化两者。服务端规范化窗口并生成
content/request SHA-256；Repository 以 actor/key 锁精确重放，再以 tenant/country 锁阻止重复版本和生效区间重叠。

`0041` 使策略表 forced RLS 且只允许一次 INSERT；UPDATE/DELETE、伪造 actor/tenant、非法 JSON 窗口和重叠区间均由
trigger 拒绝。Campaign readiness 以 startAt 或只读预览时间解析每个国家，返回 missing/not-yet-effective/expired，
不把“存在历史版本”视为 ready。Campaign scheduled 数据库 trigger 再按 startAt 验证全部目标国家；审批的 policy-set
hash 与数据快照由 `ENT-MKT-006` 固化并在 scheduled/task 再复核。

call task 新增 nullable-for-history 的 `country_policy_version_id`，但 `0041` 之后所有 insert/reschedule 均由现有 task
guard 要求非空并精确匹配 Lead country、覆盖 scheduledAt。guard 校验 `pg_timezone_names` 后使用 Lead IANA 时区换算
当地 ISO weekday/minute，检查允许窗口；随后在与 Suppression 相同的 phone advisory lock 内统计同 Lead、非 cancelled、
跨 Campaign 的前序 task，执行最小重试间隔和滚动频控。该层不创建 task，不执行审批、claim、hold、Outbox 或 PSTN。

本策略内容来自企业合规负责人，不是自动法律建议；没有真实法务抽样、目标法域范围和运行环境证据时只能标记
`implemented/in_progress`。legacy/SQLite/JSON runtime 缺少 Repository 方法并返回 PostgreSQL required。

#### 2.2.5 Campaign validation、approval decision 与数据库复核

```text
marketing_campaign_validation_snapshots(
  id, tenant_id, campaign_id, source_campaign_version, status, target_at,
  campaign_snapshot/hash, policy_set/hash, lead_set/hash, consent_set/hash,
  suppression_set/hash, issues, snapshot_hash, validated_by/at,
  creation_key/request_hash, version
)

marketing_campaign_approval_decisions(
  id, tenant_id, campaign_id, validation_snapshot_id, decision,
  rejection_reason, decision_hash, decided_by/at,
  creation_key/request_hash, version
)

marketing_campaigns(..., approval_snapshot_id, policy_version=snapshot_hash)
marketing_call_tasks(..., approval_snapshot_id)
```

API 为 `GET /campaigns/:id/approval` 及 `POST /campaigns/:id/approval/{validate|approve|reject}`。读取要求
`campaign:read`，validate 要求 `campaign:write`，approve/reject 要求 `campaign:approve`；三类命令均绑定 active
membership、签名 route、expectedVersion、actor/key/request hash，body tenant 仅作一致性核对。

`0042` 使 validation/decision forced RLS 且 insert-only。数据库使用规范 JSON 逐项重算 Campaign、目标时间有效
Policy、active Lead/link/committed batch、每 Lead 最新有效 Consent 和 Suppression set；ready 还要求策略数覆盖国家、
Lead 国家属于 Campaign、timezone 存在于 `pg_timezone_names`、Lead/Consent 数相等且 Suppression 为空。应用生成
SHA-256，数据库不把 hash 字符串替代行级内容复核。

`0043` 把 `draft -> validating -> pending_approval -> approved|draft/rejected` 每一步绑定到不可变 snapshot/decision 的
actor、时间与源版本。批准前 Repository 在 phone advisory lock 和 share locks 下重建 snapshot；任一集合或 hash 漂移
返回 `validation_stale`。scheduled 与 task trigger 再调用 current snapshot 检查，task 还要求冻结集合中存在自身 Lead、
Consent 和 Country Policy。该层不产生 task、usage hold、Outbox、PSTN 或 Provider 结果。

#### 2.2.6 Marketing Agent profile、run 和 turn

```text
marketing_agent_profiles(
  id, tenant_id, campaign_id, country_code, locale, brand_name,
  agent_identity, call_purpose, product_code, value_proposition,
  target_market, voice_preset_id, term_pack_id, script_template_id,
  opening_disclosure, qualification_questions, opt_out_phrases,
  handoff_phrases, closing_text, created_by, creation_key,
  creation_request_hash, created_at, updated_at, version
)

marketing_agent_runs(
  id, tenant_id, dispatch_id, task_id, campaign_id, lead_id,
  communication_session_id, dispatch_generation, route_epoch,
  profile_id, profile_version, term_pack_version_id,
  script_template_version_id, content_context_hash,
  provider_fingerprint, status, locale, conversation_state,
  disclosure_text, disclosure_authorized_at, disclosure_delivered_at,
  context_document, context_hash, last_turn_sequence,
  created_at, updated_at, version
)

marketing_agent_turns(
  id, tenant_id, run_id, input_turn_id, idempotency_key, request_hash,
  sequence, status, locale, profile_id, profile_version,
  term_pack_version_id, script_template_version_id, content_context_hash,
  customer_text_hash, context_hash, evidence_hash, spoken_text, intent,
  conversation_state, action, risk_signals, knowledge_citations,
  provider_fingerprint, failure_code, tts_authorized_at, delivered_at,
  created_at, updated_at, version
)
```

`0046` 对三表启用 forced RLS 和 tenant-first 复合 FK。profile 由 account actor 创建，只在 Campaign
`draft/not_submitted` 可 upsert，不可删除；数据库重验开场告知包含品牌、AI 身份和营销目的。run 只能由
`system:enterprise-marketing-pstn` 在当前 dispatch/task/Lead/profile、published 内容版本及有效窗口完整时创建，后续只由
`system:enterprise-marketing-agent` 推进。turn 绑定 run/profile/content 版本和递增 sequence，同幂等键异 request hash 冲突。

PSTN task 的 `dispatching -> dispatched` trigger 现在还要求同 dispatch 存在 active、处于 disclosure 的 Agent run；因此
PSTN 已接受但 Agent runtime/profile/content 未准备完成时整笔 finalize 回滚。Agent 写 tenant suppression 只开放给固定
system actor、`contact_request` 来源和当前 run Lead，其他 actor/scope 仍由原 `0040` 约束拒绝。表和 trigger 不依赖
SQLite/JSON fallback；非 PostgreSQL runtime 明确 unavailable。

#### 2.2.7 Marketing 人工接管

```text
marketing_handoff_policies(
  id, tenant_id, campaign_id, support_queue_id, support_channel_id,
  timeout_seconds, timeout_action, callback_delay_seconds,
  created_by, creation_key, creation_request_hash,
  last_command_key, last_command_hash, created_at, updated_at, version
)

marketing_handoffs(
  id, tenant_id, marketing_agent_run_id, dispatch_id, campaign_id, lead_id,
  communication_session_id, support_session_id, support_queue_id,
  support_channel_id, policy_id, policy_version, timeout_action,
  callback_delay_seconds, status, ai_fenced_at, timeout_at,
  media_requested_at, media_completed_at, provider_fingerprint,
  provider_receipt_hash, failure_code, created_at, updated_at, version
)
```

`0047` 为两表启用 forced RLS 和 tenant-first 复合 FK。policy 以 tenant/Campaign 唯一，创建身份和
首次请求不可改写，后续只能带递增 version/服务端时间在未提交草稿修改。bridge 以 run、
dispatch 和 Support Session 各自唯一，insert trigger 要求 system actor、delivered handoff turn、完全匹配的
run/dispatch/campaign/Lead/communication session 及 `handoff_requested` Support Session。

bridge 只允许 `queued|media_not_ready -> media_not_ready|active|timed_out|callback_required|failed`，以及
`active -> completed|failed`；不得删除，身份/策略/fence/timeout 字段不得改写。account actor 更新时 DB
再复核其为当前 active claim 坐席；system timeout actor 只能经受控路径收敛过期记录。

#### 2.2.8 Marketing Outcome 和内部后续动作

```text
marketing_outcomes(
  id, tenant_id, task_id, campaign_id, lead_id, dispatch_id,
  communication_session_id, agent_run_id, disposition, intent_level,
  summary, next_action, follow_up_at, evidence_segment_ids,
  evidence_document, evidence_hash, source_hash, evidence_status,
  created_by, idempotency_key, request_hash, created_at, updated_at, version
)

marketing_next_actions(
  id, tenant_id, outcome_id, task_id, campaign_id, lead_id,
  kind, status, due_at, evidence_hash, created_by,
  idempotency_key, request_hash, created_at
)
```

`0048` 对早期 `marketing_outcomes` 占位表执行 forward-safe 扩展，不创建第二套 Outcome 真值。旧行标记
`legacy_unverified`，不进入新读取结果，但继续占用 `(tenant_id, task_id)` 唯一键，禁止为同一历史 task 重复生成结果。
新行必须为 `verified`，绑定同 tenant/Campaign/Lead/dispatch/session/run 的终态 task，并持久化 canonical evidence document、
evidence/source SHA-256、操作者和请求 hash。

Outcome insert trigger 要求 account actor 和当前 tenant context，重验 task/dispatch/run/handoff/suppression；
`do_not_contact` 必须有 suppression，`invalid_number` 必须有 allowlist Provider 失败码，失败/接管分类不能由请求文本推断。
分类、意向和后续动作组合在模块与数据库双重校验。Outcome/action 均 append-only，task/outcome 各自唯一；action status
当前只能为 `requested`。deferred constraint trigger 保证 Outcome 声明 next action 时同一事务恰有一条 kind/due/evidence hash
完全匹配的 action，事务结束前缺失或重复均失败。

#### 2.2.9 Marketing CRM sync

```text
marketing_crm_syncs(
  id, tenant_id, campaign_id, outcome_id, provider, status,
  external_record_key, object_api_name, payload_hash, provider_fingerprint,
  request_hash, idempotency_key, outbox_event_id,
  provider_record_id, provider_record_url, provider_response_hash,
  attempts, last_error_code, created_by,
  created_at, updated_at, synced_at, version
)
```

`0049` 对每个 Outcome 只允许一个 sync，并对 tenant/provider/external key、actor/idempotency key 建唯一约束。
身份字段、payload/config hash、Outbox 关联和创建者不可变；状态仅允许 pending 在 attempt 严格增加时保持 pending 或
单向进入 synced/failed。synced 必须同时有 Salesforce Record ID、HTTPS URL、response hash 和 syncedAt；failed
必须有受控 reason code。表启用 forced RLS，并纳入 schema verify、subject column 和 cutover critical manifest。

Outbox payload 仅含路由字段和 `emcrm1` AES-256-GCM envelope。AAD 为
`tenantId/syncId/campaignId/outcomeId/externalRecordKey`；密钥来自独立
`ENTERPRISE_MARKETING_CRM_PAYLOAD_*` keyring。明文包含 Outcome disposition、intent、summary、evidence/source hash、
lead ID/phone hint 和内部 next action，不落 Outbox JSON、sync 表、audit 或日志。

### 2.3 AI 客服

```text
support_channels(
  id, tenant_id, channel_type, provider, config_ref, status,
  created_at, updated_at, version
)

customer_profiles(
  id, tenant_id, external_id, phone_hash, display_name,
  locale, attributes, consent_scope, created_at, updated_at, version
)

support_queues(
  id, tenant_id, name, status, default_priority, created_by,
  created_at, updated_at, version
)

support_sessions(
  id, tenant_id, customer_id, channel_id, status, queue_id,
  assigned_user_id, intent, priority, creation_key, creation_request_hash,
  created_at, queued_at, started_at, handoff_requested_at,
  assigned_at, ended_at, failure_code, updated_at, version
)

support_cases(
  id, tenant_id, customer_id, session_id, subject, status,
  summary, resolution, external_ticket_id, created_at, updated_at,
  resolved_at, closed_at, version
)

tool_executions(
  id, tenant_id, session_id, customer_id, tool_name, risk_level, request_hash,
  confirmation_status, status, external_result_ref, registry_definition_id,
  tool_revision, arguments_hash, authorization_scope,
  idempotency_key, created_at, started_at, completed_at, updated_at, version
)

support_tool_definitions(
  id, tenant_id, tool_name, revision, status, description, risk_level,
  required_scope, confirmation_mode, input_schema, schema_hash,
  created_by, published_by, retired_by, created_at, published_at,
  retired_at, updated_at, version
)

support_high_risk_handoff_requests(
  id, tenant_id, support_session_id, customer_id, support_agent_run_id,
  tool_definition_id, tool_name, tool_revision, risk_level,
  authorization_scope, confirmation_mode, risk_category, policy_version,
  arguments_hash, risk_evidence_hash, request_hash, idempotency_key, created_at
)

support_agent_runs(
  id, tenant_id, support_session_id, communication_session_id,
  dispatch_grant_id, generation, status, locale, country_code, product_code,
  conversation_state, context_document, context_hash, last_turn_sequence,
  created_at, updated_at, version
)

support_agent_turns(
  id, tenant_id, run_id, support_session_id, input_turn_id, idempotency_key,
  request_hash, sequence, status, customer_text_hash, context_hash, evidence_hash,
  spoken_text, intent, conversation_state, risk_signals, knowledge_citations,
  provider_fingerprint, failure_code, tts_authorized_at, delivered_at,
  created_at, updated_at, version
)

support_quality_rule_versions(
  id, tenant_id, revision, engine_version, locale,
  identity_disclosure_phrases, prohibited_promise_phrases,
  idempotency_key, request_hash, published_by, published_at, version
)

support_quality_reviews(
  id, tenant_id, support_session_id, run_id, rule_version_id,
  engine_version, source_hash, status, semantic_status, semantic_reason_code,
  evaluated_turn_count, evaluated_rule_count, finding_count,
  critical_count, high_count, medium_count, analyzed_by, analyzed_at, version
)

support_quality_findings(
  id, tenant_id, review_id, support_session_id, run_id, turn_id,
  turn_sequence, code, severity, evidence_hash, created_at, version
)
```

`0028` 为 `support_queues` 启用 forced RLS，并对既有 support 表补充状态、身份、时间、幂等和
复合 tenant FK 约束。客服会话创建必须在 tenant Unit of Work 内校验 active tenant/cell、当前已发布
communication policy、活动 entitlement、客户与 active channel，再创建 `kind=support` 的唯一
communication binding。Repository 不调用外部 Channel Provider；真实 PSTN/Web/App 入站属于
`ENT-CS-002`。

`ENT-CS-002` 使用 Provider-neutral 共享契约 `EnterpriseSupportInboundEvent`。事件只包含 provider/source、稳定
event ID、SHA-256 客户键/可选电话 hash、显示名、locale、intent、priority 和 canonical UTC 时间；禁止原始电话和
客户端 tenant 覆盖。内部授权先通过 active channel 与实时 readiness，再签发最长15分钟的 HMAC dispatch ticket，
ticket 固定 tenant/channel/type/homeRegion/cell/routeEpoch。入站以 `support.<source> + sourceEventId` 去重，
同 ID 不同 canonical hash 返回冲突；Inbox、客户归并、support/communication session、binding、audit 和 Outbox
在同一 tenant transaction 内提交。

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
  id, tenant_id, meeting_id, material_run_id, ordinal,
  owner_participant_id, item_text, priority, due_at, status,
  created_at, updated_at, version
)

meeting_material_runs(
  id, tenant_id, meeting_id, revision, status,
  source_event_count, source_hash, review_status, review_reason_code,
  provider_fingerprint, retention_until, created_by,
  idempotency_key, request_hash, created_at, updated_at,
  published_at, version
)

meeting_material_segments(
  id, tenant_id, meeting_id, material_run_id, ordinal,
  source_participant_id, source_display_name, source_track_sid,
  source_segment_id, revision, source_language, source_text,
  occurred_at, created_at
)

meeting_material_segment_translations(
  id, tenant_id, meeting_id, material_run_id,
  material_segment_id, language, translated_text, created_at
)

meeting_material_speaker_labels(
  id, tenant_id, meeting_id, material_run_id, participant_id,
  display_name, created_at, updated_at, version
)

meeting_material_conclusions(
  id, tenant_id, meeting_id, material_run_id,
  kind, ordinal, conclusion_text, created_at
)

meeting_material_conclusion_evidence(
  id, tenant_id, meeting_id, material_run_id,
  conclusion_id, material_segment_id, created_at
)

meeting_action_item_evidence(
  id, tenant_id, meeting_id, material_run_id,
  action_item_id, material_segment_id, created_at
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
PATCH  /enterprise/v1/campaigns/:campaignId
POST   /enterprise/v1/campaigns/:campaignId/schedule
GET    /enterprise/v1/campaigns/:campaignId/leads
GET    /enterprise/v1/campaigns/:campaignId/lead-imports
POST   /enterprise/v1/campaigns/:campaignId/lead-imports
POST   /enterprise/v1/campaigns/:campaignId/lead-imports/:batchId/rollback
GET    /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
GET    /enterprise/v1/campaigns/:campaignId/leads/:leadId/consent-eligibility
POST   /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
POST   /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents/:consentId/revoke
GET    /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppressions
GET    /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppression-eligibility
POST   /enterprise/v1/suppression
GET    /enterprise/v1/campaigns/:campaignId/marketing-agent
PUT    /enterprise/v1/campaigns/:campaignId/marketing-agent/profiles
GET    /enterprise/v1/campaigns/:campaignId/monitoring
GET    /enterprise/v1/campaigns/:campaignId/monitoring/calls/:dispatchId
```

Marketing Agent profile 的 GET/PUT 分别要求 `campaign:read/write`、active membership 和签名 route document；PUT 还要求
幂等键、未提交草稿以及完整品牌/AI 身份/营销目的告知。Provider runtime 不使用成员 Cookie 或可伪造 tenant header，
只接受绑定当前 run/dispatch/task/session/generation/route epoch 的短期 ticket：

```text
POST   /provider/enterprise/marketing-agent/snapshot
POST   /provider/enterprise/marketing-agent/disclosure/authorize
POST   /provider/enterprise/marketing-agent/disclosure/delivered
POST   /provider/enterprise/marketing-agent/turns
POST   /provider/enterprise/marketing-agent/tts/authorize
POST   /provider/enterprise/marketing-agent/turns/delivered
POST   /provider/enterprise/marketing-agent/finalize
```

下列为完整产品目标 API；是否可调用必须以对应 ENT 任务的当前实现与 readiness 为准，客户端不得因路由出现在设计中
而显示成功：

```text
POST   /enterprise/v1/campaigns/:campaignId/validate
POST   /enterprise/v1/campaigns/:campaignId/approve
POST   /enterprise/v1/campaigns/:campaignId/start
POST   /enterprise/v1/campaigns/:campaignId/pause
POST   /enterprise/v1/campaigns/:campaignId/cancel
GET    /enterprise/v1/campaigns/:campaignId/tasks
GET    /enterprise/v1/campaigns/:campaignId/analytics
```

### 3.4 AI 客服

```text
POST   /enterprise/v1/support/channels
POST   /internal/enterprise/support/channels/authorize
POST   /internal/enterprise/support/inbound
GET    /enterprise/v1/support/queues
GET    /enterprise/v1/support/sessions
GET    /enterprise/v1/support/sessions/:sessionId
POST   /enterprise/v1/support/sessions/:sessionId/takeover
POST   /enterprise/v1/support/sessions/:sessionId/transfer
POST   /enterprise/v1/support/sessions/:sessionId/end
POST   /enterprise/v1/support/sessions/:sessionId/tools/:toolName
GET    /enterprise/v1/support/cases
PATCH  /enterprise/v1/support/cases/:caseId
GET    /enterprise/v1/support/quality/rule-versions
POST   /enterprise/v1/support/quality/rule-versions
GET    /enterprise/v1/support/quality/dashboard
POST   /enterprise/v1/support/quality/sessions/:sessionId/analyses
GET    /enterprise/v1/support/quality/sessions/:sessionId
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
GET    /enterprise/v1/meetings/:meetingId/materials/current
POST   /enterprise/v1/meetings/:meetingId/materials/generate
POST   /enterprise/v1/meetings/:meetingId/materials/:runId/publish
PUT    /enterprise/v1/meetings/:meetingId/materials/:runId/speakers/:participantId
PUT    /enterprise/v1/meetings/:meetingId/materials/:runId/actions/:actionItemId
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

`ENT-MKT-001` 当前仅开放 list/read、幂等 draft create、expectedVersion draft patch 和聚合 schedule 命令。
创建由服务端生成 ID、owner、`draft/not_submitted`、请求 SHA-256 和审计；同 tenant 创建 key 唯一。草稿字段只在
`draft/not_submitted` 可改，身份、创建 key/hash 和 createdAt 不可改写，所有 update 必须递增 version 和时间。
draft patch 和 schedule 同样要求幂等键，请求 hash 绑定 actor、campaign、command、expectedVersion 和规范化 patch；
Repository 在 tenant 事务内以 advisory lock 串行同键请求，并把结果版本写入 forced-RLS `idempotency_keys`。
同键同 hash 且聚合仍为该结果版本时返回 replayed，同键异 hash 或结果已继续演进时返回冲突，不重复写审计。

schedule API 要求 `campaign:approve`，并在行锁内依次检查 expectedVersion、`status=approved`、
`approvalStatus=approved`、policyVersion 和未来 startAt；数据库 trigger 再执行同一失败闭合不变量。成功只迁移到
`scheduled` 并写审计，不生成 task、hold、Outbox 或 Provider 调用。validate/approve/reject 属于 MKT-006，
due claim 属于 MKT-007，PSTN 外部副作用属于 MKT-008。

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
waiting -> handoff_requested|ended|failed
handoff_requested -> human_active|ai_active|ended|failed
ai_active -> handoff_requested|ended|failed
human_active -> handoff_requested|ended|failed
```

每次迁移使用 `expectedVersion` 条件更新；进入 waiting 必须绑定 active queue，进入 human_active 必须绑定
account subject 和 assigned time，failed 必须携带受限 failure code。session 身份、创建 key/hash 和创建时间
不可改写，ended/failed 终态不可删除或回退。case 与 tool execution 也分别受数据库状态迁移 trigger 保护。

恢复查询仅返回 `ended/failed` 之外的 session，按 tenant 聚合 channel、customer、queue、case、tool execution
和 communication binding。缺 binding 会保留为显式缺失证据，调用方不得补造 Provider/session 成功状态。

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

`ENT-MKT-007` 将 schedule 与任务物化放在同一 tenant transaction：从当前 approved validation 的冻结 Lead、Consent、
Policy set 出发，以分钟级 `generate_series` 在 Lead IANA timezone 中寻找首个允许窗口；解析数必须等于冻结 Lead 数，
否则零 task、零 Campaign 状态变化。task ID 由 tenant/campaign/approval/lead/attempt 确定性生成，generation hash 再绑定
scheduledAt 与 Policy，重放不会产生第二条业务身份。

Scheduler claim 先锁定当前 tenant route，校验签名 route document、home region/cell/route epoch，再使用
`FOR UPDATE OF task SKIP LOCKED` 选取 due task。claim 任务时执行原子条件更新：

```sql
UPDATE marketing_call_tasks
SET status='dispatching', version=version+1, claimed_at=:now
WHERE id=:id AND tenant_id=:tenant_id
  AND status IN ('scheduled','retry') AND version=:expected_version;
```

claim 后仍需执行：

1. consent 未撤回且未过期。
2. suppression 不命中。
3. 当前时间位于国家允许窗口。
4. 活动仍为 scheduled/running，approval snapshot 仍为 current。
5. 租户和活动并发未超限。
6. usage hold 成功。

每个 claim 在同一事务创建固定60秒 `marketing_call_seconds` hold，存储 claim token 的 SHA-256 而非明文，并绑定
owner、lease、dispatch generation 与当前 route。`0044` trigger 在 SQL 层再次验证 billing account/subscription/
entitlement、tenant/campaign capacity、Consent/Suppression/Policy/当地窗口和精确 hold；同状态改写、越权 claim、
缺 hold 或旧 route 均失败。lease 到期先将 hold 标为 expired，再把 task 清除 claim 字段并回 retry；撤回 Consent 或
写入 Suppression 则释放未派发 hold 并取消 task。

`ENT-MKT-008` 由 migration `0045` 增加 forced-RLS `marketing_pstn_dispatches`。prepare 在 Scheduler claim 的 tenant
transaction 内重读 token hash/generation、route lock、approval、active Lead/link、Consent、Suppression、Policy/
当地窗口和当前 entitlement，要求 lease 至少再有效15秒。成功后创建确定性的 communication session/binding、无
明文号码的 Outbox，以及固定 task/campaign/session/binding/hold/route/provider fingerprint/idempotency key/request
hash 的 dispatch。号码只通过现有 tenant keyring 在事务提交后的 Provider request 内存中解密。

外部调用只允许 HTTPS PSTN Bridge，Bearer 凭据不落库，超时上限10秒。Provider 必须声明持久幂等保证并配置独立
webhook secret，否则 readiness 为 `not_ready`。Provider 明确 accepted 后，第二个 tenant transaction 用
`marketing:pstn:settle:<dispatchId>` 首次结算60秒，随后在数据库 trigger 要求 dispatch evidence 的前提下执行
`dispatching -> dispatched`、binding `dispatching -> active` 和 Outbox published。相同 dispatch/generation 重放读取
既有记录，不再产生 Provider 或 ledger 副作用。

超时、断连、408/425/429/5xx 进入 `unknown` 和 reconciliation required；同 generation 存在 prepared/unknown/
accepted/answered dispatch 时 Scheduler reaper 不回收 task/hold，防止响应丢失后的盲目重拨。明确 Provider 拒绝才把
dispatch 标为 failed 并释放 hold，task 继续由原 lease 到期恢复。该保留态必须通过 Provider 幂等查询或 webhook
对账，不能被运维手工改写为成功。

PSTN Bridge 把 `tenantId/homeRegion/cellId/routeEpoch/taskId/dispatchGeneration` 写入 Provider metadata，enterprise
status sink 将其转换为独立 webhook body，并对完整 body 做 HMAC-SHA256。API 以 source+provider event ID 写 Inbox
去重，重读当前 route 和 dispatch provider call fence 后推进 accepted/answered/completed/failed；task、binding、
dispatch、Inbox 和 audit 在同一事务提交，重复或迟到事件不重复创建 session 或 ledger。当前未运行 `0045`、forced
RLS、真实 Provider/PSTN、响应丢失对账和并发门禁，故不构成生产可用结论。

`ENT-MKT-009` 在 PSTN prepare transaction 内先解析目标国家/locale profile，并通过现有 terminology resolver 固定当前
有效 published Term Pack/Script Template；profile、内容版本或 LLM/runtime binding 任一不 ready 时，不创建 PSTN
dispatch。成功时 `marketing_agent_runs` 与 dispatch 同事务创建，Bridge request 增加 `runtimeUrl/ticket/runId`，但不携带
知识正文、号码或签名 secret。ticket 为300..3600秒短期 HMAC，要求 HTTPS runtime，并绑定 tenant、dispatch、task、
communication session、dispatch generation 和 route epoch。

每轮 prepare 在 tenant transaction 重读 ticket fence、active run、disclosure delivered、profile/content 版本与 locale，
从 published tenant knowledge 获取 evidence，并以 request/context/evidence hash 创建 prepared turn；Provider 在事务外执行。
complete 再次匹配 run/turn/version，将严格输出和压缩上下文原子落库。一般 answer/objection 必须携带本轮 evidence citation；
qualification 必须逐条使用 profile 原问题；服务端同时阻断价格、付款、退款、合同、医疗、法律、金融保证类措辞。

退订和转人工不交给 LLM 自由判断：命中 profile 词表后服务端分别写 suppression+end，或写 handoff_requested+stop。后者
不等于坐席已接通；`ENT-MKT-011` 只在冻结策略、唯一 claim、AI fence 和 Provider 媒体回执分层完整时才能证明接管。TTS 前必须 authorize，playout 后必须 delivered；终态文本交付后 run
收敛，PSTN 先终态时 finalize 仍通过同一 ticket fence 收口。Provider 或知识失败使用明确降级话术并停止，不生成外部
成功、Outcome、资料发送、预约或回访记录。

`ENT-MKT-010` 的两个读取 API 都要求 active membership、`campaign:read` 和签名 route document，route/body 不接受
tenant 或 actor 覆盖。Campaign 级 snapshot 返回最多100条最近 dispatch、全量聚合计数、transport/freshness 和
`truncated`；单通话 API 先重验 dispatch 属于同 tenant/Campaign，再返回最多200条公共最终修订字幕、100条 Agent turn
和200条 scoped Provider operation。legacy/SQLite 固定 `enterprise_postgres_required`，跨租户或跨 Campaign ID 返回404。

投影不新建 monitoring 表：dispatch/task/run/turn 的既有 server truth 与公共 scoped communication tables 仍是唯一真值。
状态 age 以服务端 `generatedAt` 计算；accepted/answered 超15秒未变化标记 stale，accepted/answered 且10秒未交付
disclosure 标记 warning，unknown/failed/Agent failed 标记 critical。当前 `transport.mode=snapshot`、
`refreshAfterMs=5000`、`streamStatus=not_configured`，因此 UI 必须写明“非流式”，不能用轮询冒充 WSS/SSE 成功。

`ENT-MKT-011` 用 `0047` 增加 `marketing_handoff_policies` 和 `marketing_handoffs`。策略只能在
Campaign=`draft` 且 approval=`not_submitted` 时写入，引用当前 tenant 的 active Support Queue 和 PSTN
Support Channel，timeout 限制10..86400秒，callback delay 限制60..604800秒。审批快照包含完整
policy/resource 状态，snapshot/hash 漂移使 approve 失败闭合。

handoff turn 真实 delivered 后，runtime 在同一 tenant Unit of Work 内保留 Marketing run
`handoff_requested`、复核 dispatch/task/communication binding，建立 shadow Support Customer/Session、依次推进
`created -> waiting -> handoff_requested`，并写入 bridge。任一状态或绑定失败整体回滚。bridge 不存 claim ID；
existing `support_agent_claims` 及其 lease/reassign guard 仍是唯一坐席真值。

Support workbench 通过 communication session 解析 bridge，读取原 Marketing transcript。activate 先复核
active claim、`human_active` shadow session 和 delivered handoff turn 形成的 AI 数据库 fence，然后在事务外
调用 environment Provider，再回 tenant transaction 写回执。其中 DB fence 不代表物理音频已停止；media
active 必须有同一 handoff/claim 的 Provider receipt。

Provider 只接受 `pstn_http|pstn_fonoster` 和 HTTPS URL，token 至少16字节，并要求显式声明
idempotency、operator join 和 `AI_STOP_GUARANTEE_MS=300`。请求携带稳定幂等键并在300ms abort；响应需
`status=completed`、`stopLatencyMs<=300`、规范 stop/join timestamp 与 receipt ID，且 join 不得早于 stop。
缺任一字段、超时、迟到或 HTTP 错误均不得写 media active。

内部 timeout 入口要求内部密钥、签名 route document 与当前 tenant/homeRegion/cellId/routeEpoch，
批量处理最多100条已过期且无 active claim 的 bridge。Worker 结束 shadow Support Session，再写
`timed_out` 或 `callback_required`和审计 `physicalProviderAction=not_verified`。这一收敛不执行物理挂断，
也不得声称回拨已排程/已接通。真实 Provider/PostgreSQL/300ms 证据缺失时任务保持 `in_progress`。

`ENT-MKT-012` 暴露 `GET/POST /enterprise/v1/campaigns/:campaignId/outcomes`。两条路由都要求 active membership、
签名 route 和 `campaign:read`；创建额外要求 `campaign:write`、严格 body、客户端 tenantId 拒绝和 idempotency key。
Repository 以 tenant/task advisory transaction lock 串行化并发，先做 idempotency replay/conflict，再拒绝任何已存在
Outcome，包括 `legacy_unverified` 旧行。

创建时 Repository 从服务端读取终态 task/dispatch、可选终态 Agent run、handoff、suppression 和 Provider 失败证据；
用户选择的字幕必须仍是当前最大 revision，Agent turn 必须已 delivered。原始字幕只参与 hash，不写 Outcome evidence document
或 audit。选择证据和系统证据按类型/ID 排序后生成 evidence hash，所有终态 source 生成 source hash；事务内再校验
disposition/intent/action 组合与 evidence eligibility，然后一次写 Outcome 和可选 requested action。

`POST` 返回的 action 只证明内部请求存在；审计固定 `externalAction=not_executed`。本 runtime 没有 CRM/日历/消息 Adapter、
Outbox 或 Provider 调用，相关外部完成证据归 `ENT-MKT-013`。legacy/SQLite runtime 明确 unavailable。当前测试只定义未运行，
真实 `0048` migrate/down、forced-RLS/双租户、并发、通话和浏览器仍待验收。

`ENT-MKT-013` 暴露 `GET /enterprise/v1/campaigns/:campaignId/crm-syncs` 和
`POST /enterprise/v1/campaigns/:campaignId/outcomes/:outcomeId/crm-sync`。读取要求 `campaign:read`，请求要求
`campaign:write`、active membership、签名 route、`Idempotency-Key` 和 `expectedOutcomeVersion`。事务先验证当前
Campaign/Outcome/version 和单一 sync，再由 command service 校验 tenant-bound Salesforce 配置及 CRM payload keyring，
原子写 sync + Outbox + audit；HTTP 202 只表示入队。

Salesforce 配置要求 `ENTERPRISE_CRM_PROVIDER=salesforce`、租户 UUID、HTTPS My Domain/login URL、Client ID/Secret、
受控 API version、sObject API name、External ID field 和 payload field。Worker 用 OAuth Client Credentials 获取 token，
向 `/services/data/{version}/sobjects/{object}/{externalField}/{stableKey}` 发送 PATCH；随后 GET 同一资源并比较 External ID、
规范 JSON 载荷和 15/18 位 Record ID。只有 GET 对账结果才产生 `marketing_crm` synced receipt。401 重新取 token；
408/409/425/429/5xx、传输失败、receipt 不完整或 GET 暂不可用继续同 event/同 stable key 指数退避。400/403/404 等
明确拒绝形成 failed receipt。Worker 在第二个 tenant transaction 原子更新 sync/outbox/audit，CRM 故障不回滚 Outcome、
通话终态或结算。

tenant binding、object name 与不含 secret 的 configuration fingerprint 必须同时匹配入队快照，避免旧 Worker、跨租户
密文或配置漂移误投。缺配置时 API 返回 not_ready，Provider 未回执时 Web 固定显示 pending。当前未运行 `0049`
migrate/down/forward、forced-RLS/双租户、并发/崩溃/未知响应、真实 Salesforce sandbox 或浏览器验收。

`ENT-MKT-014` 暴露 `GET /enterprise/v1/campaigns/:campaignId/analytics`，只允许 active membership、
`campaign:read` 和有效签名 route。legacy/SQLite 返回 `enterprise_postgres_required`，跨租户或不存在 Campaign 表现为404。
Repository 在 `REPEATABLE READ READ ONLY` tenant transaction 内并行读取同一快照：

1. 漏斗按 active Campaign Lead、已物化 task、`accepted_at`、`answered_at` 和 `evidence_status=verified` Outcome 依次计数；
   相邻阶段分母为0时 rate 为 null。
2. 正向兴趣只含 `potential_lead/appointment_requested`；next action 只计 requested；CRM 只计 `status=synced` receipt。
3. 投诉只计 `source=complaint + origin_campaign_id`。总体/国家使用明确 Campaign 归属；版本只使用
   `source_reference=communication_session_id` 的精确会话归属，其他投诉不会猜测版本。
4. 用量从 `tenant_usage_events` 连接 `marketing_call_task` hold，并叠加引用原 settle ledger 的 adjustment，分别返回
   settled/adjustment/net/event count。货币对象固定 `amount=null/currency=null/reasonCode=pricing_not_configured`。
5. 国家来自冻结 Lead country；执行版本键包含 run 的 profile version、Term Pack/Script Template version ID、Agent
   fingerprint 和 dispatch 的 PSTN Provider/fingerprint。没有 run 的 call 仍进入总体/国家，但不伪造版本。

响应声明 `snapshot=repeatable_read`、`outcomeEvidence=verified_only`、`complaintEvidence=explicit_suppression_only` 和
`externalSuccess=reconciled_receipt_only`。Web 只在面板展开时发起分析请求，代码随 Outcome lazy chunk 加载；当前未运行测试、真实 PostgreSQL/RLS、
浏览器或容量门禁，不能据此宣称成本、投诉率或活动分析已通过生产验收。

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

`ENT-CS-004` 将该契约实现为 strict `json_schema` 请求，并显式发送 `enable_thinking=false`。解析器要求六字段精确匹配；
额外 `thinking/reasoning/analysis`、非 `null` 工具请求、无证据的 `answer/qualify`、不属于本轮 evidence 的 citation，
以及带风险但未 handoff 的输出全部拒绝。Prompt、客户 query、evidence content 和 thinking 不写日志/审计；审计只写
run/turn、generation、result count、knowledge version/block/citation/content hash。

生成分为 prepare/Provider/complete 三段。prepare 在 tenant transaction 中校验 ticket、lease、binding、policy、
generation、support session 和当前 published evidence，按 `(run_id,idempotency_key)` 创建 `prepared` turn；Provider 在事务外
受8秒默认超时约束；complete 重新检索并比较 evidence hash，再次 authorize dispatch，最后原子保存 output/context 和
handoff 状态。知识在两段之间变化时返回 `knowledge_changed`，不把旧证据结果提交。

Worker 只从独立 `support-agent-server` 启动，启动时要求显式 enabled、LiveKit dispatch、cell ID、内部 API 凭据和
ASR/TTS 模型。API-backed LLM 在返回文本前调用 `/tts/authorize`；该入口再次执行 dispatch/policy/generation fence，
且 `(run,turn)` 重试只返回同一授权。Worker 在短期 dispatch ticket 到期前调用 refresh，并拒绝 ticket/tenant/session/
cell/route/generation 绑定变化。LLM stream 被中断时向未完成 HTTP 请求传播 AbortSignal并清空待交付队列；心跳失败
强制 `interrupt + clearBuffer + audio disable + shutdown(drain=false)`。`turns/delivered` 仅在未中断的 playout 完成后推进状态；
`handoff/end` 话术交付后 Worker 主动退出，前者保留人工接管状态，后者原子收敛 support session 终态。

### 7.1 Tool Registry 与服务端授权

`ENT-CS-005` 不放开 Agent 的 `toolRequest`，而是先提供一个供后续 Adapter 调用的内部授权网关。
管理 API 用 `support:manage` 创建/发布/退役定义，用 `support:read` 列表；每个路由同时要求 active
membership 和签名 tenant route document。客户端提交的 risk/scope/confirmation 必须精确符合服务端固定映射：

| risk | required scope | confirmation | 首个允许状态 |
| --- | --- | --- | --- |
| `read` | `support:read` | `none` | `requested` |
| `reversible_write` | `support:manage` | `customer_confirmation` | `awaiting_confirmation` |
| `high_risk` | `support:takeover` | `human_handoff` | 不创建 execution |

输入 schema 只接受根 object、`additionalProperties=false`、最多32个 primitive 字段和8192字节规范化
JSON；定义和参数分别生成 SHA-256。内部 authorize endpoint 先校验内部凭据，再验证签名
`voice_agent_runtime` ticket，并在同一 forced-RLS tenant Unit of Work 中重读 lease、binding、policy、
route epoch、generation、run、support session 和 active definition。请求不能提交 tenant/customer/session 覆盖，
数据库只保存参数 hash 和注册版本身份。

Repository 以 tenant 行锁串行化同名 revision，发布新版时在同一事务退役旧 active 版；定义触发器拒绝
内容改写、跳版、逆向状态和删除。`tool_executions` 的复合 FK 精确绑定 tenant/definition/name/
revision/risk/scope，insert trigger 再检查 active 和确认形状，并强制高风险失败闭合。升级时已存的
未注册非终态 execution 统一转为 `cancelled`，避免旧记录继续推进。该转换不在 down migration 中伪造恢复原状。

授权记录并不表示 Adapter 已执行；只读、可逆写和高风险实际流程仍分别归属
`ENT-CS-006/007/008`。未配置外部 Provider 时不会伪造工具成功。

### 7.2 只读 Tool Adapter 与租约执行

`POST /internal/enterprise/support-tools/execute-read` 只接受内部 Bearer 凭据、签名 Worker ticket、
worker cell/worker/run/execution ID 和原始参数。运行时重新计算 active revision 的参数 hash，并只允许
`order.lookup`、`logistics.lookup`、`inventory.lookup` 且风险/scope 精确为 `read/support:read`。
tenant、support session 和 customer 全部来自 ticket、run 和数据库绑定，不能由调用方覆盖。

执行分三段：

1. 在 forced-RLS tenant Unit of Work 内锁定 execution，复核 dispatch/lease/binding/policy/route/
   generation/run、`ai_active` session、customer、active definition、schema 和 arguments hash；以15秒
   lease、随机 lease ID、递增 attempt、Provider fingerprint 和 `simulated` 原子 claim。
2. 提交事务后调用 Adapter，最长5秒并传入 AbortSignal。输出必须严格匹配对应 found/not-found union，
   未声明字段、非法时间/数量/标识、超长引用或异常 reason code 均转换为安全失败。
3. 在新的 tenant Unit of Work 内重新执行 Worker/run/session/customer/definition fence，并以
   execution version 和 lease ID CAS 写入 completed/failed。租约到期、被重领、definition 退役、接管或
   generation 变化时，迟到结果不进入数据库。

`0031_enterprise_support_read_tools` 为 `tool_executions` 增加 attempt、lease、Provider 证据、结果 JSON/
SHA-256 和失败码。CHECK/trigger 固定 read 状态形状，禁止 attempt 跳跃、租约字段旁路改写、时间倒退、
过期完成、结果/失败字段越迁移和终态更新；completed 必须同时存在 Adapter receipt/reference。完成回放
重新做严格结果校验并重算 hash，不信任数据库 JSON
类型声明。订单和物流 mock 以 `tenantId + customerId + identifier` 查找，其他客户返回同样的 not-found；
库存 mock 只绑定单一 tenant。生产组合只注册 unavailable Adapter，因此未配置外部系统时返回
`not_configured`；mock readiness 和响应固定 `simulated=true`，不得作为真实 Provider 证据。

本任务不改变 Support Agent 六字段输出，`toolRequest` 仍为 `null`；模型到授权/执行的自动编排、
高风险人工接管和真实 ERP/物流/库存凭据分别留给后续任务与试点配置。

### 7.3 可逆写确认、密文 Outbox 与一次性副作用

`POST /internal/enterprise/support-tools/prepare-write-confirmation` 只接受签名 Worker ticket、run/
execution、run locale 和原始参数。运行时重算 active revision schema/arguments/request hash，并只允许
`ticket.create`、`callback.schedule`、`note.add` 且风险/scope/确认模式精确为
`reversible_write/support:manage/customer_confirmation`。Adapter readiness、租户绑定、幂等保证或
payload keyring 任一缺失时返回 `not_configured`，不创建确认挑战。

挑战以随机 UUID、prompt hash、run ID、当时 `lastTurnSequence`、requested/expires time 写入
`tool_executions`，有效期120秒。`confirm-write` 必须引用同 challenge 和挑战后新产生的同 run/session
客户 turn，且原始确认文本 SHA-256 必须等于 turn 中不可变 hash；只接受封闭的确认/拒绝短语，含糊
回复保持 awaiting，不执行。回拨 `scheduledAt` 在挑战和确认时均需晚于服务端当前时间。

确认事务先以 execution version CAS 写入 response/turn/Provider evidence 和 `write_outbox_event_id`，再
插入唯一 `support.tool.write.requested`；到 Outbox 的原始参数使用 AES-256-GCM，AAD 绑定 tenant/
execution/customer/tool/idempotency，外键为 deferrable 以保证同事务原子性。拒绝只写不可变确认证据
并进入 `rejected`，不会产生 Outbox。keyring 由
`ENTERPRISE_SUPPORT_WRITE_PAYLOAD_ACTIVE_KEY_ID` 和
`ENTERPRISE_SUPPORT_WRITE_PAYLOAD_KEYS_JSON` 提供，轮换时旧 key 必须保留到对应 Outbox 全部终结。

Cell Worker Publisher 在解密前验证 event/aggregate/tenant、payload hash、Provider fingerprint 和
`idempotencyGuaranteed=true`。每次重试向 Provider 提交同一幂等键；超时、异常、配置变化或缺失 receipt
均保持 `confirmed` 并指数退避，不能盲目生成第二次副作用。只有严格结果加 reference 或带 reference
的确定失败，才在同一 tenant transaction 中递增 execution attempt、写 completed/failed、发布 Outbox
并追加不含参数正文的审计。`0032_enterprise_support_write_tools` 的 CHECK/FK/trigger 固定挑战、决策、
Outbox、Provider、attempt、结果和终态形状，拒绝确认前入队、证据替换、attempt 跳跃和终态改写；down
migration 在已经确认或产生外部写证据时失败闭合。

生产 API 和 Worker 默认均使用 unavailable Adapter；可注入 tenant-bound mock 以相同幂等键多次调用时
只记录一次有效效果并固定 `simulated=true`。这不是工单/CRM/回拨 Provider 的真实成功证据。Support
Agent 输出仍固定 `toolRequest=null`，自动从模型请求推进确认不属于本批。

### 7.4 高风险接管请求与不可执行边界

`ENT-CS-008` 沿用 `/internal/enterprise/support-tools/authorize`，但 high-risk 分支不再只返回瞬时
`handoff_required`。运行时验证 active definition 的封闭 schema 后，按工具名前缀把风险归为
`refund/payment/identity/other_high_risk`，并生成：

```text
riskEvidenceHash = SHA256(policyVersion, riskLevel, scope, confirmationMode,
                          riskCategory, definitionId, toolName, revision, argumentsHash)
requestHash = SHA256(runId, sessionId, customerId, riskEvidenceHash, policyVersion)
```

`0033_enterprise_support_high_risk_handoffs` 新增
`support_high_risk_handoff_requests`。每行固定 `high_risk + support:takeover + human_handoff +
ent-cs-008.v1`，以复合 FK 绑定 session/customer、run 和精确工具 revision；唯一
`(tenant_id,idempotency_key)` 只允许同 request hash 重放。表不保存原始参数、客户话语、支付或身份材料，
也没有可执行 payload、Provider reference 或成功状态。

insert trigger 在数据库内再次读取 session、run 和 definition，要求三者均 active、run 归属 session 且
definition 仍为 human_handoff；mutation trigger 无条件拒绝 UPDATE/DELETE。Repository 先锁定并检查既有
幂等键，首次创建只允许 `active + ai_active`，随后同事务执行
`support_agent_runs.active -> handoff_requested` 和
`support_sessions.ai_active -> handoff_requested`。任一 fence 丢失抛错并整体回滚；重放只返回同一 request ID，
不重复状态迁移。

既有 `tool_executions_registry_insert_guard` 仍拒绝所有 high-risk execution，因此该路径永远不创建 execution、
确认挑战、Outbox 或 Adapter 调用。run 已进入 handoff 时，TTS authorize 只接受 turn status=`handoff`，
拒绝新的普通 generated/degraded 回答。审计只保存工具、definition、handoff request ID、risk evidence hash
和 replay 标志。本批没有 queue/claim/assignment 字段，不会声称已经有坐席接管；该状态由 `ENT-CS-009`
继续推进。`0033` down migration 仅允许空请求表回退；已有接管证据时失败闭合，不静默删除审计依据。

### 7.5 坐席队列、租约和改派

`0034_enterprise_support_agent_queue` 为 queue 增加10至86400秒的 handoff SLA 和30至3600秒的 claim
lease；新增 `support_agent_claims`，状态为 `active/released/reassigned/expired`。记录固定 tenant、session、
queue、agent、creation key/hash、claim/lease 时间和可选 previous claim；终结时必须一次性写入 release
actor/reason/key/hash，identity 字段不可更新，终态不可再次更新或删除。down migration 只允许 claim 表为空。

`support_sessions.active_agent_claim_id` 通过 deferred 复合 FK 引用 `(tenant, claim, session, agent)`；
状态 CHECK 要求 `human_active` 同时具有 assigned user 和 active claim，其他状态不得携带当前控制权。
claim insert trigger 复核 session=`handoff_requested`、同 queue、无当前 claim、queue active、member active
且角色允许；部分唯一索引阻止两个事务同时取得同一 session。

外部 API 为 `POST/GET /enterprise/v1/support/queues`、
`GET /enterprise/v1/support/queues/:queueId/work-items`、
`POST /enterprise/v1/support/sessions/:sessionId/claims` 和 claim 的 `renew/release/reassign` 子资源。
所有 API 先校验 account、membership、scope 和签名 tenant route；claim 不接受 agent 字段。改派在 HTTP 与
runtime 两层都限制 owner/admin/support_manager，目标必须是同 tenant 的 active 客服成员。Repository 统一
以 session-first 锁顺序执行，避免 claim/session 反向锁死；claim、到期回收、释放和改派的状态变化与审计
处于同一 tenant Unit of Work。

队列投影按 `SLA breached DESC, priority DESC, handoff_requested_at, session_id` 排序，并把 lease 已过期的
`human_active` 映射为 `claim_expired`。只读不隐式改写；竞争者实际 claim 时用 claim/session version fence
终结旧 lease 后再接管。当前未执行 PostgreSQL up/down、forced-RLS 双租户、两个坐席竞争、断线回收或真实
人工媒体验收，因此 `ENT-CS-009` 仍为 `in_progress`，也不代表 `ENT-CS-010` 工作台已实现。

### 7.6 坐席工作台聚合、租约心跳和停止栅栏

`POST /enterprise/v1/support/sessions/:sessionId/workbench` 用于打开或恢复工作台，`GET` 返回后续只读快照。
二者都要求 `support:takeover`、签名 tenant route 和服务端 membership；runtime 锁定 session 与 active claim，
要求 session=`human_active`、`active_agent_claim_id` 与 claim/session/agent 一致、claim 未过期，且当前 actor
为 assigned agent 或 owner/admin/support_manager。跨 tenant ID 先由 tenant query/forced RLS 隔离，不能用
manager 身份越过 tenant。

新 claim 在 `support_sessions.human_active` 提交前后同一 Unit of Work 内读取该 session 最新 Agent run：
`active/handoff_requested/ending -> cancelled`，已 `cancelled` 返回 stopped，`completed/failed` 返回 terminal，
无 run 返回 not_started。上述状态是 ready 工作台唯一允许的 `aiSpeechFence`。worker authorization 不接受
cancelled run，因此旧 ticket 即使仍未到期也不能 prepare、authorize TTS 或 deliver；该栅栏不替代 LiveKit
已经开始播放音频的 interrupt/ack。

涉及 run 与 session 的 claim/activate 先锁最新 Agent run，再锁 support session/claim，与 Worker 完成 turn、
handoff 和 finalize 的 run→session 顺序一致；纯 queue/claim 操作仍维持既有 session-first 顺序。这样不会为
停止栅栏引入新的反向锁序；任一事务被外部锁或 CAS 拒绝时整体回滚并由客户端使用原幂等键重试。

快照只公开客服所需字段：客户 display/external/locale/attributes/consent、queue/session/claim、case、工具
结果、高风险类别、Agent 有界上下文/已生成输出，以及最多200个最终 revision 字幕。phone hash、request hash、
idempotency key、密文 outbox、dispatch ticket、Provider secret 和原始高风险参数不返回。字幕以 start time、
created time、segment ID 稳定排序；无字幕不补造文本。

claim renew 使用 expected claim version，并更新为 `now + claimLeaseSeconds`；Web 在剩余租期一半时续租，最长
60秒检查一次。字幕 GET 与续租独立，乱序快照不得覆盖更高 claim version。release 仍使用 claim/session 双
version 和新幂等键。知识检索复用 `POST .../rag`，维度只取当前 Agent run；无 run 时入口禁用。媒体 mute、
transfer queue、end call 继续返回 `not_ready + reasonCode`。`ENT-CS-011` ticket/callback 则读取服务端
Adapter/keyring readiness：未配置时禁用，ready 时才开放异步提交。

本批定义 `AC-ENT-0031`，但未运行 API/RBAC、Repository、forced-RLS、双坐席、lease、Worker/TTS、浏览器、
真实 PostgreSQL 或 LiveKit 矩阵，因此 `ENT-CS-010` 保持 `in_progress`。

### 7.7 工单、回拨与可靠后续动作

人工坐席命令使用 `POST /enterprise/v1/support/sessions/:sessionId/followups/tickets|callbacks`。HTTP guard
要求 `support:takeover` 和签名 route document；runtime 再锁定 session/active claim，要求 actor 是 assigned
agent 或同租户 owner/admin/support_manager，并复核 body 的 session/claim expected version。tenant、customer、
agent、claim 和业务 ID 均由服务端导出，请求体不能覆盖。工单主题/说明分别限制160/2000字节，回拨原因限制
500字节且 scheduledAt 在提交时必须严格晚于服务端 now。

`0035` 新增 `support_callbacks` 与 `support_followup_commands`。两表都有 tenant-first FK、forced RLS、
复合唯一键和 mutation trigger；command 以 `(tenant, session, idempotency_key)` 唯一并保存 request hash，
同键同请求返回原 processing/终态记录，同键异请求冲突。command/case/callback/outbox ID 由 tenant、session、
kind 和幂等键确定性生成，使两个并发事务不会在唯一键竞争后留下随机孤儿 case。工单创建为 pending case；
回拨创建为 dispatch_pending callback。

创建事务先确认 AES-GCM keyring 和 Adapter readiness；任一 not_configured 不落业务行、审计或 Outbox。ready
时把 case/callback、followup command、`support.followup.requested` 密文 Outbox 和不含主题/说明/原因的审计
原子提交。sealed payload 复用 CS-007 的 tenant/customer/tool/arguments hash/fingerprint/simulated fence，
Provider 幂等键固定绑定 command ID。Web 只显示 processing，不把本地 ID 当外部成功；simulated 始终显式标记。

Cell Worker 在事务外调用 Adapter。网络超时、异常、fingerprint 变化、密文/AAD/receipt 校验失败都只递增
command attempt、记录安全 reason code、按指数退避重排同一 Outbox；不会写 external ID 或确定失败。确定完成
必须有匹配 command/tool/provider 的 receipt/result hash/reference，随后在同一 tenant transaction 中把 case
推进 open 并写 external ticket ID，或把 callback 推进 scheduled 并写 external callback ID，同时终结 command、
发布 Outbox 和追加审计。带 reference 的确定失败进入 failed；case 保留 pending，callback 进入 failed。finalize
不复核会话仍活动，故坐席释放或结束会话不阻塞已接受的后续动作。

本批定义 `AC-ENT-0032`。按持续边界未运行 migration、API/Repository/Worker 自动化、forced-RLS、并发、
崩溃恢复、浏览器或真实 Provider，因此 `ENT-CS-011` 保持 `in_progress`，不能宣称企业生产门禁通过。

### 7.8 客服质检规则、复核和证据

`quality:read` 只授予 owner/admin/support_manager/auditor，`quality:manage` 只授予
owner/admin/support_manager。所有五个路由先解析 active membership、scope 和签名 tenant route，再创建
TenantContext；请求体不接受 tenant、actor、revision、engine 或结果字段。SQLite/JSON runtime 不实现该接口，
缺 PostgreSQL 时返回 `enterprise_postgres_required`。

规则发布请求只含 locale、1..16 个身份告知短语、0..32 个禁用承诺和幂等键。服务端固定引擎
`support-quality-v1`，NFKC 规范化后拒绝重复短语，并以规范请求 hash 实现同键同请求重放、异请求409。
`0036` 的 `support_quality_rule_versions` 通过 tenant/idempotency 唯一键、active publisher insert guard、
forced RLS 和 UPDATE/DELETE trigger 固化不可变版本；精确 locale 优先于 `*`，再取最新发布时间/revision。

分析命令在一个 tenant Unit of Work 中锁定 support session 和最新 Agent run。session 只允许 ended/failed，
run 只允许 completed/failed/cancelled。source hash 覆盖 session/run 的 ID、状态、version、更新时间，以及每个
turn 的 ID、sequence、状态、version、evidence hash、输出、failure 和 deliveredAt；review ID 由 tenant、
session、rule 和 source hash 确定性生成。`(tenant, session, rule, source_hash)` 唯一约束使并发和重试返回同一
review，证据或规则变化则追加新记录。

确定性规则按 sequence 处理具有输出的 turn：完全无 delivered 输出产生 `response_not_delivered/high`；首次
delivered 输出未命中身份告知产生 `identity_disclosure_missing/medium`；answer/qualify 无 knowledge citation
产生 `answer_without_citation/high`；存在 risk signal 但 intent 非 handoff 产生
`risk_without_handoff/critical`；命中禁用承诺产生 `prohibited_promise/high`。每个 finding 的 evidence hash
绑定 turn ID/version/status/output。review、finding 和审计同事务提交；计数必须与 severity 分解精确一致。

当前 schema 有意要求 review 为 `partial`、semantic status 为 `not_configured`、reason 为
`support_quality_semantic_model_not_configured`。Dashboard 对每个 session 只聚合最新 review，
`semanticIncorrectAnswerRate` 固定为 `null`。这条数据库约束避免 API 或直接 SQL 把结构命中伪装成语义完成；
未来接入语义 Adapter 时必须以新 migration、模型 fingerprint、金标集和独立验收升级，不能静默改变 v1 口径。

详情 API 返回 review/rule/finding、最小 session/run 字段、Agent turn 输出、每段最终字幕和安全工具执行字段；
不返回 tenant ID、客户电话/hash、请求/幂等键、dispatch ticket、Outbox 密文或 Provider secret。Web 复用数据分析页、
Material 图标、StatusPanel 和既有响应式/主题 token，管理表单仅对 `quality:manage` 显示。

本批定义 `AC-ENT-0033`。当前未运行 API/RBAC、Repository、migration/down-forward、forced-RLS 双租户、并发、
浏览器、axe 或人工语义金标矩阵；也未实现自动批处理或语义 Adapter，因此 `ENT-CS-012` 保持 `in_progress`。

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

`POST /enterprise/v1/support/sessions/:sessionId/rag` 是 `ENT-CS-003` 的会话级受控入口。它要求 active
membership、`support:read` 和有效签名 tenant route，body 只接受 query/locale/country/product/limit，
不接受 tenantId。runtime 先在 tenant transaction 中确认会话存在且状态属于 `waiting|ai_active|handoff_requested|
human_active`，再调用同一 Knowledge Repository。命中返回 `answer_with_citations` 与逐条 evidence；零结果返回
`state_uncertain_and_offer_handoff`、本地化无法确认文案和 `handoffRecommended=true`。该层不调用 LLM，不能生成
无引用企业事实。检索审计只记录维度、结果数，并为每条证据记录 knowledge version/source/revision/block/content hash；
query、content 和提示词均不写入审计。

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

当前 `0026_enterprise_meeting_screen_ocr` 增加 `runs/subscriptions/commands/frames/blocks` 五张 tenant 表，全部使用
tenant-first FK 和 forced RLS。command 与 block append-only；frame 只允许 `processing -> ready|failed`，且身份、hash、
尺寸和采集时间不可改写。订阅 FK 同时绑定 meeting/share/generation/target language/run，切换语言会结束不再有订阅的旧 run。

客户端只提交 `shareId + expectedShareVersion + targetLanguage + displayMode`，服务端从当前租约派生 publisher identity、
track SID、cell、route epoch 和最多五分钟的 HMAC ticket。LiveKit Agent 使用 `SUBSCRIBE_NONE` 入房，snapshot/refresh/claim/
complete/fail 每次都重读 tenant、meeting、binding、share lease、run 状态和启用订阅；随后只显式订阅 ticket 指定发布者、
track SID、`SOURCE_SCREENSHARE` 视频。关闭订阅或 share/route/generation 变化后下一次 claim 失败闭合。

Worker 每1至2秒对 RGBA 帧计算64位 average hash，API 在外部 Provider 调用前以 tenant/run 行锁比较精确 hash 和 Hamming
distance；仅新帧写入不可变 `screen_ocr_frames` usage event/ledger。原始像素只存在于 Worker 内存和受控 HTTPS Provider
请求，不进入 API、PostgreSQL、对象存储或日志。Provider 响应最多100个块、9KiB布局，坐标归一化且携带实际 fingerprint。
布局经服务端 LiveKit 定向 data channel 发送；投递失败不回滚已完成 OCR，客户端以四秒 API 轮询降级读取。

Provider readiness 新增 `screen.ocr` capability，只有独立 HTTPS health probe 返回状态、features 和 fingerprint 才可显示
ready；`ENTERPRISE_SCREEN_OCR_ENABLED=false` 或 Provider/endpoint/key/dispatch/签名/RTC 缺失均明确 not configured/failed。
Web 和 Flutter 都以 contain 后的真实内容矩形映射归一化坐标，可切换原图、译图、双语；事件必须匹配
meeting、target participant、share generation、run 和递增 frame revision。当前未执行 migration、forced-RLS、RBAC、
真实 Provider、LiveKit、浏览器或真机门禁，不据此声明企业生产可用。

### 10.5 Google Calendar Adapter

`POST /enterprise/v1/meetings/:meetingId/calendar-sync` 接受 `expectedMeetingVersion + durationMinutes` 和
`Idempotency-Key`。服务端重新解析 tenant membership、`meeting:write`、签名 route 和 `calendar.meetings` 实时
readiness，并在 PostgreSQL 行锁内确认当前 actor 是 host、会议为未来 `scheduled` 状态且版本一致。GET 只允许 host
读取当前同步记录。客户端不能提交 tenant、Provider event ID、标题、开始时间或加入链接。

`0027_enterprise_meeting_calendar_sync` 保存 tenant/meeting/provider、稳定 event key、request hash、outbox ID、
attempt、Provider reference 与单向状态；复合 FK、唯一约束、forced RLS 和 trigger 阻止跨租户关联、同会议重复创建、
不可变请求漂移、终态改写和删除。API 在一个 unit-of-work 中写 sync、outbox 与 audit；Worker 在另一个 unit-of-work
同时写 sync receipt、outbox finalize 与 audit，避免只标记一侧成功。

outbox 中的标题、起止时间和成员加入 URL 使用 AES-256-GCM 封装，AAD 绑定 tenant/sync/meeting/event key，业务列只
保留 SHA-256 与密文；key ID 支持轮换，旧 key 在 pending 事件排空前保留。Google Adapter 使用 service-account JWT、
`calendar.events` scope 和显式 impersonated subject；试点配置还要求 `boundTenantId`。创建请求使用由 tenant/meeting
SHA-256 派生的稳定 base32hex-compatible ID。POST 返回409时只 GET 同 ID 并核对 private extended properties 中的
meeting/sync；匹配则复用，不匹配则记录 collision。成功必须持久化 event ID、etag、HTTPS web URL 和响应 hash。

事件仅指向无界AI成员会议页，不申请 Google Meet conferenceData、不添加 attendee、不传播 guest token。API readiness、
direct credential、public URL、payload keyring 或 tenant binding 任一缺失均失败闭合；mock 只能注入 contract harness，
环境配置为 mock 时仍不能进入 release ready。当前未运行 contract test、migration/RLS、真实 Workspace 管理授权或客户端
验收，因此任务保持 `in_progress`。

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
形成 table count/hash/last-key hash，再汇总公共31段、企业53段 checksum、关键表、
总行数和全库 hash。维护账号必须是受审计的 superuser 或 `BYPASSRLS` 全读角色，不能复用
tenant/directory/cell 应用凭证。

证据分为 `baseline`、`cutover`、`restore` 三类，并用独立 HMAC key 签名、以 `0600`
临时文件原子替换。证据身份包含 run/cutover ID、local/staging 环境、Git commit、image digest、
topology hash、数据库 system identifier/OID、snapshot 和 WAL LSN。`cutover` 必须引用已验签
baseline 文件 hash，验证源库默认只读、写探针返回 SQLSTATE `25006`、旧 writer 角色在集群中
无会话、目标默认可写且写探针成功，再对源/目标执行第二次全量 manifest。任何表缺失、数量、
整行 hash、主键、migration 或 server version 不一致都会生成签名 `mismatch` 并以非零退出。

生产 startup gate 只接受 `environment=staging` 的 matched cutover evidence，且运行时
commit/image/topology、cutover ID、target logical ID、当前 system identifier/OID 和31+54
manifest 必须逐项一致。本地 PostgreSQL 16 演练已验证81张表、8张含记录关键表、增量后17行
全库 hash、writer fence、隔离 `pg_dump/pg_restore` 和单行篡改失败；证据见
`docs/evidence/ent-data-009-local-drill-2026-07-18.md`。这只证明机制可执行，不是异地主机
不可变 WAL/PITR、跨故障域自动选主或 RPO/RTO 证据，后者仍属于 `ENT-REL-003`/H3。

#### 11.1.2.1 企业备份和灾备证据门禁

`ENT-REL-003` 复用 `scripts/run_postgres_resilience_drill.mjs` 和现有 release checker，但把结果升级为
schema v2。runner 在创建输出目录和执行任何 Provider 命令前读取 repository-relative cutover evidence，
用 `ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY` 验签，并要求其为 staging/matched/cutover，源目标数据库 hash
一致，且 commit、image、topology、target system identifier/OID、公共31段和 enterprise 54段 manifest 与
当前候选精确一致。DR 结果再由不同的 `ENTERPRISE_POSTGRES_DR_EVIDENCE_HMAC_KEY` 签名；相同密钥、缺密钥、
绝对/越界/符号链接逃逸路径、旧切换证据或 manifest 漂移均在命令执行前失败。

Provider Adapter 仍由受控配置提供，runner 不经 shell 执行，且每一步必须返回唯一 JSON attestation：
`schemaVersion=1`、`status=passed`、`environment=staging`、`tlsMode=verify-full`，并精确回显注入的
`runId/group/step`。固定序列为 baseline、off-host base backup、WAL archive、health-controller failover、
old-primary fencing、endpoint verify、old-primary rebuild/rejoin、off-host PITR、isolated restore verification。
每个 step 还使用精确字段白名单和安全字符串约束；额外字段在持久化前拒绝，灾备 runner 不保存原始 stderr。
任一步超时、退出非零、返回额外/错误身份或中断时，不能继续生成可提升的 `passed` 结果。

自动切换必须证明 PostgreSQL timeline 严格递增、promotion generation 有效、新 endpoint 的 system identifier
等于 cutover 目标；旧主写探针返回 SQLSTATE `25006`，旧 route epoch 与旧 Worker generation 副作用均被拒绝，
原主只以 `standby + acceptsWrites=false + timelineMatches=true` 重入。base backup/WAL 必须位于不同于全部数据库
HA 节点的第三故障域，传输和静态加密，具有对象 version、至少30天保留及 `compliance_lock` 或
`provider_retention_lock`。PITR 必须指定恢复时间和 target marker，在隔离数据库证明 target 前 marker 存在、
target 后 marker 不存在，并使目标/恢复的全量数据 SHA-256 与关键 manifest SHA-256 分别相等。

production checker 重新计算 topology/capacity/evidence 文件 hash、当前31+54 manifest 和企业 DR binding，再验
schema-v2 签名，而不是相信 result 的 `status` 字段；RPO/RTO objective 还必须携带批准 SLA 的 evidence ID 和
SHA-256，并一并进入签名结果。当前仓库未配置 Provider Adapter、第二数据库故障域、第三
备份故障域、DCS、对象锁、真实 capacity/cutover evidence，也未执行测试定义或演练，因此此实现仅为静态候选；
不得宣称 `AC-ENT-0052`、真实 PITR、批准 RPO/RTO、H3 或企业生产门禁通过。

#### 11.1.3 单租户 Cell 迁移、对账与回滚

`ENT-DATA-005` 复用 `ENT-DATA-009` 的双 manifest、数据库身份和规范 SHA-256 语义，但选择范围是单个
tenant，不是整库。维护命令为 `enterprise:postgres-cell export|cutover|reconcile|rollback`，只在
`ENTERPRISE_CELL_MIGRATION_MAINTENANCE=true` 且独立 maintenance URL 下运行。签名 metadata 固定
run/migration/tenant ID、源/目标 Cell 与 logical database ID、commit、image digest 和 topology hash；证据文件
使用独立至少32字符 HMAC key、0600临时文件和原子 rename，cutover/rollback 必须引用已验签前序文件 hash，
输出路径不得覆盖前序证据；
对象复制 receipt 使用另一把至少32字符 HMAC key，迁移证据签名权不交给对象 Adapter。

表计划通过数据库 catalog 动态生成：`enterprise.tenants` 使用 `id`，其余 enterprise 业务表必须有
`tenant_id`；发现任何没有 selector 的 enterprise 表立即失败。公共 `ai_phone` 只选择同时具有
`scope_type + scope_id` 的表，并固定 `scope_type=tenant/scope_id=tenantId`。每表必须有主键；非延迟外键生成
导入拓扑，延迟外键由目标事务 `SET CONSTRAINTS ALL DEFERRED` 处理。复合主键 keyset pagination 每页最多5000行，
`to_jsonb(row)` 经稳定 JSON、字节长度前缀形成逐表 count/hash；总 hash同时绑定31段公共 migration、52段
enterprise migration、对象引用 count/hash 和总行数。tenant 的 cell/version/updatedAt 及 pending projection cell
和易失协调 owner/generation/lease 在内容 hash 中规范为占位符，另以 route 断言要求 homeRegion/status 不变且
跨 Cell epoch 精确 +1。

迁移前置门禁如下：

1. 源 tenant 不存在非终态 communication binding、issued/accepted dispatch grant、未过期 pending lease、
   活跃公共 dispatch 或 capacity hold。
2. 源数据库 `default_transaction_read_only=on`、写探针返回 SQLSTATE `25006`，配置的 API/Worker writer role
   会话数为0；目标默认可写、写探针成功且相同 writer role 会话数为0。
3. 两端 server version、公共/enterprise migration 列表和动态表计划完全一致，源/目标数据库身份不同。
4. cutover 前的当前源 manifest 必须与签名 export 证据完全一致；目标 tenant 必须为空。
5. 只要对象引用数非0，就必须提供相同 migration/tenant/源目标 Cell/count/hash 的签名对象复制 receipt；
   本工具不伪造或隐式跳过对象字节复制。

目标导入在单一 `SERIALIZABLE` transaction 和 tenant advisory lock 内执行，以
`jsonb_populate_recordset(NULL::schema.table, page)` 恢复 PostgreSQL 原类型。tenant route 写入目标 Cell，version
只增加一次；普通 cutover 跳过 `platform_pending_work` 原始行，由 tenant job/outbox trigger 以新 Cell 重建。
事务内重新收集完整 manifest；任一记录、ledger、audit、consent、suppression、对象引用、迁移或 route 不一致均
rollback，控制面不得发布新 route。
若数据库已提交但最终 evidence 文件落盘失败，`reconcile` 在相同 writer fence 下重新读取两端：以前序 export
补发 cutover evidence，或以前序 cutover 补发 rollback evidence，并再次校验数据库身份、route 与对象 receipt；
它不重复导入，也不把未对账目标标记成功。

回滚把当前目标数据库作为只读源，并要求旧源数据库重新成为可写目标。因 append-only/immutable 用户触发器
会正确阻止应用删除或改写历史，反向全量替换只允许受审计 superuser：在同一事务逐表 `DISABLE TRIGGER USER`、
按反向拓扑清除旧 tenant、按正向拓扑导入包含最新 ledger/audit 的当前快照、把 pending projection cell 改为旧 Cell、
`ENABLE TRIGGER USER` 后重新收集 manifest。DDL、删除、导入、重新启用或对账任一步失败均随事务回滚；普通
`BYPASSRLS` maintenance 账号不足以执行 replace rollback。回滚后 route epoch 仍从当前源 +1，不能恢复旧 epoch。

当前实现包含维护命令、动态计划、流式传输、writer/quiescence/object/evidence 门禁及测试定义，只通过 typecheck、
构建候选与文件规模静态检查；未运行测试、真实 PostgreSQL 31+54 双库、对象存储复制、控制面 route 发布、
故障注入或跨 Cell 演练，因此 `ENT-DATA-005` 保持 `in_progress`，不能作为 H3 或生产门禁证据。

#### 11.1.4 Cell Worker 多实例协调

`ENT-DATA-006` 在既有 `platform_pending_work` 安全投影上增加三列协调真值：
`coordination_owner`、`coordination_generation`、`coordination_lease_expires_at`。业务 `due_at` 和
`lease_expires_at` 仍由 tenant job/outbox/screen-share 的原事务 trigger 投影；协调列只决定哪个 Cell Worker
实例可进入具体 tenant claim，不替代 job/outbox 状态、attempt、CAS 或终态。

Cell discovery 连接继续只设置 `app.cell_id/worker_id/trace_id`。新增的窄更新入口只接受
`enterprise.platform_pending_work`，拒绝其他表、非协调列和非 Cell 范围 SQL。数据库 forced-RLS policy 与
`guard_platform_pending_work_cell_claim` trigger 双重限制更新：

1. 空闲或已过期 claim 只能以 `generation + 1` 建立新 owner；owner 必须等于 transaction-local
   `app.worker_id`，lease 必须是数据库时钟之后且不超过五分钟；
2. 当前 owner 只能在 lease 未过期时延长到更晚时间，延长后的截止时间仍不得超过数据库当前时间五分钟；
3. release 必须保持相同 generation 并同时清空 owner/lease；
4. 旧 owner/generation 的 renew/release 更新0行，不能解除或覆盖新实例 claim；
5. Cell 角色不能修改 tenant、resource、work kind、due time 或业务 lease。

批量 claim 使用单一 CTE：按 `due_at/work_kind/tenant/resource` 稳定排序，以
`FOR UPDATE SKIP LOCKED` 锁定当前 Cell 已到期且两类 lease 均可用的记录，再在同一事务写 owner、generation 和
lease 并返回最小引用。已 claim 的批次并发处理，避免顺序等待使后排租约在执行前过期；每条工作在进入具体
tenant transaction 前先续租，并在处理期间以 lease 的三分之一周期 heartbeat。heartbeat/owner/generation
失效时停止开始新的处理；finally 条件 release，终态 trigger 已删除投影时按幂等 no-op 处理。
所有 due/expiry 判断和新 lease 截止时间均由 PostgreSQL `clock_timestamp()` 生成，Worker 只提交受配置门禁限制的
lease 毫秒数；实例本机时钟不能提前 claim、延长过期所有权或制造跨实例时间真值。

故障收敛分四层：Worker 在 queue claim 前退出时没有业务副作用；queue claim 后、tenant claim 前退出时由协调
lease 到期重领；tenant claim 后、Provider 前退出时还要等待业务 lease；Provider 已接受但 finalize 前退出时，
下一实例使用更高协调 generation/attempt 重试相同稳定 event/job ID，Provider Adapter 必须去重。旧 attempt 的
tenant finalize 由现有 CAS 拒绝。该设计不声称 exactly-once transport，只保证单一有效 claim、可恢复执行和
幂等业务副作用。

Cell 迁移 quiescence 同时检查业务 lease 与协调 lease；反向导入 `platform_pending_work` 时保留单调 generation，
但清空 source owner/lease，避免把旧 Cell 实例所有权复制到目标。Redis 不在本任务正确性路径中，未来只能作为
可丢失的 poll 唤醒优化。

当前 `0050` up/down、Cell SQL guard、claim/renew/release、heartbeat、双实例竞争、过期重领、旧 generation 和
Provider 稳定幂等键测试均已定义但未运行；真实 PostgreSQL forced-RLS、两个进程、kill -9、网络分区和 Provider
去重证据缺失，因此 `ENT-DATA-006` 保持 `in_progress`，不能作为 H1/H3 或企业生产门禁证据。

### 11.2 事务和一致性边界

| 命令 | 单事务必须提交 | 事务外处理 |
| --- | --- | --- |
| 创建租户 | tenant、owner member、provision saga、审计/outbox | 区域 provision、计费客户创建 |
| 发布知识 | version 状态 CAS、发布快照、审计/outbox | embedding、索引预热、旧版本回收 |
| 审批/启动活动 | campaign version、策略/线索/预算快照、任务或 outbox | Scheduler claim、PSTN dispatch |
| marketing task 终态 | task/outcome、hold settle/release、ledger、outbox | CRM 同步、分析聚合 |
| 坐席 claim | session version、assigned user、lease、审计 | 实时通知、外部工单同步 |
| screen share acquire/stop | share lease、generation、meeting version、审计 | token 签发/撤销、RTC track 收敛 |
| 生成/发布会后材料 | run、source count/hash、冻结 segment/translation、evidence、artifact、审计/outbox | 结构化 Provider 复核；外部导出 Adapter |
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
retention 窗口和受控审计导出的创建/下载已由 `ENT-UI-008` 实现；`ENT-REL-002` 已增加首批对象物理删除
和 Provider 收敛回执代码候选，但真实环境门禁仍未执行。

### 12.1 数据生命周期收敛

`0051_enterprise_data_lifecycle` 不复制 tenant job 或 audit export 状态机。新增
`data_lifecycle_jobs` 只保存 `tenant + source + object` 删除范围：

```text
data_lifecycle_jobs(
  tenant_id, id, job_type=object.delete, data_class=audit_export,
  source_id, object_key, object_sha256, size_bytes,
  retention_days, retention_until, status, attempts,
  next_attempt_at, lease_expires_at, completion_outcome,
  receipt_hash, error_code, completed_at, created_at, updated_at
)
```

表使用 tenant-first 主外键、forced RLS、唯一 `tenant + dataClass + sourceId`，删除范围与终态不可改写或删除，
attempt 只能单调加一。`audit_export_jobs` 首次进入 completed 时，数据库 trigger 以同一事务自动登记对象 job；
历史 completed 导出迁移时按相同唯一键 backfill。processing/failed 导出没有对象实体回执，不能创建删除 job。
审计导出的显式 1..30 天保存期、完成时对象 SHA/size 和 expiresAt 被固化为 job 范围；后续修改租户套餐或
默认保存天数不回写历史。新的 audit export INSERT 会锁定对应 tenant 行，tenant 已不是 active 时数据库拒绝；
API 也在正常路径返回 `tenant_lifecycle_pending`，避免删除请求之后出现迟到导出。

`platform_pending_work` 增加 actor-null 的 `data_lifecycle` kind。正常 dueAt 等于保存截止时间；tenant 首次进入
`deletion_requested` 时数据库只把既有生命周期 pending row 提前到当前数据库时间，不改写保存期证据。
Cell Worker 继续经过 Cell forced-RLS、owner/generation/coordination lease、tenant route 锁和 job attempt/lease
两级 claim。tenant 已请求删除时 Repository 可忽略尚未到期窗口立即 claim；跨 Cell、旧 generation 或旧 attempt
均不能 finalize。

`EnterpriseAuditExportArtifactStore.delete` 是唯一首批对象 Adapter：

1. 验证 key 严格属于配置 prefix 下的 `tenants/{tenantId}/{exportId}.jsonl`，路径逃逸失败闭合。
2. S3-compatible 存储先 Head；不存在返回独立 `already_absent`，存在才 Delete。
3. Delete 返回后再次 Head；只有 404/NoSuchKey 才生成 `deleted` 回执，对象仍存在或网络结果未知继续 retry。
4. 非生产 local store 使用同一语义执行 `stat -> rm -> stat`；production 配置 local 仍为 not ready。
5. receipt SHA-256 绑定 schema version、operation、内部 object key 与真实 outcome；audit 仅保存 data class、
   source ID、retentionUntil、outcome/错误码和 receipt hash，不保存 object key、bucket、endpoint 或凭据。

job 最多自动尝试10次并有上限15分钟的退避；明确非法 key 或重试耗尽进入 failed，证据仍不可删除。
failed 不被当作“已清理”，也不会因为 pending projection 移除而允许 tenant 删除。tenant delete Worker 在调用
外部 lifecycle executor 前同时读取本租户所有 data lifecycle job 和 processing audit export；任一对象
processing/failed 或导出仍 processing 即返回 processing，保留 `deletion_requested` tombstone。

生产 HTTP executor 对 `tenant.delete` 的 completed 响应还必须包含规范化 convergence：tenantId/jobId、
database tombstone manifest，以及 object/provider 两组 `discovered = deleted + alreadyAbsent`、
`remainingCount=0` 和 manifest hash；receiptHash 必须等于规范化结构 SHA-256。缺组、计数不守恒、remaining 非零、
hash 不匹配或 Provider 未配置却伪造完成均返回 `deletion_not_converged`。非生产 local executor仍只表示封闭演示
目录被清理，不可作为 S3/Provider/数据库生产证据。

当前代码候选只把 audit export 对象直接接入物理 Adapter；其他会议、录音、授权证据和外部 Provider 删除必须由
真实生命周期服务在 object/provider manifest 中逐项证明。`0051`、真实 PostgreSQL/forced-RLS、S3 consistency、
并发/重启/网络故障和 Provider 清单均未执行，`ENT-REL-002` 保持 `in_progress`，不能宣称数据生命周期生产门禁通过。

### 12.2 控制面 provision 多实例恢复（ENT-REL-006）

`0054_enterprise_control_plane_ha` 增加全局 instance lease 和 provision 引用投影。`tenant_jobs` 对
`tenant.provision + processing` 的 INSERT/UPDATE/DELETE 以同事务 trigger upsert/delete
`control_plane_pending_work`；投影仅含 tenant/job/actor/homeRegion/dueAt 和协调列。数据库 guard 重新读取
tenant/job，拒绝伪造 actor/region/due、tenant session 改协调列、活动 projection 删除和旧 generation 续租。
`control_plane_instances` 固化 instance/region/build/image/generation/status/heartbeat/lease；同 ID 活动租约
阻止第二进程，过期后只能 generation+1 重新注册，active 只能有序进入 draining。

控制面专用 session 设置 `app.control_plane_worker_id` 和 trace，只允许两张控制表的 SELECT/INSERT/UPDATE；
生产 Worker 使用独立 `ENTERPRISE_CONTROL_PLANE_DATABASE_URL`，API live probe 使用只读
`ENTERPRISE_CONTROL_PLANE_OBSERVER_DATABASE_URL`，都不复用 directory/cell/migration/maintenance 角色。
同区域 Worker 先注册实例，再通过 `FOR UPDATE SKIP LOCKED` 批量 claim。每条 claim 在 Provider 前读取真实
tenant job，确认 tenant/job/actor/type/status；Provider 使用稳定 tenant ID，完成前续租，最后调用既有
`finalizeTenantProvision` 在 tenant transaction 内复核 provisioning 状态并更新 tenant/job/audit。claim 或
instance lease 丢失时旧进程禁止 finalize 并退出。

PostgreSQL HTTP 创建/重试只提交数据库并返回202；legacy 演示路径保留同步行为。控制面配置缺失或 live
snapshot 非 ready 时创建和套餐变更在写入前503。API 使用独立 observer ID 查询同一数据库并最多缓存1秒；
`enterprise:control-plane status` 只计同 region、同 commit/image、未过期的 active/draining
实例，并用数据库时钟计算 due backlog 年龄；副本少于2、候选混跑或 backlog 超过配置 SLO 返回非零。
`platformScaleReadiness` 只报告 config `configured`，不能冒充上述 live status 或多故障域验收。控制面表属于
全局真值/投影，Cell 数据迁移计划明确排除；存在活动 provision claim 时租户迁移失败闭合。

当前新增测试定义未执行，也未运行 `0054`、forced-RLS 普通角色、两个进程、kill -9、网络分区、滚动排空、
真实 provisioner 或控制面全停/区域会话自治矩阵。因此 `ENT-REL-006` 保持 `in_progress`。

公开路由配置使用 `ENTERPRISE_PUBLIC_ROUTES_JSON`，以 `cellId` 为键保存
`homeRegion`、HTTPS API 域名和 WSS RTC 域名；签名密钥使用至少 32 字节的
`ENTERPRISE_ROUTE_SIGNING_SECRET`，有效期由 60 至 900 秒之间的
`ENTERPRISE_ROUTE_TTL_SECONDS` 控制。原始 IP、localhost、`.local`、`.internal`
及非 HTTPS/WSS 端点不得进入 route document。企业数据面写入通过
`X-Enterprise-Route-Document` 携带 base64url 文档；缺失、篡改、过期或
tenant/homeRegion/cell/route epoch 不匹配均在副作用前拒绝。当前 route epoch 取 tenant
路由记录 version；路由或生命周期版本推进后，旧文档不能继续发起写入。

客服 ingress 使用独立至少32字节 `ENTERPRISE_SUPPORT_INGRESS_SIGNING_SECRET`，不能复用客户端 route 或
Provider webhook secret；`ENTERPRISE_SUPPORT_INGRESS_TICKET_TTL_SECONDS` 仅允许60至900秒。内部 channel
授权和入站端点还要求至少16字符 `INTERNAL_API_SECRET`。任一密钥缺失或过短时 ticket 签发/内部请求失败闭合。

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

### 14.1 ENT-REL-004 灰度和熔断

`0052_enterprise_release_controls` 新增两张 PostgreSQL tenant 表，`0053_enterprise_tenant_root_rls`
以前向 migration 补齐 `enterprise.tenants` 的自租户 forced-RLS policy，使普通应用角色能够读取并锁定当前 tenant root：

- `release_controls` 以 `tenant_id + capability` 为主键，保存 `enabled`、`kill_switch_active`、
  `closed/open/half_open`、连续失败计数/阈值、owner、到期时间、单调 version 和故障时间；强制 RLS，
  tenant/capability/createdAt 不可改，更新必须 version +1 且时间单调。
- `release_control_events` 以 tenant-first 主键和 `tenant + capability + operation_id` 去重，保存控制变更或
  服务端 outcome 的前后状态、actor、trace、原因和时间；表为 append-only，存在证据时 down migration 拒绝。

API 分为三个信任面：

1. `GET /enterprise/v1/release-controls` 只允许 active membership + `tenant:read` + 有效 route document，
   只返回当前租户脱敏状态和 `defaultDecision=deny`。
2. `/internal/enterprise/release-controls/status|change|decision|outcomes` 使用至少32字节的独立
   `ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY` 与 operator identity；精确 body、capability allowlist、UUID
   operation ID、阈值1..100、最长180天到期和 CAS version 任一不符即拒绝。
3. half-open decision/outcome 还必须提供不同的 `ENTERPRISE_RELEASE_PROBE_KEY`。普通用户、普通 Worker、
   客户端 header 和租户 RBAC 都不能把 open 改为 half-open，也不能提交 probe success。

决策顺序固定为 control missing → rollout disabled/expired → kill switch → circuit → allow。缺 PostgreSQL
runtime 或缺记录绝不回退 legacy/env allowlist。closed 的普通成功把连续失败清零；普通失败在单租户 advisory
lock + row lock 下递增，达到阈值后 open；open 不接受业务 outcome；值班控制把 open 改为 half-open 后，只有
专用探针可绕过普通 guard，成功 closed，失败 open。会改变失败计数/状态的 outcome 与事件追加在同一 tenant
transaction；健康且失败计数为0的普通成功返回 unchanged，不制造高频事件或 version churn。重放同一已记录
operation ID 不重复计数。

Support Agent 创建 dispatch、Meeting Screen OCR enable/dispatch 和 Marketing PSTN Provider dispatch 已在
副作用前调用 guard，并以稳定 run/dispatch UUID 回写服务端成功/失败。kill/open 只阻止新副作用；disable、
人工停止、已受理 Provider 对账、usage settle 和终态收敛继续执行，避免“熔断”制造悬挂账单或虚假未拨号。
客服写工具当前仍要求客户确认或人工接管；自动写放量前必须接入 `support.write_tools` 同一 guard。

2026-07-21 已在本机官方 PostgreSQL 16.14 从空库执行公共31段+enterprise 53段，并完成
`53 -> 52 -> 51 -> 53` down/forward、普通非 owner/非 `BYPASSRLS` 角色双租户读写攻击、两个独立连接池
同 operation 竞争、阈值 open、专用 half-open probe、恢复、kill 和追加证据不可变验证；两个 API 进程也已
从同一数据库读取一致状态并拒绝缺失 probe key。该结果验证单节点机制，不等于跨故障域 staging/H3。
真实 Support/OCR/PSTN Provider 故障、kill 生效延迟 SLO、告警和独立 on-call runbook 演练未完成，
`AC-ENT-0053` 仍不通过。

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

### 17.3 企业候选版本安全门禁（ENT-REL-001）

门禁分为三份互不替代的证据：

1. `check:enterprise-security-static` 从 Git 索引和未忽略的新文件生成扫描集合，跳过二进制后对
   `apps/packages/services/*/src` 执行高置信 SAST，并对所有文本执行私钥与 GitHub、Slack、OpenAI、AWS、
   Google 高置信 credential 规则。当前规则覆盖动态执行、全局关闭 TLS、反射式 CORS、原始 HTML注入、
   child-process shell、Python shell/不校验证书/pickle，以及 Dart 证书/shell、Android release cleartext/
   mixed content、iOS ATS/任意证书。policy 固定规则 ID，删除规则或放宽 P0/P1 都失败闭合。
2. `check:dependency-security` 直接消费 `npm audit --omit=dev --json`，除精确匹配的临时例外外，新增 low/high/
   critical、依赖名、severity、direct version、advisory、缓解 source marker 或到期日漂移均拒绝。本批结果仍是
   同一 OpenTelemetry advisory 的14个 moderate package；这只表示限期接受，不是零漏洞或已修复。
3. `enterprise:security-penetration` 读取未跟踪 JSON plan，凭据只引用环境变量；runner 仅允许 localhost 或
   `ENTERPRISE_SECURITY_ALLOWED_HOSTS` 中的 test/staging，远端强制 HTTPS，拒绝 production、URL credential、
   literal authorization/cookie/API key、重定向跟随和不完整类别。证据不保存 request/response body，只保存
   status、bytes、SHA-256、duration 和 P1 finding。

渗透 policy 至少要求未认证访问、tenant context 伪造、跨租户读取、角色提权、webhook 签名/重放和 payload
上限六类。证据使用不少于32字符的独立 HMAC key 签名，覆盖 commit、test/staging origin、runner version、
plan hash、开始/结束时间、每次尝试和 finding；release verifier 要求 candidate commit 精确相同、证据不超过
168小时、所有类别/attempt 通过且 P0/P1 为0。签名 key、token、route document 不得进入 plan、artifact 或日志。

共享 API 的 CORS 现由 `API_CORS_ALLOWED_ORIGINS` 精确配置：生产缺配置时关闭跨域，仅保留同源反向代理；
非生产缺配置时只允许 localhost/loopback，wildcard、子域推导、路径、用户信息和重复 Origin 拒绝。
`@livekit/rtc-node` 使用固定 `import()`，不再以 `new Function` 构造代码。PostgreSQL `require` 模式只保留给
封闭非生产环境；iOS release 已移除 `NSAllowsArbitraryLoads`，Android cleartext 只允许 debug/profile manifest。
既有 Primary startup 在 production 仍硬性要求 `verify-full`，不能用本静态规则降低该门禁。

CI 只执行静态和依赖门禁；真实渗透必须在冻结候选环境另行执行，再由
`check:enterprise-security-release -- --evidence=...` 重新运行两项扫描并验签。当前未执行真实 HTTP 攻击、外部
SAST/DAST、独立 reviewer 或密钥轮换/恢复，所以 `ENT-REL-001` 保持 `in_progress`，`AC-ENT-0050` 未通过。

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
真实 purge、对象清单和恢复对账继续由 `ENT-REL-002/003` 验收；`0051` 的静态候选不替代真实 S3/Provider 证据。

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
`screenShare=false`；`ENT-MTG-006` 只向已认证 Flutter 成员会议接入 ReplayKit，访客仍不能发布共享。当前未执行 token/ticket 攻击、四人媒体、
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

### 19.11 iOS ReplayKit 屏幕共享

Flutter 在已加入企业会议并取得 participant ID 后创建租约控制器。入口按 meeting `screenShareRole` 与 participant role
共同守卫；当前仅 iOS 可用，系统音频固定为 false。启动顺序为：确认原生 bridge/App Group 配置、读取最新 meeting
version、acquire `sourceType=screen` 租约、原子写入 token-free 控制清单、以 generation 专属 grant 连接独立
`Room(autoSubscribe:false)`、调起 ReplayKit 系统选择器。25秒未收到广播/track、用户离会或任一步失败都会 fail closed。

主会议 Room 的成员 token 继续固定 `screenShare=false`。由于锁定的 `livekit_client 2.8.1` 没有公开导出
`BroadcastManager`，客户端在固定版本边界内使用该管理器的实现入口关闭全局自动发布，再只在独立 publisher Room
手动启用 `ScreenShareCaptureOptions(useiOSBroadcastExtension:true, captureScreenAudio:false)`。屏幕 track SID 首次发布后
立即 renew 绑定，之后每10秒 renew；每次响应严格校验 RTC URL、room、publisher identity、generation、JWT 形状、
到期时间和只允许 screen video 的能力集合。服务端 current share 改变或 generation 前移时立即停止本地发布。

Runner 与 `EnterpriseBroadcast` target 共享 `group.$(TRANSLATION_IOS_BUNDLE_ID)` entitlement。主 App MethodChannel
`translation_mobile/enterprise_replaykit` 只写 `shareId/generation/publisherIdentity/leaseExpiresAt/controlNonce/enabled`，
不写 access token、API key、route document 或 tenant credential。renew 必须匹配旧 share/generation/nonce；clear 也只
删除匹配清单，避免旧控制器清掉新一代广播。

Broadcast Upload Extension 只处理 ReplayKit video sample，忽略 app/mic audio，通过 App Group 内 `rtc_SSFD` Unix
socket 发送序列化 JPEG frame 给主 App 的 WebRTC 捕获端。扩展启动和每秒处理时重读控制清单；清单过期、删除、
publisher 公式不符、generation/nonce 改变或主 App 发出 `iOS_BroadcastRequestStop` 时结束广播。扩展日志只记录通用结束
事件，不记录 socket 全路径、帧内容或凭据。主 App 的 active audio background mode 是离开 App 后继续会议与续租的
前提，不额外申请任意后台执行能力。

本实现当前只有 Flutter analyze、plist/PBX 解析、Xcode build setting 和扩展 Swift typecheck 静态证据；未构建或安装
生产 App，未执行真机系统选择器、后台/锁屏、内存压力、网络切换、真实 LiveKit 首帧/续租/撤销或多发布者竞争。
因此 `ENT-MTG-006` 保持 `in_progress`，不代表 AC-SHARE-002、A1 或企业生产门禁通过。

### 19.12 Android MediaProjection 屏幕共享

Flutter 屏幕共享控制器现通过统一 publisher/bridge contract 在 iOS ReplayKit 与 Android MediaProjection 之间选择，
服务端租约、独立 publisher Room、首次 track SID 绑定、10秒续租、25秒激活超时和离会停止逻辑保持一致。Android
启动不复用会议主 Room；成员入会 grant 继续禁止 screen share，generation 专属 grant 只进入
`Room(autoSubscribe:false)` 并发布 video screen source，系统音频固定为 false。

Android 启动顺序固定为：

1. Android 13+ 请求 `POST_NOTIFICATIONS`，拒绝时失败闭合，确保共享时存在用户可见停止入口。
2. 调用固定依赖 `flutter_webrtc 1.4.0` 的 `Helper.requestCapturePermission()` 取得一次性 MediaProjection 授权；
   该步骤发生在读取 meeting version 和 acquire 之前，用户拒绝不会留下服务端租约。
3. acquire 成功后只把 `shareId/generation/publisherIdentity/leaseExpiresAt/controlNonce` 交给原生 bridge。
4. 原生启动声明 `foregroundServiceType=mediaProjection` 的 `START_NOT_STICKY` Service，并在 MethodChannel 返回前完成
   `startForeground`；之后 Flutter 才连接独立 Room 和创建屏幕轨，满足 Android 14 的授权与前台服务顺序。
5. 屏幕轨发布后，bridge 以 WebRTC capture track ID 核对 screen capturer，再注册额外的 MediaProjection stop callback；
   监听建立后才允许首次 renew 把 UI 置为 active。

前台通知使用与 Flutter `mobile_screen_share_outlined/stop_screen_share_outlined` 相同语义的 Material vector，明确显示
“正在共享手机屏幕”“不包含系统音频”和停止操作。Service 不接收或持久化 RTC URL、access token、tenant route、
API key 或屏幕帧；进程终止后 `START_NOT_STICKY` 不恢复旧授权。renew 只接受相同 share/generation/publisher/nonce
且未来不超过五分钟的到期时间，过期时 Service 主动停止 MediaProjection 并通知 Flutter。通知停止、系统投屏停止、
Service 意外销毁、离会和续租失败都进入同一 Flutter stop 状态机；Flutter 已消失时本地 lease timer 和服务端 cell
Worker 分别负责设备端与服务端最终回收。

`flutter_webrtc 1.4.0` 没有公开系统停止事件，插件自带的 MediaProjection callback 也不转发 track ended。原生 bridge
因此只在锁定版本边界内反射 `FlutterWebRTCPlugin.methodCallHandler -> getUserMediaImpl -> getCapturerInfo(trackId)`，
核对 capturer 精确类型后读取其 MediaProjection 并追加 callback。插件 consumer ProGuard 规则已保留这些类与字段；
任何字段、类型、track 或 projection 不匹配均返回 `media_projection_monitor_unavailable`，停止本地轨和租约，禁止在
无法观测系统停止时继续显示共享成功。主动停止先注销额外 callback，再停止 WebRTC track，避免把本地清理误判为
系统撤销。

本实现当前只通过 Flutter analyze 和 manifest/XML/源代码静态门禁；按要求未运行测试，也未执行 APK 构建/安装、
Android 13/14/15 真机权限、通知拒绝、系统状态栏停止、后台/锁屏、Activity/进程回收、网络切换、内存压力、真实
LiveKit 首帧/续租/撤销或多发布者竞争。因此 `ENT-MTG-007` 保持 `in_progress`，不代表 Android 屏幕共享、A1 或
企业生产门禁通过。

### 19.13 Web 系统音频独立发布与 ASR 隔离

Web 控制器在用户手势中把“共享系统音频”映射为 `getDisplayMedia({audio:true})`。结果必须同时具有 video track 和
audio track，且 video 的 `displaySurface` 可识别；任一条件不满足都先停止 stream，再返回结构化
`screen_capture_audio_unavailable` 或来源错误，不创建服务端租约。实际音轨存在后，acquire 才发送
`includesSystemAudio=true`。服务端既有 runtime 会额外检查 `meeting.screen_share.system_audio` entitlement，并只在
该字段为真时把 `TrackSource.SCREEN_SHARE_AUDIO` 加入短期 token；Web 再要求 grant `screenShareAudio` 与 capture 一致。

独立 publisher Room 先发布 video `Track.Source.ScreenShare`，再发布 audio `Track.Source.ScreenShareAudio`，两者使用
相同 generation publisher identity 和 stream 标识，但不同 track name。首次 renew 仍绑定 video track SID 作为租约
活动证明；audio 由同一 identity、generation token 和 Room transport 约束。初始任一发布失败会 unpublish 已发布轨并断开
Room；video `ended` 会停止整次共享。进入 active 后 audio 单独 `ended` 只从 stream 和 publisher Room 移除音轨，并把
本地状态降级为 `screen_share_audio_ended`，视频和租约继续；pause/resume 不伪造恢复已结束的音轨。

主会议 Room 继续排除 `ent-share:*` 对 remote participant count 的影响，只从服务端当前 publisher identity 接受
`screen_share` 和 `screen_share_audio`。视频与音频分别进入 video/audio DOM；音频只对远端观看者附加，共享者本机
不附加捕获轨，避免二次播放被再次捕获。audio controls 始终保留，以处理浏览器自动播放策略。

Enterprise Meeting translation Agent 对每个输入同时执行两道守卫：participant identity 必须匹配
`ent:<UUID>:host|member|guest`，publication source 必须等于 rtc-node `SOURCE_MICROPHONE`。因此
`ent-share:<shareId>:g<generation>` 即使被 `AUDIO_ONLY` 自动订阅，其 `SCREEN_SHARE_AUDIO` 也不会建立 Speech Pipeline，
不会生成错误 sourceParticipantId、ASR segment 或字幕。Agent permissions 仍只声明 microphone source。

iOS 当前 ReplayKit Extension 只传 video sample，Android 当前 MediaProjection 只建立 screen video，均没有可验证的
app-audio/AudioPlaybackCapture 到独立 WebRTC audio source 管线；移动 grant validator 继续要求
`screenShareAudio=false`，请求体继续发送 `includesSystemAudio=false`。本轮仅形成 Web/Worker 静态代码候选，未执行
浏览器/真实 LiveKit、entitlement 负测、音轨中断、扬声器/耳机回声、错误 ASR 段或移动真机矩阵，因此
`ENT-MTG-008` 保持 `in_progress`，不代表 AC-SHARE-008、A1 或企业生产门禁通过。

### 19.14 自适应发布、订阅和画面/字幕布局

Web capture 对 smooth/auto/high 分别使用最大1280×720@15、1920×1080@15、2560×1440@15约束。发布时显式设置
`simulcast=true`、`degradationPreference=maintain-resolution` 和 `dynacast=true`：smooth 的主编码为720p15并附加
360p3，auto 主编码为1080p15并附加360p3/720p5，high 主编码上限4.5Mbps@15并附加相同低/中层。LiveKit SDK 在
Firefox 等自身不支持 screen simulcast 的环境可关闭多层；客户端不把该 SDK 降级伪装为多层成功。

Flutter 锁定 `livekit_client 2.8.1`，共享 publisher Room 现显式设置 `VideoPublishOptions`。smooth/auto/high 主参数
分别为 screenShareH720FPS15、H1080FPS15、H1440FPS30，附加层为360p3以及非 smooth 时的720p5，simulcast/dynacast
均打开，degradation preference 为 maintainResolution。iOS ReplayKit 和 Android MediaProjection 继续使用各自同一
quality 的 capture options；没有添加系统音频或新的原生权限。

Web 观看端原先只把 `publication.track.mediaStreamTrack` 放进新 MediaStream，这会丢失 LiveKit adaptiveStream 对元素
可见性和尺寸的观察。当前 snapshot 保留 `RemoteVideoTrack`；仅服务端 current share 的 publisher identity 和
`screen_share` source 可进入状态，React 组件在 mount/update/unmount 时调用 `attach/detach(video)`。本地发布者预览
继续使用原始 capture track，避免把自己的远端订阅当作发布状态真值。

Flutter main Room 同样保存 expected publisher identity，只从该 participant 的 `screenShareVideo` publication 取得
`RemoteVideoTrack`，并在订阅/取消订阅/participant 事件后重建 snapshot。`VideoTrackRenderer` 根据 Widget 大小、可见性
和 device pixel ratio 向 SDK 注册订阅需求；`ent-share:*` participant 被排除于参会者计数。未知 identity、旧 generation
或非 screen source 不渲染。

Web `MeetingMediaWorkspace` 和 Flutter `EnterpriseMeetingMediaWorkspace` 均提供 screen/balanced/captions 三态且保持
两部分挂载。Web 并排断点为960px，Flutter 为可用宽度840且文字缩放不超过1.5；否则按优先级纵向排序。低高度横屏
限制媒体/字幕可视高度，字幕区域内部滚动，所有控制保持正常文档流。当前未运行真实 LiveKit layer 统计、弱网切层、
Firefox单层降级、CPU/带宽、320/600/960/横屏/200%或Flutter动态字体真机矩阵，因此 `ENT-MTG-009` 保持
`in_progress`，不代表 AC-SHARE-006/007/009、A1 或企业生产门禁通过。

### 19.15 主持人强制停止共享

服务端新增：

- `POST /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/force-stop`
- Header：Bearer、`x-tenant-id`、签名 tenant route、`Idempotency-Key`
- Body：`{ "expectedVersion": positive_integer }`
- Scope：`screen_share:stop`

路由不接收 tenant、actor、role、participant 或 generation 等可伪造授权字段。认证层从 active membership 解析
owner/admin/meeting_host 的 scope；PostgreSQL runtime 在同一 tenant unit of work 内锁 tenant/meeting 与目标 share，
再通过 actor user ID 重读当前 meeting participant，并要求其已 joined 且未 left。没有 scope 在进入 runtime 前记录
denied audit 并返回403；没有活动参会关系返回 `screen_share_forbidden`。目标 share 仍使用复合 tenant/meeting/id
查询，跨租户或跨会议 ID 不能被命令命中。

强停复用 `0024` append-only command ledger 的 stop 状态迁移，而不扩展数据库枚举：ledger 记录真实的状态命令、actor、
expected version、请求 hash 和结果 generation；请求 hash 的 command 固定为 `force_stop`，因此与共享者自己的 stop
不能共享幂等语义。成功在同一事务把 active/paused share 改为 ended，清空 lease/track SID，递增 version 与 generation，
写 `meeting.screen_share.force_stop` append-only audit、`meeting.screen_share.force_stopped` 状态 outbox 和旧 generation
的 `meeting.screen_share.revoke.requested` outbox。旧客户端随后 renew/resume 会因状态/version/generation 不匹配被拒绝，
不能把 ended 恢复为 active。

API 在事务提交后立即按被撤销 generation 的 `ent-share:<shareId>:g<generation>` 调用 LiveKit removeParticipant。
404 视为已完成；未配置、超时或 Provider 错误返回 `revocation=pending`，但数据库 ended/generation fence 不回滚，
持久 outbox 继续重试。Web/Flutter 使用原 `Idempotency-Key` 最多有界重试三次；每次 repository replay 只返回原结果并
再次尝试 Provider 撤销，不追加重复 command/audit/outbox。客户端在 pending 时保持停止中，禁止新 acquire 假成功。

Web/Flutter 从已认证 workspace scope 决定是否发现入口，同时只对他人的 active/paused share 展示操作；这只是 UX
守卫，服务端 scope 和 active participant 才是权限真值。两端确认框显示目标 participant ID、generation 和撤销影响，
沿用 `stop_screen_share` Material 图标和高关注色。当前未运行角色×API×资源、跨租户、同键重放、CAS 竞争、旧 renew、
真实 LiveKit 500ms 撤销、Provider pending/outbox 或浏览器/真机矩阵，因此 `ENT-MTG-010` 保持 `in_progress`，
不代表 AC-SHARE-004、A1 或企业生产门禁通过。

### 19.16 会后材料修订、证据和 Provider 复核

`ENT-MTG-011` 以 `0025_enterprise_meeting_materials` 建立材料 run、规范化 segment/translation、当前会议
speaker label、结论/action item 和逐项 evidence。所有新表使用 tenant-first 复合 FK、forced RLS；冻结 segment、
translation、结论和 evidence 由 trigger 禁止更新/删除。speaker label 和 action status 是显式可变投影，分别通过材料
run version 与 action version CAS 更新；姓名修正只属于该材料 revision，不修改 participant 或 member。

`meeting_translation_events` 是按目标参会者 fan-out 的 append-only final 事件，不能直接逐行变成逐字稿。Repository
先按 `source_participant_id + source_track_sid + source_segment_id` 选择最大 revision，再合并不同目标副本；源文只允许
一致值，每种翻译语言只保留一个一致值。规范排序后计算 `source_event_count` 和 SHA-256 `source_hash`。生成事务先持久化
`review_status=processing` 的 run 和 request hash，同一个 tenant/meeting/idempotency key 只恢复原 run；同键不同请求
返回冲突。Provider 在事务外执行，最终事务重新锁定 meeting/run，复核 version、source count/hash 和每个 evidence ID，
避免长事务、重复副作用和复核期间源漂移。

只有 ended meeting 可以生成材料；首次成员入会以 CAS 把 provisioning 推进为 active，主持人/owner/admin 结束会议时
要求没有活动共享，并收敛 `active -> ending -> ended`。translation Worker 在 accept 和 publish 两处复核 meeting active，
结束后的迟到事件返回 `meeting_not_active`，不能写入本次冻结材料。材料读取、生成、修名、待办更新和发布都通过可信
tenant context、签名 route document 和 meeting scope guard，route/body 不接收 tenant 或 actor 覆盖字段。

AI 复核复用 `@translation/llm` 的 OpenAI-compatible Adapter，默认关闭。未配置时 run 明确为 `not_configured`；health、
超时、协议或 Schema 失败时为 `failed`，两者都只返回服务端冻结逐字稿，不补造摘要或待办。Provider 输出中的每条结论
和 action 必须引用当前 run 的至少一个 material segment；未知、空或跨 run evidence 全部拒绝。负责人只在名称与当前
会议唯一 participant 精确匹配且证据文本包含该名称时绑定；截止时间只在证据包含 Provider 原值且可严格解析时绑定，
否则保持空值。`ready` 仍表示待人工发布，不代表内容自动成为企业真值。

发布以 expected version 把 draft 改为 published，并在同一事务写 material artifact、审计和 outbox；只允许当前 draft、
复核 ready 的 revision。Web/Flutter 只读取上述服务端材料，展示复核降级、证据片段、材料内修名、action 状态和人工发布，
不以客户端字幕缓存回填。当前未运行 migration/down、forced-RLS/跨租户、fan-out/revision/hash、幂等/CAS、Provider
hallucination、发布竞争、浏览器/Flutter/真机或外部导出 Adapter 门禁，因此任务保持 `in_progress`，不代表 A1/H3 或
企业生产门禁通过。

### 19.17 企业发布材料门禁（ENT-REL-005）

`ENTERPRISE_RELEASE_MATERIALS_FILE` 指向 schema-v1 JSON manifest。服务端只接受 product 固定为
`ai-phone-enterprise`、非占位 release/version、40位 commit 和 `sha256:` image digest。生产还配置
`ENTERPRISE_RELEASE_CANDIDATE_COMMIT`、`ENTERPRISE_RELEASE_IMAGE_DIGEST`；任一不一致失败闭合。
`ENTERPRISE_RELEASE_REPOSITORY_ROOT` 只定义材料挂载根，所有引用必须为根内相对普通文件，绝对路径、
目录穿越、符号链接、空文件、超过2MiB、SHA-256不匹配和已批准文件中的草稿标记全部拒绝。

manifest 固定要求七类材料：service description、release notes、SLA、privacy/data processing、administrator
guide、operations/incident runbook 和 release checklist。每种恰好一份且为 approved，含审批人和非未来时间。
同时固定要求 A0/A1/A2/A3/H1/H2/H3 七组 evidence；每组恰好一份、状态 passed、acceptance ID 非空、
证据文件 hash 正确，并与 manifest 的 commit/image 完全一致。产品、工程、安全、隐私、运维和法务六个
职责审批也必须全部 approved。

`getEnterpriseReleaseMaterialsReadiness` 进入 `/health` 的独立
`enterpriseReleaseMaterialsReadiness`，并作为 `/health/release-ready` 的强制组成。国内版
`RELEASE_MATERIALS_FILE` 即使 ready，也不能抵消企业材料缺失。CLI
`check:enterprise-release-materials` 默认从当前 Git HEAD 取得 expected commit，并强制接收真实 image digest。
示例 manifest 固定为 draft/pending，不可直接放行。当前只形成代码、文档模板和未执行测试定义；没有真实
A0–A3/H1–H3、批准 SLA、六方审批或候选镜像，因此 readiness 仍为 `not_ready`，不代表 A4 或生产门禁通过。

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
| 企业会议会后材料 | target fan-out 去重、latest revision、source count/hash、同键重放、evidence/owner/due 负测、发布 CAS、结束后迟到事件拒绝 | 真实复核 Provider、双租户 PostgreSQL、浏览器/Flutter、导出与保留期演练 |
| 企业账单归属 | tenant billing account、跨租户账单 ID、ledger/adjustment 幂等和对账测试 | 支付 sandbox、账期关闭和财务抽样对账 |
| 企业链路报告 | `x-trace-id` 到 binding/provider/usage/ledger/audit 的关联、legacy/no-sample/no-price、跨租户 session/trace 负测 | 两租户真实会话、Provider、OTLP、账务抽样和 H1 长稳 |
| 生产韧性 | writer fence、route epoch、旧 Worker generation、备份清单和恢复脚本测试 | 跨故障域自动切换、旧主隔离、异地主机不可变备份和 PITR |

设计评审通过不等于功能验收。任务只有在代码、自动化、目标环境证据和 `enterprise-edition-acceptance-plan.md` 对应条目齐全后才能从 `ready_for_acceptance` 进入 `accepted`。
