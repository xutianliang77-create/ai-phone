# ENT-CS-005 Tool Registry 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 Tool Registry 共享契约和服务端定义验证：工具 revision 不可变，状态只允许
  `draft -> active -> retired`，同名工具同时只能有一个 active revision。
- 风险映射由服务端固定：`read -> support:read + none`、
  `reversible_write -> support:manage + customer_confirmation`、
  `high_risk -> support:takeover + human_handoff`；客户端错配组合失败闭合。
- 工具输入限制为封闭根对象、最多32个 `string/number/integer/boolean` 字段和8192字节；
  schema 与规范化参数均生成 SHA-256，原始参数不写入 execution 或审计明细。
- 新增 `0030_enterprise_support_tool_registry` up/down migration：定义表使用 tenant-first 复合键、
  forced RLS、唯一 active revision 索引和不可变触发器；`tool_executions` 绑定精确的
  tenant/definition/name/revision/risk/scope。
- PostgreSQL insert guard 拒绝未注册、非 active、确认形状错配和高风险自动执行。
  升级时已存的未注册非终态 execution 转为 `cancelled`，避免旧记录绕过新边界；
  down migration 不伪造恢复原状。
- 新增 tenant-scoped Repository/runtime 和管理 API；同名 revision 创建与发布都以 tenant 行锁串行化，
  发布新版与退役旧 active 版在同一事务完成。管理路由同时要求 membership/RBAC 和签名
  tenant route document。
- 内部授权入口重验内部凭据、签名 `voice_agent_runtime` ticket、lease、binding、policy、
  route epoch、generation、run 和 support session；tenant/customer/session 全部从服务端上下文解析。
- 只读授权只创建 `requested`，可逆写只创建 `awaiting_confirmation`，高风险只返回
  `handoff_required` 且不创建 execution。同幂等键同请求返回原记录，异请求返回冲突。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript typecheck / build | 通过 |
| API Server TypeScript typecheck / build | 通过 |
| migration loader | 通过；30段，末段 `0030_enterprise_support_tool_registry` |
| `0030` loader checksum | `e8ece26eb3e9c0105ca2145311b4889851cc6b336303cac78cbfaba01267361f` |
| schema manifest | 当前公共31段 + enterprise 30段，预期105张业务表 |
| tenant/subject 静态清单 | 71张 forced-RLS tenant table，32个 subject column |
| 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |

## 3. 明确未执行

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发发布、幂等竞态、重启恢复或浏览器测试；
测试文件仅定义未执行。未连接真实 PostgreSQL、CRM/Order/Ticket/Payment Provider、LiveKit、PSTN、真机、
生产 App、Beelink 或任何生产服务。

因此本批不证明 `AC-ENT-0026`、A2/H2/H3、企业试点或生产门禁通过。Agent 输出的 `toolRequest`
仍固定为 `null`；只读 Adapter、客户确认后可逆写 Adapter 和高风险接管流程分别属于
`ENT-CS-006/007/008`。恢复测试后需覆盖 schema 恶意输入、发布并发、未注册/draft/retired、
forced-RLS/跨租户、ticket/lease/route/generation 失效、同键异 hash、历史 execution 取消、高风险不落记录与
真实 Adapter 端到端证据。
