# Enterprise PostgreSQL schema

`ENT-DATA-001` 在这里提供企业 schema、可逆 migration、复合外键、强制 RLS
和备份归档 smoke。它不把当前 API 的 SQLite 存储切换为 PostgreSQL；Repository
切换属于 `ENT-DATA-002`。

当前六段 migration 中，`0004` 增加 tenant lifecycle 状态和 job，`0005` 增加
导出/删除执行所需的 scope snapshot、attempt、lease、retry、receipt 和终态约束，
`0006` 为 audit events 增加 result/details 约束、tenant-first 查询索引和拒绝
UPDATE/DELETE 的 append-only 触发器。这些结构支持控制面代码和自动化，不代表
真实 PostgreSQL、对象存储或审计保留策略验收已经完成。

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
