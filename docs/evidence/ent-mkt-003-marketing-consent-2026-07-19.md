# ENT-MKT-003 授权证据实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 Marketing Consent 契约：固定自动营销电话用途、四类取得渠道、对象描述、登记/撤回、不可变历史、
  当前有效性和撤回取消任务数响应。
- 新增 Evidence Store Adapter。生产只允许显式启用的 S3-compatible store，读取对象实体并核对 tenant/object
  metadata、SHA-256、字节数、内容类型、SSE 类型和可选 KMS key；25MiB以上拒绝。非生产可显式使用隔离本地
  目录，生产配置本地目录直接失败闭合；不接受公开 URL。
- 新增 `0039_enterprise_marketing_consents`：在既有 `contact_consents` 增加 Campaign、对象摘要、来源、actor、
  时间、版本和登记/撤回幂等字段；Campaign/Lead/member 使用 tenant-first 复合 FK，证据对象 tenant 内唯一，
  既有 forced RLS 继续生效。
- 数据库 trigger 禁止 Consent 删除和事后改写，只允许一次版本化撤回；已有业务证据时 down migration 拒绝
  静默丢弃。task insert 或 Campaign/Lead/scheduledAt 变更必须存在覆盖计划时间的有效授权。
- 撤回保留历史并取消没有替代有效授权的 pending/scheduled/retry task；已进入 Provider/PSTN 的物理中止不在
  本任务内，不据此宣称实时媒体已经停止。
- 新增 PostgreSQL Repository/runtime/API：登记只允许 `draft/not_submitted` 活动的 active Campaign Lead；
  登记/撤回绑定 tenant、actor、幂等键和规范 request hash；有效性只按服务端时间、active link/Lead、取得/失效/
  撤回状态解析；审计不写电话明文或对象内容。
- Enterprise Web 在线索表中复用 `verified_user` 进入授权详情，使用现有 Material Icons、浅深色 token、8px 圆角、
  状态组件和响应式规则，显示服务端有效性、对象引用/缩略 hash、不可变历史和撤回影响。

## 2. API 与配置边界

```text
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
GET  /enterprise/v1/campaigns/:campaignId/leads/:leadId/consent-eligibility
POST /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents
POST /enterprise/v1/campaigns/:campaignId/leads/:leadId/consents/:consentId/revoke
```

关键配置前缀为 `ENTERPRISE_MARKETING_CONSENT_EVIDENCE_*`。默认未启用；缺 bucket/region、凭据不完整、生产
HTTP endpoint、本地目录或 KMS 配置不完整时明确 not ready。SQLite/JSON runtime 不实现这些写入方法，API 返回
`enterprise_postgres_required`，不会回退演示数据。

## 3. 安全与执行不变量

| 场景 | 代码候选行为 |
| --- | --- |
| owner/admin/marketing_manager/marketing_member | `campaign:write` 可登记/撤回；登记还要求未提交草稿 |
| auditor | `campaign:read` 只读授权历史和服务端有效性，不显示写入口 |
| 其他角色/跨 tenant/失效 route | membership、scope、签名 route、tenant SQL 与 forced RLS 失败闭合 |
| 非自动营销用途或普通邮件/人工电话授权 | 严格请求契约和 DB purpose guard 拒绝，不做用途推导 |
| 对象缺失、hash/size/type/metadata/SSE 不符 | 422 或503；Consent、task、审计业务成功记录均为0 |
| 同键同 request hash | 精确重放原 Consent；异 hash 冲突 |
| 同一对象换键重复登记 | tenant evidence 唯一约束和 Repository 预检冲突 |
| 未来/过期/撤回授权 | eligibility blocked；task insert/reschedule 被 DB guard 拒绝 |
| 撤回且没有替代授权 | 历史保留，待任务取消，审计记录取消数量 |
| 撤回但存在覆盖计划时间的替代授权 | 目标 Consent 撤回，仍被替代授权覆盖的任务不取消 |
| legacy driver 或对象存储未配置 | 503；不回退 SQLite、JSON、fixture 或模拟对象 |
| 授权登记成功 | 不生成 Suppression、Country Policy、审批快照、Outbox、usage hold 或 PSTN 请求 |

## 4. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 492807 B，JS 962068 B，CSS 76357 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；39段，末段 `0039_enterprise_marketing_consents` |
| `0039` loader checksum | `d7ba0baf9ec89ac5d9bffcf01b67841f28bba97bca90fb0762cd06fe60721870` |
| tenant/subject 静态清单 | 81张 forced-RLS tenant table、43个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 要求 clean、已提交 release commit 和正式 metadata；feature diff 阶段未运行
该发布身份门禁。当前 bundle 内容/大小/fixture 静态扫描通过，不等于正式 Web 发布包放行。

## 5. 已定义但未运行的验收

`AC-ENT-0036` 已定义角色/租户、对象实体、用途/时间、幂等、schema/forced-RLS、task 执行栅栏、撤回和 Web
八组矩阵；领域测试文件定义状态、失败闭合 reason 和 registration/revocation hash 绑定，migration 清单测试已更新到
`0039`。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发撤回、Playwright、浏览器、axe、
Flutter 或任何真实 PostgreSQL/S3/KMS/Provider/LiveKit/设备测试；未连接 CRM/PSTN，未创建 Suppression、
Country Policy、审批快照、Scheduler、Outbox、usage hold 或真实拨号，也未操作生产 App、个人版生产代码/WIP、
Beelink 或生产服务。

因此本批不证明 `AC-ENT-0036`、A0/A3/H2/H3、真实外呼或企业生产门禁通过。`ENT-MKT-003` 保持
`in_progress`，下一任务为 `ENT-MKT-004 禁拨名单`。
