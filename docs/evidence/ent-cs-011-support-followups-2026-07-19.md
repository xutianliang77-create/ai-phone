# ENT-CS-011 工单与回拨实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 `0035_enterprise_support_followups`：forced-RLS `support_callbacks` 与
  `support_followup_commands` 使用 tenant-first 复合 FK，并把 command 与同 session/customer 的 case/callback、
  同 session/agent 的 active claim 绑定；同时提供状态 shape、同 session 幂等键/hash、受控 mutation trigger
  和 deferred Outbox FK。当前企业 migration 清单增至35段。
- 新增人工坐席 ticket/callback API。HTTP 要求 `support:takeover`、有效签名 route 和 membership；runtime
  再锁定 `human_active` session 与 active claim，只允许 assigned agent 或同 tenant owner/admin/
  support_manager，并复核 session/claim expected version。请求体不能指定 tenant/customer/agent。
- 工单先建立 pending case，回拨先建立 `dispatch_pending` callback；command/case/callback/outbox ID 由
  tenant/session/kind/idempotency key 确定性生成。同键同请求重放原记录，同键异请求冲突，并发唯一键竞争
  不留下随机孤儿业务行。
- API 在落库前同时检查 AES-GCM keyring 和严格 Adapter readiness。未配置时不创建 case/callback/command/
  Outbox/审计；显式 simulated Adapter 写入记录并在 API/Web 持续标记，不能作为真实外部效果证据。
- ready 路径把本地业务记录、followup command、`support.followup.requested` 密文 Outbox 和不含主题/说明/
  原因的审计原子提交，只返回 `processing`，不把本地 ID 冒充外部成功。
- Cell Worker 复用 CS-007 的 tenant-bound Ticket/Callback Adapter、Provider 幂等保证、fingerprint/simulated
  fence 和严格 receipt。超时、未知网络结果、配置变化或非法 receipt 递增 attempt 并用同一 Provider 幂等键
  指数退避重试；不写 external ID 或确定失败。
- 确定完成在一个 tenant transaction 中写 external ticket/callback ID、收敛 case/callback/command、发布
  Outbox 并追加审计。带 reference 的确定失败进入 failed；finalize 不要求 session 仍活动，因此坐席释放或
  结束会话不等待外部系统。
- Enterprise Web 右栏复用既有 `confirmation_number/phone_callback` Material Icons、企业 token、圆角和
  浅深色组件。服务端 controls not_ready 时按钮禁用并显示 reason；ready 时展开工单/回拨表单。页面分别
  显示本地 case/callback 和 processing/completed/failed command，模拟 Adapter 使用明确警示。

## 2. 安全与状态边界

| 场景 | 代码候选行为 |
| --- | --- |
| assigned support_agent | active claim、有效 lease、双 expected version 命中后可提交 |
| owner/admin/support_manager | 只可管理同 tenant 已接管会话 |
| 其他角色、跨 tenant ID | scope、tenant transaction、forced RLS 或复合 FK 拒绝 |
| body 伪造 tenant/customer/agent | schema 不接受这些字段；身份全部由 TenantContext/session/claim 导出 |
| Provider/keyring 未配置 | 503 not_ready/not_configured；业务行、Outbox、审计均不增加 |
| 同幂等键同请求 | 返回同一 followup，不产生第二个业务对象或外部效果 |
| 同幂等键异请求/旧 version | 409；事务不提交局部状态 |
| 外部超时/未知结果 | 同 Provider 幂等键自动重试，保持 processing |
| 非法密文、fingerprint 或 receipt | 失败闭合为 retry，不写 external ID |
| 确定成功 | receipt/result hash/reference 匹配后才推进本地业务状态 |
| 确定失败 | command/callback 标记 failed；工单 case 保留 pending 供人工处理 |
| 提交后释放/结束会话 | 已接受 Outbox 独立恢复；会话不等待 Provider |
| simulated Adapter | UI/API 明示协议验证，不声称真实工单或回拨 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| API Server TypeScript typecheck | 通过 |
| Enterprise Web TypeScript 与 E2E config typecheck | 通过 |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 450388 B，JS 919649 B，CSS 62041 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；35段，末段 `0035_enterprise_support_followups` |
| `0035` loader checksum | `0e1e26849e958157a9dc0f9d8d2636bf7457495d5db200d70636fb9f51bedd7c` |
| schema 静态清单 | 当前公共31段 + enterprise 35段；预期109张业务表 |
| tenant/subject 静态清单 | 75张 forced-RLS tenant table、36个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 需要已提交且 clean 的 release commit，并要求构建时嵌入正式 version/
commit；本批 feature diff 阶段未满足该发布身份条件。无 release metadata 的 bundle 内容/大小/敏感串静态扫描
已通过，不能据此宣称正式发布包已放行。

## 4. 已定义但未运行的验收

`AC-ENT-0032` 已定义访问/绑定、幂等/事务、readiness、Worker 崩溃恢复、业务投影和 UI/生命周期六组矩阵。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Worker、Provider sandbox、
故障注入、Playwright、浏览器、Flutter 或任何真实数据库/Provider/LiveKit/设备测试。未连接真实 PostgreSQL、
CRM/Ticket/Callback Provider、PSTN、生产 App、Beelink 或生产服务。

因此本批不证明 `AC-ENT-0032`、A0/A2/H2/H3、真实外部工单/回拨、崩溃恢复、企业试点或生产门禁通过。
`ENT-CS-011` 保持 `in_progress`；下一项可进入 `ENT-CS-012` 质检分析，但正式验收仍须回补本任务矩阵。
