# ENT-MKT-011 真实人工接管实现与静态门禁证据

日期：2026-07-20
分支：`codex/enterprise-edition`
状态：`in_progress`
验收项：`AC-ENT-0044` 未通过

## 1. 本次交付

- 新增 enterprise migration `0047_enterprise_marketing_handoff`，建立 forced-RLS
  `marketing_handoff_policies` 和 `marketing_handoffs`。策略只能在活动
  `draft + not_submitted` 阶段编辑，只允许引用当前 tenant 的 active Support Queue
  和 active PSTN Support Channel。
- Campaign 校验快照的 `snapshotHash` 包含 handoff policy 和 queue/channel 状态；
  `0047` 在 validating、approved 和 scheduled 转换重验当前资源，缺失或失活失败闭合。
- Marketing handoff turn 只在 TTS `delivered` 后物化。Marketing run 保留
  `handoff_requested` AI 数据库停播 fence，并在同一 tenant Unit of Work 中创建
  Support Customer、`created -> waiting -> handoff_requested` Support Session 和 bridge。
- 坐席仍复用现有 Support Queue 与 `support_agent_claims`。bridge 不保存 claim ID，
  不创建第二套领取真值；claim/lease/release/reassign 继续由 `ENT-CS-009` 栅栏约束。
- Support workbench 先复核 active claim、`human_active` session、Marketing run 当前状态和
  AI fence，再使用稳定幂等键调用事务外 HTTPS Provider。数据库 fence 与
  Provider 媒体证据独立显示。
- Provider 只在 HTTPS URL、密钥、幂等保证、operator join 保证和
  `AI_STOP_GUARANTEE_MS=300` 全部就绪时为 ready。HTTP 请求300ms abort；只接受
  `stopLatencyMs<=300`、请求后300ms内的 AI 物理停音时间、不早于停音的坐席加入时间和
  receipt ID。停音/加入时间、Provider fingerprint 和 receipt hash 持久化后才标记 media active。
- Provider 未配置/未就绪时，Marketing Agent 明确说明无法完成转接并结束 AI 通话；
  不留下无 bridge 的虚假 `handoff_requested`。Provider 在请求后失效时仍保留真实 not_ready/failed 证据。
- 超时 Worker 只处理已过期、无 active claim 的 bridge，终结 shadow Support Session 并写
  `timed_out` 或 `callback_required`。审计固定 `physicalProviderAction=not_verified`；
  `callback_required` 不是回拨已排程/已接通，状态收敛也不代表实体挂断。
- Enterprise Web 复用现有 token、Material Icons、`StatusPanel`、1px outline 和8px圆角；
  Campaign 增加策略/readiness 面板，Marketing Monitor 显示 bridge 证据，Support Workbench
  区分坐席租约、AI fence 与 media status。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 全工作区 `npm run typecheck` | 通过；Enterprise Web、contracts、API Server、PSTN Bridge、Realtime Gateway、Worker 等工作区均为0错误 |
| `npm run typecheck:e2e -w @translation/enterprise-web` | 通过 |
| 全工作区 `npm run build` | 通过；Enterprise Web 生产构建与 API migration copy 成功 |
| `npm run check:lines` | 通过 |
| Enterprise Web bundle 静态检查 | 通过；13 files，entry JS 524262 B，全部 JS 1019461 B，CSS 90231 B |
| migration loader | 通过；47段，末段 `0047_enterprise_marketing_handoff`，checksum `655b387ece4a21e8f60cbc909583d2a28b3a4653c1309968836164d5039a40b7` |
| `git diff --check` | 通过 |

## 3. 未执行与证据边界

- 本轮按既定静态边界没有运行 Vitest、API/Repository 自动化、migration up/down/forward、
  普通角色 forced-RLS、双租户、并发 claim/timeout/recovery 矩阵或浏览器测试。
- Provider 测试定义已覆盖未配置、完整300ms回执和超时回执，但本轮未执行，不是通过证据。
- 没有启动真实 PostgreSQL、PSTN/LiveKit/Marketing Provider、Support Agent Worker 或真实坐席媒体；
  没有执行300ms物理停音、坐席加入、挂断、回拨或重启恢复验收。
- 本次不构建/安装/覆盖原生产 App，不操作 Beelink、服务或真机。
- SQLite/JSON 仍只是本地开发/封闭演示边界，不构成 PostgreSQL 企业试点门禁。

因此 `ENT-MKT-011` 保持 `in_progress`，`AC-ENT-0044` 未通过。下一项为
`ENT-MKT-012` Outcome；正式验收时先执行 `0047` 空库/增量/down/forward、forced-RLS/双租户和
角色×操作×状态矩阵，再接入真实 PSTN/Support Provider 验证300ms停音和坐席加入回执。
