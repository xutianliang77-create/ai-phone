# Enterprise PostgreSQL schema

`ENT-DATA-001` 在这里提供企业 schema、up/down migration、受保护回滚、复合外键、强制 RLS
和备份归档 smoke。`ENT-DATA-007` 已把企业 Repository 与公共 PostgreSQL Primary
Runtime 收敛到同一个进程级 Storage Driver；SQLite 仍仅用于本地开发和封闭演示。

`ENT-DATA-002` 已提供三类 transaction-local session：

- tenant session 设置 `app.tenant_id + app.user_id`，把 tenant 注入 `$1`，并为 tenant 内 actor guard
  提供事务级身份；拒绝缺少 tenant
  predicate、注释绕过、错位 INSERT，以及 tenant 根表的 JOIN/子查询/UNION/OR。
- directory session 设置 `app.user_id`，只允许从
  `enterprise.user_tenant_directory` 单表读取显式 `user_id = $1` 的本人记录。
- cell session 设置 `app.cell_id`，并附带 `app.worker_id`/`app.trace_id`，只允许从
  `enterprise.platform_pending_work` 单表读取当前 cell 的最小 due 引用。

forced RLS 下不能用普通 tenant session 扫描 members 来发现 membership，也不能给
应用运行角色 `BYPASSRLS`。因此目录只返回本人 active `tenantId + memberId` 引用，
再逐租户创建隔离 session，重新核对 tenant/member/user/status。成员写入和租户暂停
会在同一 transaction 内同步目录投影。

Tenant/Member/Audit、lifecycle、Inbox/Outbox Repository 已可组合到一个异步
PostgreSQL unit-of-work。它们提供 tenant 根记录安全查询、成员 CAS、审计分页、
lifecycle job 锁/CAS、inbox/outbox 幂等返回、outbox lease claim/finalize 和
snake_case 行映射；输入与返回行都会再次核对 tenant。平台 discovery 只返回
cell/tenant/kind/resource 和必要 actor，随后进入 tenant unit-of-work 复核当前 cell
并以 `FOR UPDATE` 锁定路由行后执行 lifecycle/outbox 原子 claim。API 与独立 Worker
均通过统一 Primary Runtime 注入该 Repository，不存在路由级 fallback 或双写。

identity 使用 opaque subject，而不是资源 UUID：

- account subject 必须是规范的 `user_<uuid>`。
- audit/policy/idempotency actor 可以是 account subject，或
  `system:enterprise-outbox` 形式的受约束 namespace subject。
- Repository 在 SQL 前和行映射时校验；schema verify 当前覆盖47个 account/audit subject 列，
  包括活动 owner、术语和话术的创建、审核与发布 actor。raw UUID、`user-a` 和 system actor 写入 user 列
  都会失败闭合。

## API startup gate

默认 `ENTERPRISE_POSTGRES_STARTUP_MODE=disabled`，API 不读取连接串，也不连接
PostgreSQL。需要只验证已部署 schema 时：

```bash
ENTERPRISE_POSTGRES_STARTUP_MODE=verify \
ENTERPRISE_MIGRATION_DATABASE_URL='postgresql://...' \
  npm run dev -w @translation/api-server
```

只有明确允许启动时执行 migration，才使用：

```bash
ENTERPRISE_POSTGRES_STARTUP_MODE=migrate_verify \
ENTERPRISE_MIGRATION_DATABASE_URL='postgresql://...' \
  npm run dev -w @translation/api-server
```

两种启用模式都在恢复任务、Fastify 构建和端口监听前失败闭合，并在校验后关闭连接。
`verify` 不写 migration；`migrate_verify` 始终在 migration 后执行相同 schema verify。
统一启动编排先验证公共31段 manifest 和签名 cutover evidence，再验证 enterprise 43段
manifest，并核对两个 verdict 的 database name/OID；任一失败都关闭已创建资源且不监听。

基础 migration `0004` 至 `0010` 中，`0004` 增加 tenant lifecycle 状态和 job，`0005` 增加
导出/删除执行所需的 scope snapshot、attempt、lease、retry、receipt 和终态约束，
`0006` 为 audit events 增加 result/details 约束、tenant-first 查询索引和拒绝
UPDATE/DELETE 的 append-only 触发器，`0007` 为 enterprise inbox/outbox 增加
trace、lease、错误码和 tenant-first recovery 索引，`0008` 增加 user-context
Tenant Directory、self/tenant policies 和受控 backfill，`0009` 增加
`platform_pending_work`、cell/tenant policies、受控 backfill 和 job/outbox/cell
同步 trigger，`0010` 将 user/actor identity 修正为受约束 text 并保护不兼容
rollback。这些结构支持控制面代码和自动化，不代表真实 PostgreSQL、Provider 或
对象存储验收已经完成。

