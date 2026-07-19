# ENT-MKT-001 Campaign 聚合实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 Campaign DTO：聚合状态、审批状态、时区计划、创建/更新请求和列表/详情响应。
- 新增 `0037_enterprise_marketing_campaigns`，在既有 `marketing_campaigns` 上增加 tenant 内唯一创建键和
  请求 SHA-256、owner/member 复合外键、字段约束及 mutation trigger。新记录只能由当前 tenant actor 创建为
  `draft/not_submitted`；聚合身份、创建时间和幂等证据不可改写，更新必须递增 version 和 updatedAt。
- 新增 tenant-scoped PostgreSQL Repository、Unit of Work runtime 和脱敏审计。创建同键同 hash 返回原活动，
  同键异 hash 冲突；草稿更新使用 expectedVersion，只允许 `draft/not_submitted`。草稿更新和待调度命令以
  tenant/actor/route/key 事务锁及 forced-RLS `idempotency_keys` 保存 request hash、资源和结果版本。
- 新增 `GET/POST /enterprise/v1/campaigns`、`GET/PATCH /enterprise/v1/campaigns/:campaignId` 和
  `POST /enterprise/v1/campaigns/:campaignId/schedule`。API 不信任 body tenant/owner/role/status/approval，
  统一复核 membership、scope 和签名 route document；legacy/SQLite 明确返回 PostgreSQL required。
- 聚合 schedule 要求 `campaign:approve`，并在行锁中复核 expectedVersion、`status=approved`、
  `approvalStatus=approved`、policyVersion 和未来 startAt；数据库 trigger 再阻断非法状态边。
- Enterprise Web 复用现有企业壳、Material Icons 注册表、浅深色 token、8px 圆角、统一状态和响应式规则，
  提供真实草稿创建/编辑、活动列表、审批状态和 scope-aware 控件；不注入示例活动。

## 2. 安全、不变量和功能边界

| 场景 | 代码候选行为 |
| --- | --- |
| owner/admin/marketing_manager | 可读写；具有 `campaign:approve` 时才显示并调用聚合 schedule |
| marketing_member | 可读写草稿，不能推进聚合到 scheduled |
| auditor | 只读，不显示创建、编辑或待调度入口 |
| 其他角色 | 导航不发现；直接 API 仍由服务端 scope guard 拒绝 |
| body 伪造 tenant/owner/status/approval | tenant 不一致返回冲突；其余字段不在请求契约中，严格解析拒绝 |
| 同创建键同/异内容 | 同 SHA-256 精确重放；异内容 409，不重复创建或审计 |
| PATCH/schedule 响应丢失后重试 | Web 保留原幂等键；同 hash 且仍为原结果版本返回 replayed，不重复变更或审计 |
| PATCH/schedule 同键异请求 | 409 idempotency conflict，聚合保持不变 |
| 旧 expectedVersion/非草稿更新 | 409 conflict/not_editable，不提供强制覆盖 |
| 未审批/状态错误/缺策略/缺或过期时间 | schedule 409 并写 denied 审计；状态保持不变 |
| schedule 成功 | 只迁移 Campaign 聚合到 scheduled；call task、hold、Outbox、Provider 调用均为0 |
| SQLite/JSON runtime | `enterprise_postgres_required`，不回退演示数据 |

线索导入、授权证据、禁拨名单、Country Policy、审批快照、Scheduler claim、PSTN dispatch、Marketing Agent、
人工接管、Outcome/CRM 和活动分析分别属于 `ENT-MKT-002..014`。本任务不提前实现或宣称这些能力。

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 473219 B，JS 942480 B，CSS 68662 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；37段，末段 `0037_enterprise_marketing_campaigns` |
| `0037` loader checksum | `feec74afc93bf1c779d71e7843e686b75cc39c747e1ebe39da7396b88772374a` |
| schema 静态清单 | 当前公共31段 + enterprise 37段；预期仍为112张业务表 |
| tenant/subject 静态清单 | 78张 forced-RLS tenant table、38个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 要求 clean、已提交 release commit 和正式 metadata；feature diff 阶段未运行
该发布身份门禁。当前 bundle 内容/大小/fixture 静态扫描通过，不等于正式 Web 发布包放行。

## 4. 已定义但未运行的验收

`AC-ENT-0034` 已定义 RBAC、双租户/route、幂等/CAS、schema/forced-RLS、逐项 schedule 阻断和 UI 六组矩阵；
领域测试同时定义未审批、状态、策略、开始时间以及创建/变更规范化 request hash 的确定性用例。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、
Flutter 或任何真实 PostgreSQL/Provider/LiveKit/设备测试；未创建 lead/task、未连接 Scheduler/PSTN/CRM，未操作
生产 App、个人版生产代码/WIP、Beelink 或生产服务；企业提交推送后仅按交接要求追加个人版 `PROGRESS_LOG.md`。

因此本批不证明 `AC-ENT-0034`、A0/A3/H2/H3、真实外呼或企业生产门禁通过。`ENT-MKT-001` 保持
`in_progress`。
