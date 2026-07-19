# ENT-MKT-006 活动审批实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 validation/decision 契约，固定 Campaign 内容、目标时间 Country Policy set、active Lead/link/committed
  batch、逐 Lead 有效 Consent、Suppression set 的数量、规范 JSON SHA-256、issue、actor、时间和源版本。
- 新增 `0042_enterprise_marketing_campaign_approvals`：两张 forced-RLS、insert-only 表、tenant-first 复合 FK、
  actor/key 幂等、数据库逐项 JSON 复核，以及 validation/decision 直接 SQL guard。
- 新增 `0043_enterprise_marketing_approval_guards`：把 `draft -> validating -> pending_approval -> approved|draft/rejected`
  逐步绑定不可变证据；Campaign 固定 approval decision ID/snapshot hash；scheduled 和 call task 再复核当前快照。
- Repository 在校验/批准事务内锁 Campaign、Lead/link/batch/Consent，并按排序取得与 Suppression 相同的
  `tenant + phone_hash` advisory lock；批准前重建 snapshot，任一集合/hash 漂移返回 `validation_stale`。
- 新增 tenant-scoped Repository/runtime/API 和审计。validate 要求 `campaign:write`，approve/reject 要求
  `campaign:approve`，读取要求 `campaign:read`；active membership、签名 route、strict body、expectedVersion、
  body tenant 一致性与幂等键都失败闭合，legacy/SQLite/JSON 返回 PostgreSQL required。
- Enterprise Web 复用现有 Material Icons、颜色 token、1px outline、8px 圆角、StatusPanel 和响应式规则；审批区
  默认折叠按需读取，成员提交校验，主管批准/拒绝，只显示服务端计数/hash/issues/decision。

## 2. API 与状态边界

```text
GET  /enterprise/v1/campaigns/:campaignId/approval
POST /enterprise/v1/campaigns/:campaignId/approval/validate
POST /enterprise/v1/campaigns/:campaignId/approval/approve
POST /enterprise/v1/campaigns/:campaignId/approval/reject
```

ready validation 必须同时满足：未来 startAt、至少一条有效 Lead、每个 Campaign 国家存在目标时间 active Policy、每条
Lead 国家属于 Campaign、timezone 存在于 PostgreSQL `pg_timezone_names`、目标时间有有效 Consent、Suppression set
为空。blocked validation 保存不可变证据但不修改 Campaign；ready 才经 validating 进入 pending。

approve/reject 必须引用同 Campaign ready validation。批准要求当前 snapshot 与 validation 完全一致；拒绝允许业务主管
在数据随后变化时仍给出理由并退回 rejected draft。编辑 rejected draft 会重置为 not_submitted，必须重新 validate。

本批不生成 call task、usage hold、Scheduler claim、Outbox、PSTN dispatch/cancel 或真实 Provider 效果。批准只是受控
内部证据，不等于具体国家/州/号码类型/用途已经获得法律意见。

## 3. 失败闭合不变量

| 场景 | 代码候选行为 |
| --- | --- |
| member/auditor 直接 approve/reject | 服务端 scope 拒绝，Web 不显示主管操作 |
| body tenant、跨 Campaign/snapshot/decision、失效 route | tenant context、复合 FK、forced RLS 拒绝 |
| validate 同键同/异 hash | 返回原 snapshot / 冲突，不重复状态迁移或审计 |
| 无未来排期、空 Lead、策略/国家/时区/Consent 不符、禁拨 | blocked snapshot；Campaign 保持 draft/rejected |
| validate 与 Suppression 并发 | 相同 phone advisory lock 串行化，不形成遗漏禁拨的批准 |
| approve 与 Consent 撤回/Lead 回滚/禁拨并发 | share/advisory lock 串行；批准前重建，漂移返回 stale |
| 直接 SQL 跳 validating/pending/approved/rejected | actor/time/source version/snapshot/decision trigger 拒绝 |
| 批准后任一数据或策略集合变化 | scheduled Repository/DB guard 失败；task approval guard 失败 |
| task 伪造 approval ID 或非冻结 Lead/Consent/Policy | SQL 拒绝，不留下可执行任务 |
| legacy/SQLite/JSON | 503，不读取 fixture 或客户端审批状态 |

## 4. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 517918 B，JS 987179 B，CSS 83865 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；43段，末两段 `0042/0043` |
| `0042` checksum | `92eab0dc2c92710568a387aadd5b1e2f3783a9e1901b93e18299798f2af0857b` |
| `0043` checksum | `6a772c1a9d5dfe00b28c64220290806bab717a65bcd9a62314effa4dff48664f` |
| tenant/subject 静态清单 | 84张 forced-RLS tenant table、47个 subject column |
| cutover 关键表静态清单 | 11张，新增 validation/decision |
| `git diff --check` | 通过 |

Vite 仍报告入口 chunk 超过500 kB的提示，但项目 bundle 硬门禁通过。feature diff 阶段不运行要求 clean release commit/
metadata 的 `--release` 身份门禁。静态编译和 loader 不等于数据库或生产放行。

## 5. 已定义但未运行的验收

新增领域测试定义覆盖 actor/version/snapshot request hash、公开 DTO 不暴露 raw Lead/Consent set 和拒绝 decision；迁移
静态契约覆盖 `0041..0043` 表、forced RLS、不可变/状态/schedule/task guard。`AC-ENT-0039` 定义角色/租户、校验、
数据、幂等/CAS、schema、快照竞态、批准后过期、task 和 Web 九组矩阵。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、Flutter
或任何真实 PostgreSQL/Provider/LiveKit/设备测试；未操作生产 App、个人版 WIP、Beelink、PSTN、CRM 或生产服务。

因此本批不证明 `AC-ENT-0039`、A0/A3/H2/H3、目标法域合规、真实调度/外呼或企业生产门禁通过。
`ENT-MKT-006` 保持 `in_progress`，下一任务为 `ENT-MKT-007 Scheduler`。
