# ENT-CS-008 高风险人工接管实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- high-risk 工具继续固定为 `support:takeover + human_handoff`；退款、付款、身份验证分别归类为
  `refund/payment/identity`，其余 high-risk 为 `other_high_risk`，安全行为完全相同。
- `/internal/enterprise/support-tools/authorize` 重验内部凭据、签名 Worker ticket、lease、binding、
  policy、route epoch、generation、run、session、customer、active definition 和封闭参数 schema。
- `riskEvidenceHash` 绑定策略版本、风险/scope/确认模式、类别、definition ID、tool name、revision 和
  arguments hash；`requestHash` 再绑定 run/session/customer。原始参数、客户话语、支付或身份材料不入库。
- 新增 `support_high_risk_handoff_requests`，只保存 tenant/run/session/customer/definition revision、
  参数/风险/请求 hash、类别、策略版本、幂等键和时间；不存在可执行 payload、Provider reference 或成功状态。
- 首次请求、Agent run `active -> handoff_requested` 和 support session
  `ai_active -> handoff_requested` 位于同一 tenant transaction；任一 fence 失败整体回滚。
- 相同幂等键且所有绑定/hash 相同只返回原 request；相同键的参数、revision、run/session/customer 或证据
  变化返回冲突。接管状态下只允许 `handoff` turn 获得新的 TTS authorize。
- 数据库 insert trigger 要求 session/run/definition 同时 active、run 属于 session 且 definition 为
  human_handoff；mutation trigger 拒绝 UPDATE/DELETE，forced RLS 隔离 tenant。
- `0033` down migration 只允许空请求表回退；已有接管证据时失败闭合，不静默丢弃安全记录。
- 既有 Tool Registry trigger 继续拒绝 high-risk `tool_executions`。本批不创建 execution、确认挑战、
  Outbox 或 Provider 调用，也不表示已经有人工坐席接通；queue/claim 属于 `ENT-CS-009`。

## 2. 安全、幂等与不可执行矩阵

| 场景 | 代码候选行为 |
| --- | --- |
| 非 active definition 或 risk/scope/confirmation 错配 | 失败闭合，不创建 request |
| ticket/lease/binding/policy/route/generation/run 失配 | 失败闭合 |
| run/session/customer 不一致或非 active/ai_active | 首次请求拒绝；精确既有请求可稳定重放 |
| refund/payment/identity/其他 high-risk | 仅分类并创建同形状不可执行 request |
| 同键同证据重复提交 | 返回同一 request ID，不重复迁移状态 |
| 同键异参数/revision/绑定/证据 | `idempotency_conflict` |
| run 或 session CAS 丢失 | 抛错并回滚 request 与全部状态变化 |
| 直接插入失活/跨绑定记录 | DB insert trigger/FK/RLS 拒绝 |
| UPDATE/DELETE handoff request | DB mutation trigger 拒绝 |
| 创建 high-risk execution/Outbox/Provider 调用 | Tool Registry guard/运行时边界拒绝，数量应为0 |
| 接管后授权普通 generated/degraded TTS | 拒绝；只允许 handoff turn |
| 坐席尚未 queue/claim | 只报告 handoff_requested，不报告已接通或业务已处理 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript typecheck / build | 通过 |
| API Server TypeScript typecheck / build | 通过 |
| migration loader | 通过；33段，末段 `0033_enterprise_support_high_risk_handoffs` |
| `0033` loader checksum | `fe1091c27375da82e7dead311d4e72e022f8cc305678790c1a5d8242cc0ff49b` |
| schema manifest | 当前公共31段 + enterprise 33段，预期106张业务表 |
| tenant/subject 静态清单 | 72张 forced-RLS tenant table、32个 subject column |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |

## 4. 明确未执行

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、TTS/Worker、浏览器、
Flutter 或任何真实数据库/Provider 测试；测试文件仅定义未执行。未连接真实 PostgreSQL、Ticket/CRM/
Payment/Identity Provider、LiveKit、PSTN、真机、生产 App、Beelink 或任何生产服务。

因此本批不证明 `AC-ENT-0029`、A0/A2/H2/H3、坐席可用、企业试点或生产门禁通过。恢复测试后必须执行
`0033` up/down/forward、forced-RLS 双租户、绑定伪造、同键/异键并发、事务 CAS 回滚、直接 SQL
insert/update/delete、execution/Outbox 数量为0、数据库/审计明文扫描、旧 TTS 竞态、handoff 话术和
`ENT-CS-009` 真实 queue/claim/接通矩阵。
