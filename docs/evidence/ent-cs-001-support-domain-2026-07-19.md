# ENT-CS-001 客服领域实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 `0028_enterprise_support_domain` 可逆 migration：建立 forced-RLS `support_queues`，并为
  channel/customer/session/case/tool 补齐状态、身份、时间、幂等、复合 tenant FK 和恢复索引。
- session/case/tool mutation trigger 拒绝删除、身份改写、版本跳跃、非法迁移和终态回退。
- 新增 Support Channel、Customer、Queue、Session、Case、Tool Execution 领域记录和状态机。
- 新增 tenant-scoped PostgreSQL Repository、Unit of Work 和 Enterprise Repository runtime adapter。
- 会话创建在一个 tenant transaction 内校验 active tenant/cell、published communication policy、
  entitlement、customer 和 active channel，并原子创建 support session、公共 communication session、
  `kind=support` binding 与审计事件。
- 重启恢复入口只读取当前 tenant 的非终态会话，并聚合 channel/customer/queue/case/tool/binding；
  binding 缺失保持可见，不伪造成功。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| API Server TypeScript build | 通过 |
| 全 workspace TypeScript typecheck | 通过 |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |
| migration loader | 28 段；最新为 `0028_enterprise_support_domain` |
| 最新 migration SHA-256 | `b69ff61b579a90bbbaf76f505db5182aec824386f4433d30424c4872d1ab0239` |
| schema manifest | 68 张 tenant 表；29 个 opaque subject 字段；公共+企业当前102张表 |

## 3. 明确未执行

按本轮要求跳过所有测试，未运行 Vitest/API/Repository/migration/forced-RLS/并发/重启恢复测试；
状态矩阵只定义未执行。也未连接真实 PostgreSQL、PSTN/Web/App Channel Provider、浏览器、真机或
生产服务。

因此本证据只证明代码可构建并满足静态门禁，不证明 AC-CS-001..005、A2、H3 或企业生产门禁通过。
恢复测试后至少需要补齐双租户 forced-RLS、幂等/hash、CAS 竞争、终态不可变、事务回滚、缺 binding、
API/Worker 重启恢复和真实 PostgreSQL down/forward 证据。