## Migration

目标 PostgreSQL 需要支持 `uuid`、`jsonb`、RLS 和条件索引。迁移账号应能创建
`enterprise` schema 和表，但不能作为 API 运行时账号长期使用。

```bash
ENTERPRISE_MIGRATION_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- migrate

ENTERPRISE_MIGRATION_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- verify
```

只回滚最新一段 migration，并要求显式确认：

```bash
ENTERPRISE_POSTGRES_ALLOW_DOWN=true \
ENTERPRISE_MIGRATION_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- rollback
```

默认要求 TLS 证书校验。统一使用 `POSTGRES_SSL_MODE`；仅本机封闭环境可设为
`disable`，生产环境必须通过公共 Primary 门禁使用 `verify-full`。旧
`ENTERPRISE_DATABASE_SSL=disable` 只保留本地兼容，不能进入企业试点环境。

## Tenant isolation

- tenant-owned 表全部使用非空 `tenant_id`。
- 关系通过 `(tenant_id, resource_id)` 复合外键约束。
- 高频索引以 `tenant_id` 开头。
- 所有 tenant-owned 表启用并强制 RLS。
- API 运行时角色不得是表 owner、superuser，也不得拥有 `BYPASSRLS`。
- Repository 事务必须先执行 `SET LOCAL app.tenant_id = $1`；这属于
  `ENT-DATA-002`，RLS 不能替代 Repository 中的 tenant 条件。
- Tenant Directory 使用单独的 `SET LOCAL app.user_id = $1` 和 self policy；目录
  查询不得 JOIN tenant-owned 表，候选记录必须再进入 tenant session 复核。
- 平台恢复使用 `SET LOCAL app.cell_id = $1` 的 forced-RLS projection；projection
  不含 payload，发现引用在 claim 前必须重新进入 tenant session 核对当前 cell。

`API_STORAGE_DRIVER` 是唯一进程级 driver；旧 `ENTERPRISE_REPOSITORY_DRIVER` 为空或
必须与其一致。API tenant Repository 复用公共 Primary pool，directory 使用独立凭证；
Worker 使用独立 cell discovery 凭证和共享 tenant pool，不持有 directory 凭证。
生产环境必须显式配置 `ENTERPRISE_DIRECTORY_DATABASE_URL`、
`ENTERPRISE_CELL_DATABASE_URL`、`ENTERPRISE_MIGRATION_DATABASE_URL` 和维护凭证，
不得使用 `BYPASSRLS` 应用角色扫描或修改全租户数据。

## Knowledge versions

`ENT-CORE-004` 由 migration `0017` 提供 `knowledge_chunks`、检索维度和数据库发布守卫。
Knowledge Repository 只允许 `draft -> review -> published`：chunk 集在 tenant transaction 中一次性
写入，服务端生成逐块和聚合 SHA-256；发布要求 review、expectedVersion、非空 chunk、actor 和有效
时间窗。published version/chunk 不可更新删除。HTTP 路由还要求 `knowledge:read|knowledge:publish`
和签名 tenant route document，legacy/SQLite runtime 明确返回 PostgreSQL required。

检索强制 tenant、locale、country、product、server time，只返回每个 source 最新有效 published
revision，并生成 `knowledgeVersionId:blockId` citation。当前没有 embedding Provider 集成，文本匹配
只是确定性降级，不能声称向量召回已就绪。

## Terminology and script versions

`ENT-CORE-005` 由 migration `0018` 把 `term_packs` 收敛为稳定资源，并新增
`term_pack_versions`、`script_templates` 和 `script_template_versions`。Repository 只允许
`draft -> review -> published`，在稳定资源行锁下分配 revision，服务端规范化内容并生成 SHA-256；
数据库禁止评审后修改内容/hash，也禁止更新或删除 published/expired 版本。

HTTP 路由要求 `knowledge:read|knowledge:publish`、active membership 和签名 tenant route document；
legacy/SQLite runtime 明确返回 PostgreSQL required。运行时 resolver 叠加 tenant、语言、国家、产品、
用途和服务端时间，只返回有效 published revision；顶层、ASR、翻译和 LLM 固化同一
`termPackVersionId`，可选话术版本只提供给 LLM。未配置真实 ASR/翻译/LLM Provider 时只返回确定性
内容与引用，不声明 Provider 成功。

