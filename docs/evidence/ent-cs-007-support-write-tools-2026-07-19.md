# ENT-CS-007 可逆写 Tool Adapter 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 固定 `ticket.create`、`callback.schedule`、`note.add` 三个可逆写工具，输入和 Provider 结果均使用
  精确字段、长度、标识和 ISO 时间校验；回拨时间在挑战和确认时均必须仍处于未来。
- 新增内部 prepare/confirm 入口，复用签名 `voice_agent_runtime` Worker ticket、cell/worker/lease、
  binding/policy/route/generation/run/session/customer、active definition、schema/arguments/request hash fence。
- 确认挑战有效期120秒，绑定 active run、挑战时 `lastTurnSequence`、挑战后新客户 turn、原始客户文本
  SHA-256 和同一 support session。只接受封闭的确认/拒绝短语；含糊、过期、旧 turn 或跨 run/session
  回复不执行。
- 未确认前不创建 Outbox。确认事务以 execution version CAS 写 confirmation evidence、Provider
  fingerprint/simulated 与唯一 outbox ID，并插入 `support.tool.write.requested`；拒绝只进入 rejected。
- 原始写参数使用 AES-256-GCM 密封，AAD 绑定 tenant/execution/customer/tool/idempotency；数据库和
  审计不保存明文参数或结果正文，只保存 hash、Provider evidence、safe reason 和 receipt reference。
- Cell Worker 复用 forced-RLS pending-work/claim/recovery，专用 Publisher 要求 Adapter 声明
  `idempotencyGuaranteed=true`。超时、异常、fingerprint/key 变化和无效 receipt 均使用同一 Provider
  幂等键重试；只有严格完成 receipt 或带 reference 的确定失败才原子终结 execution/outbox/audit。
- `0032_enterprise_support_write_tools` 为 `tool_executions` 增加 challenge/run/turn/time/outbox 字段，
  通过 CHECK、复合 FK、deferred Outbox FK、唯一约束和 mutation trigger 固定状态形状、attempt 递增与
  终态不可变。已有外部写证据时 down migration 失败闭合，不伪造安全回滚。
- 生产 API/Worker 默认 Adapter 均 unavailable，不生成假工单、回拨或备注。tenant-bound mock 固定
  `simulated=true`，相同 Provider 幂等键多次调用仍只有一次有效效果。
- Support Agent 六字段输出没有扩大，`toolRequest` 仍固定为 `null`；模型到确认入口的自动编排未开放。

## 2. 权限、确认与副作用矩阵

| 场景 | 代码候选行为 |
| --- | --- |
| 未注册、非 reversible_write、错误 scope/confirmation mode | 不创建挑战，不入 Outbox |
| ticket/lease/binding/policy/route/generation/run 失配 | 失败闭合 |
| execution/session/customer/arguments/request hash 失配 | 失败闭合，不调用 Adapter |
| 未确认、含糊回复、过期挑战、挑战前或其他 run 的 turn | 保持 awaiting 或拒绝，不入 Outbox |
| 客户明确拒绝 | 写不可变 rejected 证据，Outbox 数为0 |
| 回拨时间已过 | 挑战或确认阶段拒绝，不入 Outbox |
| Adapter/keyring 未配置 | 明确 not_configured，不伪造成功 |
| 同 challenge 并发/重复确认 | 行锁和 version CAS 只产生一个 Outbox；精确重放返回原 event |
| Worker 超时、异常或网络结果未知 | 同 Provider 幂等键退避重试，不写确定失败 |
| Provider fingerprint/simulated 变化 | fence 拒绝调用，等待配置恢复 |
| receipt 非法或 callback 时间被改写 | 重试，不写 completed |
| Provider 明确完成/确定失败 | execution attempt、终态、Outbox published 和 audit 同事务收敛 |
| 数据库密文、AAD、result hash 或确认关联被篡改 | 解密/shape/finalize 失败闭合 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript typecheck / build | 通过 |
| API Server TypeScript typecheck / build | 通过 |
| migration loader | 通过；32段，末段 `0032_enterprise_support_write_tools` |
| `0032` loader checksum | `a26f912abf75b466d8872388fb59bff290162191e959c5e8a1cd74566b782b9d` |
| schema manifest | 当前公共31段 + enterprise 32段，预期105张业务表 |
| tenant/subject 静态清单 | 表结构未新增；仍为71张 forced-RLS tenant table、32个 subject column |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |

## 4. 明确未执行

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发确认/重放、Worker 崩溃窗口、
key rotation、浏览器、Flutter 或任何真实数据库/Provider 测试；测试文件仅定义未执行。未连接真实
PostgreSQL、Ticket/CRM/Callback Provider、LiveKit、PSTN、真机、生产 App、Beelink 或任何生产服务。

因此本批不证明 `AC-ENT-0028`、A0/A2/H2/H3、企业试点或生产门禁通过。mock 只证明协议候选与单进程
幂等效果形状，不能替代 Provider 端幂等或断网未知结果证据。恢复测试后必须执行 `0032` up/down/
forward、forced-RLS 双租户、确认 turn 攻击、并发双确认、Outbox 原子/崩溃恢复、密文/AAD/hash 篡改、
fingerprint 与 key rotation、Adapter timeout/abort/未知结果、真实 Provider sandbox 幂等及审计明文扫描。
