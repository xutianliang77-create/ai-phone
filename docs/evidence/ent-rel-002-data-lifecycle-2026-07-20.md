# ENT-REL-002 数据生命周期实现与静态门禁证据

日期：2026-07-20
分支：`codex/enterprise-edition`
状态：`in_progress`；代码候选完成，`AC-ENT-0051` 未执行

## 1. 范围

本项复用三个既有真值，不建立平行状态机：

- `audit_export_jobs`：导出请求、对象摘要和到期时间真值。
- `tenant_jobs`：tenant export/delete saga 与最终 tenant tombstone 真值。
- `platform_pending_work`：Cell Worker 恢复发现和 owner/generation/lease 协调真值。

新增 `0051_enterprise_data_lifecycle`、tenant-scoped Repository、Cell Worker processor 和对象删除 Adapter，
首批把 audit export 到期对象接入物理删除；tenant delete 在对象 job 与外部 Provider 清单未收敛前失败闭合。

## 2. 数据与状态栅栏

- `data_lifecycle_jobs` 以 `tenant_id + id` 为主键，`tenant + dataClass + sourceId` 唯一，引用同 tenant
  `audit_export_jobs`，启用并强制 RLS。
- audit export 首次 completed 时由数据库 trigger 在同一事务登记 object key、SHA-256、size、1..30天保存期
  和截止时间；processing/failed 不登记，历史 completed 数据按唯一键 backfill。
- audit export INSERT 先锁定 tenant 行；tenant 非 active 时数据库拒绝，API 正常路径返回
  `tenant_lifecycle_pending`。processing audit export 也计入 tenant delete blocker，避免检查后出现迟到对象。
- 删除范围、source、保存期和终态不可更新或删除；attempt 只能加一。terminal receipt/audit 保留，failed 不被
  解释为 completed。
- pending-work 新增 actor-null `data_lifecycle` kind，正常按 retention deadline due；tenant 首次进入
  `deletion_requested` 时只提前调度，不改写原保存期证据。
- Worker 继续使用 Cell forced-RLS、数据库 `SKIP LOCKED`、owner/generation/coordination lease、tenant route 锁、
  job lease 和 attempt CAS；旧 Cell、旧 generation 或旧 attempt 不能 finalize。

## 3. 对象与租户删除收敛

- S3-compatible Adapter 对存在对象执行 `Head -> Delete -> Head`；只有删除后 404/NoSuchKey 才返回 `deleted`。
- 删除前已经 404 返回独立 `already_absent`，并生成不同 receipt；对象仍存在、网络未知、未配置、非法 key
  或 local production 配置都不生成成功。
- 非生产 local Adapter 仅为封闭演示，执行 `stat -> rm -> stat`；不能作为真实 S3 证据。
- terminal audit 只记录 data class、source ID、retention deadline、outcome/error 和 receipt hash，不写 object key、
  bucket、endpoint、URL、Provider reference 或凭据。
- tenant delete 在任一 processing/failed object job 或 processing audit export 存在时不调用外部 executor。HTTP completed receipt 还必须绑定
  tenant/job、database tombstone manifest、object/provider count/hash，满足 discovered = deleted + alreadyAbsent、
  remaining=0 且规范化 SHA-256 匹配；否则返回 `deletion_not_converged`。

## 4. 测试定义

- migration manifest、forced-RLS、不可变 trigger、删除期迟到导出行锁、pending-work kind 与 down 阻断。
- Repository due/expedite claim、attempt CAS、receipt finalization、outstanding failed 与 processing export 阻断。
- local artifact 真实删除、重复删除 `already_absent`、非法 key 和未配置降级。
- pending-work 映射、tenant route 二次复核与 `deletion_requested` 提前 claim。
- Worker verified receipt finalize、对象未完成时 tenant executor 调用次数为零。
- HTTP tenant delete 的 database/object/provider convergence、count 守恒、remaining 非零和 receipt hash 负向矩阵。

上述测试代码已定义，但按当前持续静态边界未运行 Vitest、API/Repository 全量或真实环境测试。

## 5. 本轮静态验证

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| API Server 定向 typecheck | pass | 新 Repository/Worker/Adapter/测试定义类型通过 |
| 全 Node workspace typecheck | pass | 10个 Node workspace；不代表运行时验收 |
| API Server build | pass | TypeScript 构建及 migration 复制完成，源码/产物逐字一致 |
| lint/350行、diff check | pass | 文件规模和空白门禁均通过 |
| 企业静态安全扫描 | pass | 21条规则，扫描2616个文件，P0/P1/P2/P3 均为0 |
| migration manifest/checksum | pass | enterprise 51段；`0051` checksum `ded72ee5430ee0d40c4e0985ee4b27b5fc3e7bb058e0e8a03e2edd0cbbcd455d`；tenant表93、关键表21 |

## 6. 未通过边界

- 未运行 Vitest、API 全量、Repository、真实 PostgreSQL `0051` up/down/forward 或 forced-RLS 双租户矩阵。
- 未运行真实 S3-compatible Delete/Head、一致性/权限/版本化对象、429/5xx/响应丢失或对象仍存在故障注入。
- 未接入或执行会议、录音、授权证据等其他业务对象的直接 Adapter；它们仍须由真实生命周期服务 manifest 证明。
- 未运行真实 Provider 删除、双 Worker/kill -9、旧 generation、租户删除并发、重启恢复或容量验收。
- SQLite/local store 仍仅用于本地开发和封闭演示；不能宣称 PostgreSQL 企业试点、`AC-ENT-0051` 或生产门禁通过。
- 未构建/安装生产 App，未操作 Beelink、服务、浏览器或真机。