## Backup smoke

归档 smoke 要求目标机存在 `pg_dump` 和 `pg_restore`：

```bash
ENTERPRISE_MAINTENANCE_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- backup-smoke
```

该命令创建临时 custom-format archive，并用 `pg_restore --list` 验证归档可读，
随后删除本地临时文件。它不等于 PITR 或隔离环境恢复演练；真实 restore、数据对账、
RPO/RTO 和对象存储恢复证据仍属于 H3 门禁。在这些证据齐全前，
`ENT-DATA-001` 保持 `in_progress`，不能宣称 PostgreSQL 企业生产就绪。

## Full cutover and restore evidence

`ENT-DATA-009` 使用维护角色对 `ai_phone` 与 `enterprise` 的全部业务表按主键分页，
对规范化整行计算 SHA-256，并保存公共/企业 migration manifest、数据库
system identifier、OID、WAL LSN、关键表清单和总 hash。三阶段命令为：

```bash
npm run enterprise:postgres-cutover -- baseline
npm run enterprise:postgres-cutover -- cutover
npm run enterprise:postgres-cutover -- restore-verify
```

切换阶段要求 `ENTERPRISE_CUTOVER_BASELINE_FILE`、至少32字符的独立 HMAC key、
commit/image/topology 身份、源/目标逻辑 ID 和 `ENTERPRISE_CUTOVER_OLD_WRITER_ROLES`。
运维系统必须先把源库默认事务设为只读并清退旧 API/Worker；工具只验证 source 写探针返回
SQLSTATE `25006`、旧 writer 会话为0、target 可写和二次全量 hash 相等，不替运维系统执行
危险的自动 promote/fence。证据以 `0600` 原子写入。

生产启动只接受 `environment=staging` 的 `cutover/matched` 签名证据，并绑定当前
commit、image digest、topology hash、目标 logical ID、数据库 system identifier/OID 和
31+43 migration manifest。`c9b5be2` 的31+16本地证据会被门禁拒绝，必须重新生成；
本地同机 `pg_dump/pg_restore` 只能证明逻辑恢复与对账机制；
跨故障域自动切换、异地主机不可变 WAL/PITR 和 RPO/RTO 仍由 `ENT-REL-003`/H3 验收。

## Meeting screen-share leases

`ENT-MTG-004` 由 migration `0024` 增强 `meeting_screen_shares`，新增 communication binding、route epoch、
generation、acquire 幂等/hash、严格状态时间约束、append-only 命令账本以及 cell-scoped 到期 pending-work。
API 使用 expected-version CAS 和短期最小权限 LiveKit grant；pause/stop/route fence/到期通过同一幂等 outbox
撤销旧发布 identity。cell Worker 即使在客户端消失后也会把到期租约收敛为 expired。Provider 未配置或移除失败
保持 retry/pending，不生成假成功。当前未执行 migration、forced-RLS、并发或真实 LiveKit 验收。

## Meeting materials

`ENT-MTG-011` 由 migration `0025` 增加 tenant-scoped material run、规范化 segment/translation、当前会议
speaker label、结论/action item 和逐项 evidence。Repository 从按 target fan-out 的 final translation events 中选择每个
source segment 的 latest revision，去重一致副本后计算 source count/hash；同一幂等键只恢复原 run，不同 request hash
冲突。Provider 复核在事务外执行，最终事务重新验证 run version、源 hash 和 evidence。未配置或失败时只保存冻结逐字稿，
不伪造摘要、负责人或截止时间。当前未执行 migration/down、forced-RLS、真实 Provider 或 PostgreSQL 并发门禁。

## Meeting screen OCR

`ENT-MTG-012` 由 migration `0026` 增加 run、participant subscription、append-only command、frame claim 和
append-only layout block。五张表均使用 tenant-first FK 和 forced RLS；订阅 FK 绑定 share generation/target language，
frame 只允许一次 `processing -> ready|failed`，原始图像不进入 schema。Repository 在外部 Provider 前以 run 行锁完成
感知 hash/Hamming distance 去重，并把每个实际 claim 记入 usage event/ledger。Worker 仅持短期 HMAC ticket，经内部 API
复核当前 tenant/cell/route/share lease/track/run/subscriber 后显式订阅 LiveKit screen track；Provider 默认关闭且只接受
HTTPS endpoint。布局定向发送给订阅 participant，并保留 API polling fallback。当前未执行 migration/down、forced-RLS、
真实 Provider/LiveKit、并发或客户端验收。

