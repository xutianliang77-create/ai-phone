# Enterprise PostgreSQL schema

`ENT-DATA-001` 在这里提供企业 schema、up/down migration、受保护回滚、复合外键、强制 RLS
和备份归档 smoke。它不把当前 API 的 SQLite 存储切换为 PostgreSQL；Repository
切换属于 `ENT-DATA-002`。

`ENT-DATA-002` 已提供三类 transaction-local session：

- tenant session 设置 `app.tenant_id`，把 tenant 注入 `$1`，拒绝缺少 tenant
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
并以 `FOR UPDATE` 锁定路由行后执行 lifecycle/outbox 原子 claim。该代码尚未接入
API/Worker runtime。

identity 使用 opaque subject，而不是资源 UUID：

- account subject 必须是规范的 `user_<uuid>`。
- audit/policy/idempotency actor 可以是 account subject，或
  `system:enterprise-outbox` 形式的受约束 namespace subject。
- Repository 在 SQL 前和行映射时校验；schema verify 确认所有12个 identity 列均为
  text。raw UUID、`user-a` 和 system actor 写入 user 列都会失败闭合。

当前十段 migration 中，`0004` 增加 tenant lifecycle 状态和 job，`0005` 增加
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
ENTERPRISE_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- migrate

ENTERPRISE_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- verify
```

只回滚最新一段 migration，并要求显式确认：

```bash
ENTERPRISE_POSTGRES_ALLOW_DOWN=true \
ENTERPRISE_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- rollback
```

默认要求 TLS 证书校验。仅本机封闭环境可显式设置
`ENTERPRISE_DATABASE_SSL=disable`；该设置不能进入企业试点环境。

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

HTTP/Worker runtime、启动 migration/schema verify 和 SQLite/JSON 数据对账仍未
完成。完成前禁止局部切换或双写；平台 Worker 不得使用 `BYPASSRLS` 应用角色扫描或
修改全租户数据。

## Backup smoke

归档 smoke 要求目标机存在 `pg_dump` 和 `pg_restore`：

```bash
ENTERPRISE_DATABASE_URL='postgresql://...' \
  npm run enterprise:postgres -- backup-smoke
```

该命令创建临时 custom-format archive，并用 `pg_restore --list` 验证归档可读，
随后删除本地临时文件。它不等于 PITR 或隔离环境恢复演练；真实 restore、数据对账、
RPO/RTO 和对象存储恢复证据仍属于 H3 门禁。在这些证据齐全前，
`ENT-DATA-001` 保持 `in_progress`，不能宣称 PostgreSQL 企业生产就绪。
