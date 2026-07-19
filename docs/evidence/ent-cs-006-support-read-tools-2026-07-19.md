# ENT-CS-006 只读 Tool Adapter 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 `order.lookup`、`logistics.lookup`、`inventory.lookup` 三个只读工具的严格 Adapter contract。
  结果使用 found/not-found 封闭 union；额外字段、非法标识/状态/时间/数量和超长 Provider reference
  全部失败闭合。
- 生产 PostgreSQL runtime 默认注册 unavailable Adapter，readiness 返回 `not_configured`，不会伪造
  ERP、物流或库存成功。确定性 mock 只能显式注入，绑定单一 tenant，并固定返回 `simulated=true`。
- 订单和物流以当前 support session 的 `customerId + identifier` 查询；其他客户的相同标识与不存在
  返回一致。库存只在 Adapter 的 tenant 绑定内查询，请求不能提交 tenant/customer/session 覆盖。
- 新增内部 `POST /internal/enterprise/support-tools/execute-read`。入口要求内部 Bearer 凭据和签名
  Worker ticket，并复核 worker cell、worker、run、execution、support session、customer、active tool
  revision、schema 和 arguments hash。
- 执行采用 claim -> 事务外 Adapter -> fenced finalize：claim 写入15秒随机 lease、递增 attempt、
  Provider fingerprint 和 simulated 标志；Adapter 最长5秒并接收 AbortSignal；finalize 重新建立
  forced-RLS tenant transaction，重验 ticket/run/session/customer/definition/version/lease。
- 新增 `0031_enterprise_support_read_tools` up/down migration，为 `tool_executions` 增加 attempt、lease、
  Provider 证据、有界结果 JSON/SHA-256 和失败码。CHECK/trigger 拒绝 attempt 跳跃、租约旁路改写、
  时间倒退、过期完成、迟到 lease、结果字段越迁移和终态改写。
- Repository 的 complete/fail CAS 同时要求当前 version、running 状态、精确 lease ID 和未过期 lease。
  成功还必须包含有界 Adapter receipt/reference；已完成记录只允许同 execution/同参数回放，回放
  重新做严格结果校验并重算 SHA-256，不直接信任 PostgreSQL JSON。
- 审计只保存 tool name、decision、safe reason、Provider fingerprint、simulated 和 result hash，
  不保存原始参数或结果正文。Agent 的六字段输出未扩大，`toolRequest` 仍固定为 `null`。

## 2. 权限与竞态矩阵

| 场景 | 代码候选行为 |
| --- | --- |
| 未注册、非 read、错误 scope 或非白名单工具 | 不 claim，不调用 Adapter |
| ticket/lease/binding/policy/route/generation/run 失配 | 失败闭合，不调用或不 finalize |
| session 非 `ai_active` 或 execution/customer 不一致 | 失败闭合 |
| order/logistics 属于其他 customer | 返回与不存在相同的 `found=false` |
| inventory 请求其他 tenant | readiness `not_configured`，runtime 不调用 Adapter |
| Adapter 未配置、抛错、超时或输出非法 | 明确 not_configured/failed，不写 completed |
| 同 execution 并发执行 | version + lease CAS 只允许一个有效 claim；活动 lease 返回 in_progress |
| lease 过期后重领 | attempt 只递增1并更换 lease；旧执行结果不能完成 |
| definition 在 Adapter 调用期间退役 | finalize 写 failed，不写 completed |
| completed 回放被篡改或 hash 不一致 | 失败闭合，不返回业务结果 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript typecheck / build | 通过 |
| API Server TypeScript typecheck / build | 通过 |
| migration loader | 通过；31段，末段 `0031_enterprise_support_read_tools` |
| `0031` loader checksum | `483602a4853d4f387c757d6b99fef3b52a484b08c132c208d2eec221b91c4955` |
| schema manifest | 当前公共31段 + enterprise 31段，预期105张业务表 |
| tenant/subject 静态清单 | 表结构未新增；仍为71张 forced-RLS tenant table、32个 subject column |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |

## 4. 明确未执行

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发 claim/reclaim、超时、
崩溃恢复或浏览器测试；测试文件仅定义未执行。未连接真实 PostgreSQL、ERP/Order/Logistics/Inventory
Provider、LiveKit、PSTN、真机、生产 App、Beelink 或任何生产服务。

因此本批不证明 `AC-ENT-0027`、A0/A2/H2/H3、企业试点或生产门禁通过。mock 只证明协议候选和
客户归属过滤的代码形状，不能作为真实外部结果证据。恢复测试后还需执行 migration up/down/forward、
forced-RLS 双租户、恶意 schema/output、并发 claim/reclaim、过期和迟到 lease、Adapter timeout/abort、
definition 退役竞态、进程重启恢复、结果 hash 篡改以及真实 Provider 端到端矩阵。
