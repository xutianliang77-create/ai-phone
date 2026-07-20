# ENT-DATA-005 Cell 数据迁移和回滚证据

- 日期：2026-07-20
- 任务：`ENT-DATA-005`
- 分支：`codex/enterprise-edition`
- 基线提交：`e324d07f208d139703d0ce65abcf22cdd6603989`
- 状态：`in_progress`
- 验收映射：`AC-ENT-0048`、A0、A1、H1、H3

## 1. 本次交付

- 新增 `enterprise:postgres-cell export|cutover|reconcile|rollback` 维护入口。
- 动态发现全部 `enterprise` tenant 表和公共 `scope_type=tenant` communication 表；无 tenant selector、无主键、
  非延迟外键依赖环或两端 table plan 漂移时失败闭合。
- 在 `REPEATABLE READ READ ONLY` 源快照中按复合主键 keyset 分页，逐行稳定 JSON + 字节长度前缀计算逐表
  count/SHA-256；总 hash 同时绑定公共/enterprise migration、对象引用和总行数。
- export/cutover/rollback evidence 使用独立 HMAC、0600临时文件和原子 rename，固定 tenant、Cell、数据库身份、
  commit、image digest、topology，并引用前序签名文件 hash；对象 Adapter 使用另一把 receipt HMAC key。
- 迁移前拒绝非终态 communication binding、活动 dispatch grant、pending lease、公共 dispatch 和 capacity hold；
  同时要求源库只读、写探针 SQLSTATE `25006`、旧 writer 会话为0，目标可写且 writer 会话为0。
- 目标 tenant 必须为空；目标 `SERIALIZABLE` 事务按外键拓扑流式 `jsonb_populate_recordset` 导入，route epoch
  精确+1，`platform_pending_work` 由原触发器按新 Cell 重建。
- 数据库已提交但 evidence 落盘失败时，`reconcile` 在相同 fence 下从前序 export 或 cutover 与对象 receipt
  重新对账，补发 cutover 或 rollback evidence，不重复导入目标 tenant。
- 数据库中存在对象引用时，cutover/rollback 必须取得同 tenant、方向、count/hash 的签名对象复制 receipt；
  未配置对象迁移 Adapter 时明确阻断，不伪造完成。
- rollback 从当前 Cell 导出最新快照，以旧 Cell 为可写目标；受审计 superuser 在同一事务内停用用户触发器、
  反向清除、正向导入、恢复触发器并对账，避免直接启用陈旧副本或绕过不可变历史而不校验。

## 2. 代码与文档

- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-admin.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-attest.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-evidence.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-fence.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-manifest.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-plan.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-rollback.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-transfer.ts`
- `services/api-server/src/infrastructure/postgres/enterprise-postgres-cell-migration.test.ts`
- 八份企业设计、任务、计划与验收文档同步到本任务边界。

## 3. 本轮执行证据

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| 全 workspace TypeScript typecheck | pass | `npm run typecheck` |
| API build | pass | `npm run build -w @translation/api-server` |
| lint/文件规模 | pass | `npm run lint`，新增 TypeScript 文件均不超过350行 |
| diff/checksum/敏感信息门禁 | pass | staged/unstaged diff check 通过；本任务未改迁移 SQL，企业迁移仍为49段，末段 `0049_enterprise_marketing_crm_sync` 双向内容校验和为 `f20b875be37bee531e8ba4d71f779a796b849bf712c8ebc845c35750a5d9f44c`；暂存差异未发现私钥、访问令牌或硬编码密码 |
| Vitest/API/Repository | not_run | 本轮保持静态验证边界；测试已定义但未运行 |
| PostgreSQL 31+49 双库 | not_run | 未配置隔离真实 Cell 数据库与角色 |
| 对象字节复制 | not_run | 未配置对象迁移 Adapter/receipt |
| 控制面 route 发布 | not_run | 当前任务没有租户自助迁移 API，未操作外部路由 |
| rollback 故障注入 | not_run | 未执行清除/导入/trigger/commit 故障矩阵 |

## 4. 尚未通过的生产门禁

- `AC-ENT-0048` 未通过，任务不能进入 `ready_for_acceptance`。
- 尚未证明真实 staging 源/目标数据库身份、31+49 manifest、最小权限角色和 TLS `verify-full`。
- 尚未证明对象复制 receipt 对应的对象字节在目标 Cell 可读取，或回滚后旧 Cell 对象完整。
- 尚未执行新 Cell 增量写入后的反向回滚、旧 route/旧 Worker 拒绝、API/Worker 重启和路由发布。
- 尚未执行跨故障域、PITR、RPO/RTO；这些仍属于 `ENT-REL-003`/H3。
- SQLite/JSON 不参与本任务，也不能把 `ENT-DATA-004` 演示导入结果当作 Cell 迁移证据。

## 5. 验收恢复清单

1. 锁定企业 commit/image/topology，准备源只读、目标可写的隔离31+49 PostgreSQL Cell 双库和分权账号。
2. 停止并验证源 Cell API/Worker、活动会话/租约和配置 writer role 会话均为0。
3. 运行 export；由对象 Adapter 复制全部引用并生成签名 receipt；运行 cutover/reconcile。
4. 发布新 route，验证旧 route document、旧 cell Worker 和旧 generation 写入/副作用全部拒绝。
5. 在新 Cell 写入可追溯增量后执行反向 rollback，并核对全部逐表 hash、ledger/audit/object 引用和 route epoch。
6. 注入 evidence/receipt 篡改、目标预置、schema 漂移、对象漏复制、旧 writer、清除/导入/trigger/commit 故障。
7. 归档真实命令、脱敏数据库身份、签名 evidence/receipt、日志和 reviewer 结论，再评估状态升级。
