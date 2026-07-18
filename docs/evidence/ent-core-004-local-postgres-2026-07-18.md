# ENT-CORE-004 本地 PostgreSQL 知识版本证据

日期：2026-07-18
环境：本机 Docker `postgres:16`，隔离数据库 `enterprise_knowledge`
范围：机制和自动化候选证据，不是企业 staging/A1/H3 或生产放行证据

## Schema

- 公共31段、enterprise 17段 migration 从空库执行成功。
- schema verify：17段 migration、48张 tenant 表、56个复合外键、17个 text subject column。
- 所有 tenant 表 `rls=forced`，应用角色为普通 login role，无 superuser/BYPASSRLS。
- `0017` down 删除 `knowledge_chunks`，forward 重新建立后 migration 数恢复为17；最终 verify 再次通过。

## Repository 和隔离矩阵

普通角色通过真实 tenant transaction 运行 source -> revision -> chunks -> review -> publish：

```json
{"active":1,"review":0,"expired":0,"foreign":0,"foreignRead":0,"immutable":true}
```

- 当前有效 published version 命中1条并返回稳定 citation。
- review 未发布版本、已过期 published version和另一 tenant 的 published version均返回0条。
- Tenant A 以 Tenant B version ID 裸读返回0行。
- 修改已发布 chunk 被数据库 trigger 拒绝。
- 人工构造 review version 但不写 chunk，发布被数据库以
  `enterprise knowledge version is not publishable` 拒绝。

## 自动化

- 定向 domain/route/Repository/migration：4 files / 13 tests 通过。
- API 全量：187 files / 677 tests 通过。
- 全 Node 回归：380 files / 1414 tests 通过，工作区 build 同步通过。
- 根级 `typecheck`、`lint`、file-size 和 `git diff --check` 门禁通过。

## 边界

- 当前检索为 tenant/locale/country/product/effective-time 约束下的确定性文本匹配。
- 未配置 embedding/向量 Provider，不声明向量召回成功或 readiness。
- 未连接真实对象存储、文档解析器、恶意文件扫描服务或外部 Provider。
- 本地同机 PostgreSQL 证据不能替代双租户 staging、容量、安全、备份恢复和生产 H3 验收。
