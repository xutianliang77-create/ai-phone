# ENT-MKT-012 Outcome 实现与静态门禁证据

日期：2026-07-20
分支：`codex/enterprise-edition`
状态：`in_progress`
验收项：`AC-ENT-0045` 未通过

## 1. 本次交付

- 新增共享 Outcome/证据/内部 next action 契约，并通过 active membership、签名 route、
  `campaign:read/write` 服务端 guard 暴露 Campaign 级读取/创建 API；客户端提交 tenantId、跨 Campaign
  dispatch、旧 route、非法枚举、额外字段和幂等漂移均失败闭合。
- enterprise migration `0048_enterprise_marketing_outcomes` forward-safe 升级早期
  `marketing_outcomes` 占位表，并增加 forced-RLS `marketing_next_actions`。旧行标为
  `legacy_unverified`，不进入新读取结果，但继续阻断同 task 重复 Outcome。
- Outcome 只允许绑定同租户、同 Campaign 的终态 task/dispatch、endedAt 和终态 Agent run/handoff。
  数据库和 Repository 双重验证退订 suppression、无效号码 allowlist failure code、真实失败、客户字幕证据、
  分类/意向/next-action 组合和 dueAt。
- Repository 只接受公共 tenant-scoped transcript 当前最终 revision 和已交付 Agent turn；再补充 dispatch、
  run、handoff 与 suppression 系统证据，生成稳定 evidence/source SHA-256。客户原文只参与 content hash，
  不复制到 Outcome evidence document 或普通审计。
- task 行锁/advisory transaction lock、`(tenant,task)` 唯一键、actor/idempotency/request hash 和
  append-only trigger 保证同 task 只有一个不可变 Outcome；同键同请求重放，不同请求或并发重复拒绝。
- 后续动作最多一条，当前状态只能为 `requested`。deferred constraint trigger 要求 action kind、dueAt 和
  evidence hash 与 Outcome 同事务一致；更新、删除和不完整事务全部拒绝。
- API 审计固定 `externalAction=not_executed`。本任务不调用 CRM、日历、消息或 PSTN Provider，不创建外部
  Outbox/receipt，也不把回拨、预约、资料发送或人工复核请求显示为已完成。
- Enterprise Web 复用现有 Material Icons、token、`StatusPanel`、1px outline、8px 圆角和响应式 Campaign
  布局；只列尚未固化的终态通话，选择最终字幕/Agent evidence 后提交，列表显示 hash 和
  `requested/外部未执行`。无写 scope 时保持只读。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 全工作区 `npm run typecheck` | 通过；Enterprise Web、contracts、API Server、PSTN Bridge、Realtime Gateway、Worker 等工作区均为0错误 |
| `npm run typecheck:e2e -w @translation/enterprise-web` | 通过 |
| 全工作区 `npm run build` | 通过；Enterprise Web 生产构建与 API migration copy 成功 |
| `npm run check:lines` | 通过 |
| Enterprise Web bundle 静态检查 | 通过；14 files，entry JS 524208 B，全部 JS 1029502 B，CSS 91722 B；未放宽预算 |
| migration loader | 通过；48段，末段 `0048_enterprise_marketing_outcomes`，checksum `cfc937aaf330ae97b820c68d09fd3a23f810c08ce1778895342ad8b0648e5446`；91张 tenant tables、19张 critical tables 已进入当前静态清单 |
| `git diff --check` | 通过 |

## 3. 未执行与证据边界

- 本轮按既定静态边界没有运行 Vitest、API/Repository 自动化、migration up/down/forward、普通角色
  forced-RLS、双租户、并发/崩溃恢复矩阵或 Playwright 浏览器测试；新增单元和 migration 测试只是定义，不是通过证据。
- 没有启动真实 PostgreSQL、PSTN/LiveKit/Marketing Agent、CRM/日历/消息 Provider 或真实通话；没有验证
  真实 transcript revision 竞态、同 task 多写者、Provider failure code 兼容性或外部 receipt。
- 当前 manifest 为公共31段 + enterprise48段，旧 `ENT-DATA-009` 签名切换证据必须在 staging 重新生成；
  静态 migration loader 不替代 migrate/restore/PITR、普通角色 forced-RLS 或企业生产门禁。
- 本次不构建、安装或覆盖原生产 App，不操作 Beelink、服务或真机。
- SQLite/JSON 仍只是本地开发/封闭演示边界，不构成 PostgreSQL 企业试点门禁。

因此 `ENT-MKT-012` 保持 `in_progress`，`AC-ENT-0045` 未通过。下一项为 `ENT-MKT-013` CRM Adapter；
正式验收时先执行 `0048` 空库/增量/down/forward、forced-RLS/双租户、角色×操作×终态×证据×并发矩阵，
再以真实白名单通话和外部 Provider receipt 验证 requested 与 completed 的严格边界。
