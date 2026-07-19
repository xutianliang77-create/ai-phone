# ENT-CS-009 坐席队列实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- `0034_enterprise_support_agent_queue` 为队列增加10..86400秒 handoff SLA 和30..3600秒 claim lease，
  新增 forced-RLS `support_agent_claims`。
- tenant-first FK 绑定 session、queue 和 member；部分唯一索引保证同 tenant/session 同时最多一个 active
  claim。`support_sessions.active_agent_claim_id` 以 deferred 复合 FK 同时绑定 claim/session/assigned user。
- DB insert guard 要求 session=`handoff_requested`、同 queue、queue active、无当前 claim、member active 且
  角色为 owner/admin/support_manager/support_agent；mutation guard 只允许 active lease 递增或一次性进入终态。
- work-item 只投影 `handoff_requested` 和 claim lease 已过期的会话，按 SLA breach、priority、handoff time、
  session ID 确定性排序；只读列表不隐式修改状态。
- 新增 queue create/list、work-item list、self-claim、renew、release 和 reassign API。所有入口校验 membership、
  scope、签名 tenant route；claim 不接受客户端 agent 字段。
- 坐席只能领取到自己、续租和自释；owner/admin/support_manager 可覆盖释放或改派，目标必须是同 tenant
  active 客服成员。runtime 与数据库重复执行角色/成员守卫。
- claim、lease 到期重领、release 和 reassign 均使用 session-first 行锁、optimistic version、幂等请求 hash、
  tenant Unit of Work 和脱敏审计。中间 CAS/绑定失败抛错并整体回滚。
- `0034` down migration 只允许 claim 表为空；已有接管证据时失败闭合，不静默删除。

## 2. 角色、并发和状态矩阵

| 场景 | 代码候选行为 |
| --- | --- |
| support_agent claim | 只以当前登录 user self-claim；body 无 agent 字段 |
| support_agent 改派或释放他人 claim | runtime 拒绝 `forbidden` |
| owner/admin/support_manager 改派 | 目标为同 tenant active 客服角色时允许 |
| 非客服角色或 inactive member | scope/runtime/DB insert guard 拒绝 |
| 两坐席同时 claim 同一 session | session version + active partial unique index 只允许一个 |
| claim 成功 | claim insert 与 session `handoff_requested -> human_active` 同事务 |
| release | claim terminalize 与 session `human_active -> handoff_requested` 同事务 |
| reassign | old claim terminalize、session release、new claim、session activate 同事务 |
| lease 到期 | work-item 显示 `claim_expired`；下一次 claim 原子写 expired 并重领 |
| 同幂等键同 hash | 返回原 claim；不重复创建控制权 |
| 同幂等键异 hash或旧 version | 409 conflict；不提交局部状态 |
| paused/disabled queue 或非 handoff session | 不可领取 |
| 跨 tenant queue/session/claim/member | tenant context、forced RLS 和复合 FK 拒绝 |
| 直接改写 identity、终态 claim 或删除 | mutation trigger 拒绝 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| API Server TypeScript typecheck | 通过 |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；34段，末段 `0034_enterprise_support_agent_queue` |
| `0034` loader checksum | `131f6749915bb971ea3240b20afe8845ed5676fc8fdcc569400edcf6ce6d1dce` |
| schema manifest | 当前公共31段 + enterprise 34段，预期107张业务表 |
| tenant/subject 静态清单 | 73张 forced-RLS tenant table、34个 subject column |
| `git diff --check` | 通过 |

## 4. 已定义但未运行的验收

- migration loader、Repository work-item/claim/release 测试断言已更新或新增。
- `AC-ENT-0030` 定义角色×操作、跨租户、双坐席并发、lease 到期、幂等/version、事务崩溃、锁顺序、
  SLA 边界和直接 SQL 绕过矩阵。

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Worker、浏览器、Flutter
或任何真实数据库/Provider/LiveKit/设备测试。未连接真实 PostgreSQL、CRM、PSTN、生产 App、Beelink
或任何生产服务。

因此本批不证明 `AC-ENT-0030`、A0/A2/H2/H3、真实坐席接通、企业试点或生产门禁通过。`ENT-CS-010`
坐席工作台的字幕、客户上下文、知识建议和媒体控制也未在本批实现。
