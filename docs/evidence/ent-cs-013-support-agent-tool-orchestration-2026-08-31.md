# ENT-CS-013 Support Agent 工具编排代码候选证据

日期：2026-08-31
任务：`ENT-CS-013`
状态：`in_progress`；功能代码候选已形成，测试和正式验收延后

## 主链实现

- Support Agent Provider 的 strict JSON schema 现允许 `toolRequest={toolName,arguments}` 或 `null`。
- 模型只接收当前 tenant active、服务端 Adapter 支持、最多32项且合计不超过64 KiB 的定义。
- tool proposal 必须 `spokenText=""`、`intent=answer`、`conversationState=answering`、无 risk signal；服务端按
  active revision 再次校验 schema 和 arguments，模型不直接调用 Adapter。
- 普通回答仍必须引用本轮 RAG citation；无 evidence 且无 active tool 时直接确定性转人工。

## 三类风险编排

- read：turn 派生稳定幂等键，复用既有 authorize/requested、15秒 claim lease、5秒 Adapter、二次
  run/session/customer/definition/request/result hash fence；只有 completed receipt/reference 才生成确定性话术。
  工具结果不再交给 LLM；simulated 结果在语音中明确披露。
- reversible write：只生成120秒确认挑战。结构化 arguments 不进入 execution/audit；Worker 内存保存
  execution/challenge/tool/arguments/expiry，客户可听的最小复述作为 Agent turn/context 按会话策略保留；下一客户
  turn 以 run/sequence/customer text hash/challenge/arguments/revision 绑定。确认 turn、execution decision、
  AES-GCM Outbox 和审计在同一 tenant transaction 提交；任一后段 CAS/Outbox fence 失败整体回滚。取消无 Outbox，
  含糊回复重述提示，过期/配置丢失转人工。
- high-risk：沿用不可执行 handoff request；authorize 原子推进 Agent run/support session，当前 prepared turn 只允许
  保存和播放 handoff 话术，不创建 execution、确认、Outbox 或 Provider 调用。
- 客服质检仅在 execution idempotency 精确绑定当前 turn，或 confirmationTurnId 精确绑定确认 turn 时，把确定性
  工具话术从 `answer_without_citation` 排除；普通无知识引用回答仍命中，tool execution 同时进入 source hash。

## Provider Adapter

- API 和 Enterprise Cell Worker 不再硬编码 unavailable；两者使用同一
  `createEnvironmentEnterpriseSupportToolAdapters`。
- `ENTERPRISE_SUPPORT_TOOL_HTTP_ENABLED=true` 时要求 base URL、至少16字节 token、Provider ID、tenant UUID
  allowlist；read/write 分别启用，write 还要求 Provider 声明幂等保证。
- production 只接受 HTTPS；非生产额外只允许 loopback HTTP。
- `/v1/read` 与 `/v1/write` 请求固定携带 schemaVersion、tenant、customer、execution、idempotency、tool、arguments。
  响应限制64 KiB并严格收敛为 completed/failed/retry。
- API/Worker fingerprint 绑定非秘密 endpoint/provider/tenant/capability 配置；漂移使 Outbox 保持 retry。
- 未配置或配置非法时明确 not_configured，不回退 mock。本文没有配置或调用真实 Provider。

## Voice Worker

- Worker 不加载工具 SDK或凭据，只把 API 返回的 pending confirmation 保存在内存并随下一客户 turn 回传。
- 相同 turn 响应丢失时 API 可重新生成并重放同一 write authorization/challenge；若安全恢复不了，不执行写操作。
- TTS 仍必须逐 turn 通过 run/ticket/generation authorize；handoff/end 播放后 Worker 退出，打断不写 delivered。

## 当前静态证据与边界

- `@translation/contracts` typecheck：通过。
- `@translation/api-server` typecheck：通过。
- `@translation/voice-agent-runtime` typecheck：通过。
- Orchestrator、HTTP Adapter、确认事务和 Voice Worker esbuild 静态转译：通过。
- 文件规模与 `git diff --check`：通过。
- 企业静态安全：2753 个文件、21 条规则，P0/P1/P2/P3 均为0。
- 按“功能优先、测试与验收延后”要求，未运行 unit/API/migration/forced-RLS/LLM/LiveKit/HTTP Provider/
  并发确认/响应丢失/崩溃恢复测试。

因此本文不是 `AC-ENT-0058`、A0、A2、H2、H3 或企业生产工具链通过证明；未收到真实 Provider receipt 时仍不得
向客户声明订单查询、工单、回拨、备注或任何高风险动作已成功。