## Meeting calendar adapter

`ENT-MTG-013` 由 migration `0027` 增加单会议/Provider 唯一的 forced-RLS 同步记录。API 只接受主持人对未来预约
会议提交的版本/时长/幂等键，在同一 tenant transaction 写 sync、AES-256-GCM 密文 outbox 和 audit。cell Worker 使用
tenant-bound Google Workspace service account 创建稳定 event ID；409 时读取并核对 private meeting/sync 标记，避免响应
丢失后的重复创建。Provider receipt、outbox finalize 和 audit 再以一个 transaction 收敛。事件只保存无界AI成员入口，
不创建 Google Meet、不传播访客 token。readiness、direct credential、public URL 或 keyring 缺失均明确失败闭合。
当前未执行 migration/RLS、contract、真实 Google Workspace、Worker 恢复或客户端验收。

## Marketing consent evidence

`ENT-MKT-003` 由 migration `0039` 扩展 `contact_consents`，固定 Campaign/Lead、
`automated_marketing_call` purpose、对象 UUID/hash/size/content type、声明版本、actor、幂等键和版本化撤回。
证据实体由独立 S3/KMS 或非生产本地 Adapter 校验；生产禁止本地目录。Consent 不可删除或改写，task insert/
reschedule 必须在数据库内找到覆盖计划时间的有效授权，撤回会取消没有替代授权的 pending/scheduled/retry task。
当前未执行 migration/down、forced-RLS、真实对象存储、并发撤回或浏览器验收。

## Marketing suppression

`ENT-MKT-004` 由 migration `0040` 扩展 `suppression_entries`，把 tenant/global scope、Campaign/Lead 来源、
原因、来源标识、actor、幂等 hash、取消数量和 version 固化为不可变记录。公开 API 只允许 account actor 写 tenant
scope；global scope 要求 namespaced system actor 与 `global_registry` 来源，作为权威注册表的 tenant HMAC 隐私投影。

Suppression insert 与 call-task insert/reschedule 使用相同的 `tenant + phone_hash` advisory transaction lock。首次写入
在同一事务取消该号码跨活动的 pending/scheduled/retry task；后续 task guard 命中 tenant/global 记录时拒绝 SQL。
默认全局注册表 Adapter 为 not_configured，未命中本地记录也不返回 eligible。当前未执行 migration/down、
forced-RLS、同号码并发、真实全局注册表或浏览器验收。

## Marketing country policy

`ENT-MKT-005` 由 migration `0041` 新增 forced-RLS `marketing_country_policy_versions`，以不可变版本固定国家、
当地星期/分钟窗口、滚动频控、最小重试间隔、三段告知、语音信箱模式、合规确认依据和生效/失效时间。同国家
版本与生效区间唯一，发布后不可更新删除。Campaign 进入 scheduled 时按 startAt 验证所有目标国家；call task
必须显式引用与 Lead country 匹配且覆盖 scheduledAt 的版本，并由数据库按 Lead IANA timezone、当地窗口、重试
间隔和跨活动频控失败闭合。该 migration 不实现审批快照、Scheduler claim、Outbox、usage hold 或 PSTN dispatch。

## Marketing campaign approval

`ENT-MKT-006` 由 migrations `0042/0043` 新增 forced-RLS、不可变
`marketing_campaign_validation_snapshots/marketing_campaign_approval_decisions`。validate 固化 Campaign 内容、目标时间、
Country Policy set、active Lead/link/import batch、逐 Lead 有效 Consent 和 Suppression set 的规范 JSON 与 SHA-256；
ready 还要求未来开始时间、至少一条 Lead、全部国家策略、合法 PostgreSQL IANA timezone、逐 Lead Consent 和零禁拨。

批准/拒绝都引用 ready validation。批准前在相同号码 advisory lock、Lead/link/batch share lock 和 Consent share lock 下
重建 snapshot；任一集合/hash 漂移返回 stale。Campaign 只在数据库确认 validation/decision actor、时间、版本和内容后
进入 pending/approved/rejected；批准后固定 decision ID 和 snapshot hash。scheduled transition 及未来 call task 必须再次
通过当前 snapshot 比对。该层不创建 call task、usage hold、Outbox 或 PSTN 请求，真实 migration/RLS/并发仍待验收。
