# ENT-CS-010 坐席工作台实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 `POST/GET /enterprise/v1/support/sessions/:sessionId/workbench`。入口要求
  `support:takeover`、签名 tenant route、有效 membership、`human_active` session、匹配的 active claim、
  未过期 lease，以及 assigned agent 或同 tenant owner/admin/support_manager。
- 新 claim 先按 Worker 一致的 run→session 锁序取得最新 Support Agent run，再在同一 tenant Unit of Work
  完成 claim/session 激活、Agent run `cancelled` 和审计。刷新旧 claim 时 activate API 补建同一栅栏。
- ready 工作台只接受 `cancelled`、`completed/failed` 或没有 Agent run。旧 Worker ticket/generation 后续
  prepare、TTS authorize 和 deliver 继续由现有 run fence 拒绝；当前没有 LiveKit 已播音频 interrupt/ack。
- 新增只读工作台聚合：Support session/customer/channel/queue/case/tool execution、Agent 有界上下文与输出、
  high-risk handoff，以及 tenant-scoped `transcript_segments` 每段最终 revision。字幕稳定排序后最多返回200段。
- 公共通讯读取继续经过单表白名单、显式 `scope_type/scope_id`、forced RLS 和返回 scope 二次校验。HTTP
  不返回 phone/request/idempotency/dispatch secret；客户 attributes 的 phone/email/address/identity/credential/
  token/secret/password 类字段默认遮罩。
- claim renew 改为 `now + queue.claimLeaseSeconds`，避免频繁心跳从旧到期时间叠加。Web 按剩余租期一半
  自动续租，最长60秒检查；字幕2.5秒只读轮询不会续租，乱序快照不会覆盖更高 claim version。
- Enterprise Web `/support` 已从占位页替换为同企业壳风格的三栏坐席台：等待队列/SLA、原文译文/接管状态、
  客户/知识/风险/历史。1250/850/600px 分级收敛，复用 Material Icons 和浅深色 token。
- 静音、转组、结束通话、创建工单和回呼在安全 Provider/API 未实现时固定 disabled，并显示
  `not_ready` 原因；不调用 CRM、Ticket、LiveKit 管理接口或生成假成功。

## 2. 角色、状态与数据边界

| 场景 | 代码候选行为 |
| --- | --- |
| assigned support_agent 打开 | 有效 active claim + 未过期 lease 后可 activate/read |
| owner/admin/support_manager 打开 | 只可在同 tenant 覆盖读取/恢复，不跨 tenant |
| 其他角色、跨 tenant ID | scope、tenant session、forced RLS 或 runtime 拒绝 |
| run active/handoff_requested/ending | activate 原子取消；未成功取消不返回 ready |
| run cancelled/completed/failed/no run | 分别返回 stopped/terminal/not_started fence |
| claim 过期、释放或不匹配 | 409；Web 停止工作台控制 |
| 字幕多 revision | 仅返回每个 segment 最新 revision；按时间稳定排序 |
| 无字幕 | 可显示已有 Agent 接管上下文，并明确标记“非实时字幕” |
| 无 Agent 维度 | 知识检索禁用，不猜测 locale/country/product |
| Provider/API 未配置 | 媒体、工单、回呼按钮 disabled + reason code |
| 已开始播放的音频 | 本批没有 interrupt/ack 证据，不声称300ms物理停播 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| API Server TypeScript typecheck | 通过 |
| Enterprise Web TypeScript 与 E2E config typecheck | 通过 |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 445461 B，JS 914722 B，CSS 61226 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；仍为34段，末段 `0034_enterprise_support_agent_queue` |
| `0034` loader checksum | `131f6749915bb971ea3240b20afe8845ed5676fc8fdcc569400edcf6ce6d1dce` |
| `git diff --check` | 通过 |

## 4. 已定义但未运行的验收

`AC-ENT-0031` 已定义六组矩阵：访问/RBAC与跨租户、claim/session/run/audit 原子性、旧 Worker/TTS、字幕/
客户/工具/风险投影最小化、lease/乱序/断网，以及 Web 响应式/键盘/axe/真实 LiveKit 300ms停播。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Worker、TTS、Playwright、
浏览器、Flutter 或任何真实数据库/Provider/LiveKit/设备测试。未连接真实 PostgreSQL、CRM、Ticket、PSTN、
生产 App、Beelink 或生产服务。

因此本批不证明 `AC-ENT-0031`、A0/A2/H2/H3、两个坐席竞态、旧音频300ms停止、真实人工已接通、企业试点
或生产门禁通过。`ENT-CS-010` 保持 `in_progress`；`ENT-CS-011` 工单和回呼仍为下一独立任务。
