# ENT-DATA-006 Cell Worker 多实例协调实施证据

日期：2026-07-20
状态：`in_progress`
验收项：`AC-ENT-0049`（未通过）

## 1. 本批交付

- `0050_enterprise_worker_coordination` 为 `platform_pending_work` 增加持久
  `coordination_owner/generation/lease`、Cell forced-RLS update policy、due index 和严格 transition trigger。
- transition trigger 以 transaction-local `app.worker_id` 绑定 owner，伪造 tenant context 不能绕过 Cell guard，
  单次 claim/renew 的数据库 lease 上限为五分钟。
- Cell session 新增窄协调 SQL 通道，只允许当前 Cell 的 pending-work UPDATE 且只能修改协调列；原只读发现通道不放宽。
- 多实例批量 claim 使用单事务 `FOR UPDATE SKIP LOCKED`，只选择业务 lease 与协调 lease 均到期的 due work，
  并以 owner+单调 generation 返回最小引用；due/expiry 和新 lease 均以数据库时钟为准。
- Worker 在执行前续租、执行中 heartbeat、结束时以 owner+generation 条件释放；同批记录并发处理，单项失败独立计数。
- 具体 tenant job/outbox 继续在 tenant transaction 中 claim/finalize；旧 attempt/CAS 被拒绝，所有外部 Adapter
  继续复用稳定 job/event ID。该设计不声称 exactly-once transport，只要求幂等业务副作用。
- Cell 迁移 quiescence 同时检查协调 lease；反向导入 pending projection 时清空 source owner/lease，避免复制旧实例所有权。
- 功能、UI 边界、架构、技术、任务、计划和验收文档已同步；不新增客户操作 UI。

## 2. 代码与测试定义

- `services/api-server/src/infrastructure/postgres/migrations/0050_enterprise_worker_coordination.{up,down}.sql`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker-coordination.repository.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker-coordination.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-audit-export-worker.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-session.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-manifest.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-transfer.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker-coordination.repository.test.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker-coordination.test.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-worker.test.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-session.test.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-migration.test.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-migrations.test.ts`

定义的矩阵覆盖 claim SQL/owner/generation/lease 映射、竞争实例空 claim、当前代续租/释放、旧代 no-op、
malformed/lease-bound fail-closed、执行前 fence、批处理故障隔离、Cell SQL 白名单和 migration manifest。

## 3. 本轮执行证据

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| 全 workspace TypeScript typecheck | pass | `npm run typecheck` |
| API build | pass | `npm run build -w @translation/api-server` |
| lint/文件规模 | pass | `npm run lint`；新增/修改 TypeScript 文件均不超过350行 |
| migration manifest | pass | 公共仍为31段；enterprise 为50段，末段 `0050_enterprise_worker_coordination` 双向内容校验和 `c878930486fb75561376023b88231de21b8ab2d589b48b0a1486d3a6cd8071b0` |
| diff/敏感信息门禁 | pass | staged/unstaged diff check 通过；差异仅新增 `0050` migration；暂存差异未发现私钥、访问令牌、硬编码密码、TODO/FIXME 或生产调试日志 |
| Vitest/API/Repository | not_run | 本轮保持静态验证边界；测试已定义但未运行 |
| `0050` migrate/down/forward | not_run | 未配置隔离真实 PostgreSQL 和分权角色 |
| 双实例/kill -9/网络故障 | not_run | 未启动真实多进程 Cell Worker |
| Provider sandbox 去重 | not_run | 未配置真实 lifecycle/object/Outbox Provider |
| Redis 故障 | not_applicable | Redis 未进入正确性路径，也未新增 Redis 依赖 |

## 4. 尚未通过的生产门禁

- `AC-ENT-0049` 未通过，任务不能进入 `ready_for_acceptance`。
- 尚未证明普通 Cell 角色只能更新协调列、跨 Cell/业务列直写由 RLS/trigger/privilege 全部拒绝。
- 尚未以两个以上独立进程连续竞争100轮并证明单一 owner/generation、无饥饿和无全局串行。
- 尚未在 queue claim 前、tenant claim 后、Provider 接受后、finalize 前执行 kill -9 与租约到期重领。
- 尚未以真实 Provider sandbox 证明相同 job/event ID 的重试只产生一个外部业务对象或效果。
- 尚未执行 PostgreSQL 网络分区、连接池恢复、120分钟混合负载、H1/H3 或跨故障域门禁。

## 5. 验收恢复清单

1. 锁定企业 commit/image/topology，以公共31段+企业50段重建隔离 PostgreSQL，并创建 tenant/cell/migration 最小权限角色。
2. 执行 `0050` up/down/forward、schema/checksum、forced-RLS 和 Cell 业务列/跨 Cell 负向矩阵。
3. 启动至少两个独立 Worker，运行100轮同批 claim、heartbeat、lease expiry、旧 generation renew/release/finalize 攻击。
4. 在四个故障点 kill -9，验证更高 generation/attempt 收敛、terminal/ledger/audit 唯一和批次继续处理。
5. 接入真实 sandbox，核对 lifecycle/object/Outbox 使用稳定 job/event ID，Provider 侧对象/副作用数量为1。
6. 归档数据库日志、脱敏行状态、Provider receipt、命令和独立 reviewer 结论后，再评估任务状态升级。
