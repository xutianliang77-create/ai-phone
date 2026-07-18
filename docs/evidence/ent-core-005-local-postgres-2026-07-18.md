# ENT-CORE-005 本地 PostgreSQL 术语与话术版本证据

日期：2026-07-18

环境：本机 Docker `postgres:16`，隔离数据库；容器和临时演练脚本已删除

范围：代码、自动化和本地机制候选证据，不是企业 staging、A1/H3 或生产放行证据

## Schema 与迁移

- 公共31段、enterprise 18段 migration 从空库执行成功。
- schema verify：18段 enterprise migration、51张 tenant 表、58个复合 tenant FK、23个 text subject column，所有 tenant 表 `rls=forced`。
- `0018` 新增 `term_pack_versions`、`script_templates`、`script_template_versions`，并把 legacy
  `term_packs` 收敛为稳定资源。
- 使用 `NOSUPERUSER NOBYPASSRLS` 且拥有 schema 的独立 migration role，先回滚到 `0017`，写入一条
  legacy 术语包，再执行 `0018`：backfill 得到 revision 1、draft、`zh-CN`、1条术语。
- 同一 migration role 执行 `0018 down` 后，legacy locale/terms 数量仍为 `zh-CN/1`，`term_packs`
  已恢复 forced RLS；再次 forward 后最终 verify 仍为18/51/58/23。
- rollback 管理命令在成功执行 down 后继续按最新 manifest 校验，因此以“缺少3张 `0018` 表”退出；
  这是 fail-closed 校验结果，不是 down SQL 失败。随后 forward/verify 成功。

## Repository、状态机与隔离矩阵

普通应用角色为非表 owner、`NOSUPERUSER NOBYPASSRLS`。真实 tenant transaction 运行
term pack、script template 的 create -> revision -> review -> publish -> resolve：

```json
{
  "ready": "ready",
  "sameTermVersionRefs": true,
  "scriptVersionRef": "10000000-0000-4000-8000-000000000004",
  "review": "term_pack_not_ready",
  "expired": "term_pack_not_ready",
  "foreign": "term_pack_not_ready",
  "foreignRead": 0,
  "scriptReview": "script_template_not_ready",
  "publishedImmutable": true,
  "reviewHashImmutable": true
}
```

- 顶层、ASR、翻译、LLM 的 `termPackVersionId` 完全一致；顶层保留话术关联 ID，实际内容与执行引用只提供给 LLM。
- review、过期、跨租户术语版本不进入运行上下文；review 话术明确返回 not ready。
- Tenant B 以 Tenant A version ID 裸读返回0行。
- 已发布内容更新、review 后 content hash 更新均被数据库 trigger 拒绝。
- Repository 在返回运行时内容前重新计算 SHA-256，不一致时失败闭合。

## API、权限与自动化

- 13个 HTTP 路由覆盖术语包/版本、话术模板/版本和统一 resolver；写操作要求
  `knowledge:publish`，读/解析要求 `knowledge:read`，并同时要求 active membership 与有效签名
  tenant route document。
- body tenantId 伪造、无写 scope、非法 UUID 和 legacy/SQLite runtime 均有负向测试；legacy runtime
  明确返回 `enterprise_postgres_required`。
- 定向 domain/route/Repository/migration：6 files / 21 tests 通过。
- API 全量：190 files / 686 tests 通过。
- 全 Node 回归：383 files / 1423 tests 通过，根级 build 同步通过。
- 根级 `typecheck`、`lint`、file-size 和 `git diff --check` 门禁通过。

## 边界

- 当前实现提供确定性的术语/话术内容、版本解析和引用契约，没有调用或伪造外部 Provider 成功。
- 尚未在真实 ASR、翻译、LLM Worker 中完成 staging 消费验证、并发发布、长稳或历史会话回放。
- 本地同机 PostgreSQL 证据不能替代双租户 staging、容量、安全、备份恢复、跨故障域和 H3 验收。
