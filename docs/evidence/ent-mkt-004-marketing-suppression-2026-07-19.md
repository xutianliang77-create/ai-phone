# ENT-MKT-004 禁拨名单实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 Marketing Suppression 契约：tenant/global scope、四类公开来源、全局注册表 readiness、不可变 DTO、
  创建/列表/资格响应和服务端取消任务数。
- 新增 `0040_enterprise_marketing_suppressions`，扩展既有 forced-RLS `suppression_entries`，增加 Campaign/Lead、
  来源标识、actor、版本、幂等 hash 和取消数量；新记录使用 tenant-first 复合 FK，已有业务证据时 down migration
  拒绝静默丢失。
- 数据库禁止 Suppression 更新和删除。tenant scope 必须来自当前 active Campaign Lead 与 account actor；global
  scope 只接受 namespaced system actor 和固定 `global_registry` 来源，普通租户 API 没有 global 写入口。
- Suppression INSERT 与 call-task INSERT/reschedule 使用相同的 `tenant + phone_hash` advisory transaction lock。
  首次禁拨在同一事务取消相同号码跨活动的 pending/scheduled/retry；后续 task SQL 命中 tenant/global 直接拒绝。
- 新增 tenant-scoped PostgreSQL Repository/runtime/API。号码和 HMAC 不从请求体接收，只从当前 Lead 解析；写入
  要求 `campaign:write`、签名 route、幂等键和严格原因/来源，读取要求 `campaign:read`。
- 新增全局注册表 Adapter contract 和默认 unavailable 实现。当前没有配置真实全局禁拨 Provider，本地记录未命中
  时 eligibility 明确 `not_ready/global_suppression_registry_not_configured`，不伪造全局核验成功。
- Enterprise Web 在既有授权详情内复用 Material Icons `block/public`、浅深色 token、8px 圆角、StatusPanel 和
  响应式规则，展示真实 readiness、tenant/global 不可变历史、脱敏号码与服务端取消数量。

## 2. API 与执行边界

```text
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppressions
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/suppression-eligibility
POST /enterprise/v1/suppression
```

公开 POST 固定 `scope=tenant`，只允许 `manual|contact_request|consent_withdrawal|complaint`。global 只在 schema/
trigger 中预留受信 system projection 边界；本批没有全局同步 Provider 或公开/内部同步路由。SQLite/JSON/legacy
runtime 返回 `enterprise_postgres_required`，不会回退本地列表或客户端判断。

本批取消的是尚未 dispatch 的数据库任务。`ENT-MKT-005..009` 尚未实现 Country Policy、审批快照、Scheduler
generation、PSTN dispatch/cancel 或已开始媒体的物理停止，界面和 API 不声明这些动作成功。

## 3. 安全与竞态不变量

| 场景 | 代码候选行为 |
| --- | --- |
| campaign:read | 可读取当前 tenant、Campaign、Lead 的脱敏禁拨历史和 readiness |
| campaign:write | 可为 active Campaign Lead 创建 tenant scope；号码/scope actor/取消数不可伪造 |
| auditor/无写 scope | Web 只读；直接 POST 由服务端 scope guard 拒绝 |
| body tenant、跨 Campaign/Lead、失效 route | 一致性、membership、route、tenant SQL 与 forced RLS 失败闭合 |
| public 请求 global/global_registry | 严格 body contract 拒绝；数据库仍要求 system actor |
| 同键同 request hash | 重放原记录；异 hash 冲突 |
| 同 phone/scope 已存在 | 返回已有不可变记录，不重复取消或写入 |
| task 先取得号码锁 | suppression 等待后取消待任务 |
| suppression 先取得号码锁 | task 等待后命中 SQL guard 并拒绝 |
| 其他号码、终态任务 | 不取消，不修改 |
| 全局注册表未配置/降级 | 未命中本地记录也返回 not_ready，不显示 eligible |
| legacy/SQLite/JSON | 503，不读取 fixture 或本地 fallback |

## 4. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 498926 B，JS 968187 B，CSS 79151 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；40段，末段 `0040_enterprise_marketing_suppressions` |
| `0040` loader checksum | `1d742e880ad59d7dc97d9687a077bedab47c9389dc071b29a68f5d4d9aa5302c` |
| tenant/subject 静态清单 | 81张 forced-RLS tenant table、44个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 要求 clean、已提交 release commit 和正式 metadata；feature diff 阶段不运行
该发布身份门禁。静态 build/bundle 通过也不等于正式 Web 发布包或企业生产放行。

## 5. 已定义但未运行的验收

`AC-ENT-0037` 已定义角色/租户、scope/source、号码保护、幂等、schema/forced-RLS、同号码竞态、跨活动取消和
Web/全局 readiness 八组矩阵；领域测试定义 DTO 脱敏与 creation hash 绑定，migration/admin 清单测试已更新到
`0040`/40段。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、
Flutter 或任何真实 PostgreSQL/全局名单 Provider/LiveKit/设备测试；未连接 CRM/PSTN，未创建 Country Policy、
审批快照、Scheduler、Outbox、usage hold 或真实拨号，也未操作生产 App、个人版生产代码/WIP、Beelink 或生产服务。

因此本批不证明 `AC-ENT-0037`、A0/A3/H2/H3、真实外呼或企业生产门禁通过。`ENT-MKT-004` 保持
`in_progress`，下一任务为 `ENT-MKT-005 Country Policy`。
