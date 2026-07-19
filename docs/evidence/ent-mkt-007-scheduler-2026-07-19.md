# ENT-MKT-007 Scheduler 静态交付证据

日期：2026-07-19

分支：`codex/enterprise-edition`

基线提交：`286d5398ef8a452e98bb1310a942085d03e215af`

## 交付范围

- Campaign schedule 在同一 tenant transaction 中，从当前 approved validation snapshot 为每条冻结 Lead 物化一个
  确定性 attempt-1 task；当地窗口无法完整解析时零 task、零 Campaign 状态变化。
- PostgreSQL-only Scheduler 使用签名 route/current epoch、`FOR UPDATE SKIP LOCKED`、version CAS、随机 claim
  token hash、lease/generation、Campaign/tenant entitlement 并发与固定60秒 `marketing_call_seconds` hold。
- Repository 和 `0044` trigger 两层复核 approval、active Lead/link、Consent、Suppression、Country Policy、被叫当地
  时间窗口、预算 hold 与容量；lease 到期释放 hold 并回 retry，撤回/禁拨取消未派发 claim。
- Enterprise Web 增加按需加载的只读调度面板，复用 Material Icons 与现有 token，展示真实 task/预算/并发状态。

## 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 workspace typecheck | 通过 |
| Enterprise Web e2e TypeScript typecheck | 通过 |
| 根级 workspace build | 通过；API build 已复制 migration |
| Enterprise Web production build | 通过；167 modules |
| Enterprise Web bundle 静态扫描 | 通过；9 files，entry JS 521566 B，全部 JS 990827 B，CSS 85571 B |
| lint / 文件大小门禁 | 通过；变更源文件均不超过350行 |
| `git diff --check` | 通过 |
| migration loader | 44段有序；最新 `0044_enterprise_marketing_scheduler`；checksum `632dd6faeb0990dc0b8f651e52463a5185fa3f301ebee9a81aec7604f2fd4870` |
| schema 静态清单 | 公共31段 + enterprise 44段；仍为118张业务表；subject column 增至48 |

## 明确未执行

本批按当前恢复边界只执行静态门禁，没有运行 Vitest/API/Repository/migration/forced-RLS、Playwright、Flutter、
真实 PostgreSQL、Provider、LiveKit、PSTN 或真机测试。新增测试定义覆盖确定性 identity/hash/token、migration
Scheduler trigger 和 manifest 顺序，但其“已定义”不等于“已通过”。

因此 `ENT-MKT-007` 与 `AC-ENT-0040` 均保持 `in_progress`。本批不证明50 Scheduler 真实并发、跨 tenant cell 隔离、
真实 lease 崩溃恢复、staging 31+44 migrate/restore/PITR 或企业生产放行。

## 副作用边界

`dispatching` 仅表示 task 与 usage hold 已被内部 Scheduler claim。`0044` 当前不允许进入
`dispatched/answered/completed`；没有创建 communication session、Outbox、Provider/PSTN 请求或用量结算。
这些外部副作用从 `ENT-MKT-008` 开始实现和验收。
