# ENT-MKT-014 活动分析实现证据

日期：2026-07-20（CST）
分支：`codex/enterprise-edition`
验收映射：`AC-ENT-0047`
结论：代码与静态门禁候选完成；真实 PostgreSQL/RLS、自动化、浏览器、价格表和容量验收未执行，任务保持 `in_progress`。

## 1. 实现范围

- 新增 `GET /enterprise/v1/campaigns/:campaignId/analytics`，要求 active membership、`campaign:read` 和有效签名 route；
  legacy/SQLite 固定返回 `enterprise_postgres_required`，不回退 JSON、SQLite、浏览器缓存或 fixture。
- 分析事务使用 `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`，全部聚合在同一 tenant snapshot 内读取。
- 漏斗只取 active Campaign Lead、已物化 task、PSTN `accepted_at`、`answered_at` 和 `verified` Outcome；比率只以相邻阶段为
  分子/分母，零分母返回 null。
- 投诉只计 `source=complaint + origin_campaign_id`；执行版本只计 `source_reference=communication_session_id` 的精确归属。
- 用量从 tenant usage event 的 settle ledger 引用和 adjustment 计算 settled/adjustment/net/event count；版本归因经
  `usage_hold_id -> dispatch -> run`，避免重试 generation 重复计量。
- CRM 成功只计 `marketing_crm_syncs.status=synced` 的已对账 receipt。正向兴趣、requested action、pending sync 和
  Provider accepted 均不冒充成交或外部成功。
- 国家维度同时包含 Campaign 目标国家和实际 Campaign Lead 国家；执行版本维度冻结 profile version、Term Pack/
  Script Template version ID、Agent Provider fingerprint、PSTN Provider/fingerprint。缺 run 不补造版本。
- 当前没有单位价格表；货币对象固定 `amount=null`、`currency=null`、`reasonCode=pricing_not_configured`。
- Enterprise Web 复用 Outcome lazy chunk、Material Icons、既有 token/StatusPanel、响应式可聚焦表格和明确空/降级状态。

## 2. 代码证据

- 契约：`packages/contracts/src/api/enterprise-marketing-analytics.ts`
- API/运行时：`services/api-server/src/modules/enterprise/enterprise-marketing-analytics.routes.ts`、
  `enterprise-marketing-analytics-runtime.ts`
- PostgreSQL Repository/SQL/映射：`services/api-server/src/infrastructure/postgres/enterprise-postgres-marketing-analytics-*`
- 一致性事务：`enterprise-postgres-tenant-session.ts` 与 `enterprise-postgres-unit-of-work.ts` 的只读 repeatable-read 选项；
  其他读写调用保持原 `BEGIN` 默认行为。
- Web：`apps/enterprise-web/src/components/CampaignMarketingAnalyticsPanel.tsx`、
  `api/enterprise-marketing-analytics-api.ts` 与 `styles/campaign.css`
- 测试定义：`enterprise-postgres-marketing-analytics.test.ts`、`enterprise-postgres-read-snapshot.test.ts`
- 本任务不新增 migration 或分析物化表；manifest 仍为公共31段 + enterprise49段，总业务表126张、tenant表92张、
  critical表20张。`0049` checksum 保持 `f20b875be37bee531e8ba4d71f779a796b849bf712c8ebc845c35750a5d9f44c`。

## 3. 本轮已执行静态门禁

- 根 workspace `npm run typecheck`：通过。
- `npm run build -w @translation/api-server`：通过。
- `npm run build -w @translation/enterprise-web`：通过。
- Enterprise Web E2E TypeScript：通过。
- 根 `npm run lint` 与350行文件门禁：通过。
- `git diff --check` 与缓存区 diff check：通过。
- Enterprise Web 非 release bundle：通过，14 files，entry JS `524231 B`，全部 JS `1037972 B`，CSS `94502 B`。
- 初次单独 lazy 入口使 entry JS 超过512 KiB，bundle gate 按设计拒绝；随后复用既有 Outcome lazy chunk，未放宽预算，
  再次门禁通过。

## 4. 未执行与阻塞边界

- 按持续静态边界未运行 Vitest、API/Repository 测试、真实 PostgreSQL、forced-RLS/双租户、并发写入 snapshot、
  Playwright/浏览器、真实 usage/Outcome/CRM 样本、价格表或容量测试。
- 未执行 migration/down/forward，因为本任务没有新 migration；既有31+49 staging cutover/restore 证据仍需重建，旧证据不能复用。
- 未构建或安装生产 App，未操作 Beelink、服务、PSTN/Provider、LiveKit 或真机。
- SQLite/JSON 仍只用于本地开发和封闭演示；本证据不构成 PostgreSQL 企业试点、`AC-ENT-0047` 或企业生产门禁通过。

## 5. 后续验收

1. 在隔离 PostgreSQL 以普通非 owner/非 BYPASSRLS 角色执行 owner/admin/marketing/auditor/其他角色与双租户矩阵。
2. 并发写入 Outcome、CRM receipt 和 usage adjustment，验证单响应所有合计来自同一 repeatable-read snapshot。
3. 复算 Campaign/国家/版本的漏斗、投诉、usage/adjustment 和 CRM receipt；覆盖零分母、无样本、旧 run 与多 generation。
4. 提供正式价格表前继续要求货币金额为空；引入价格表后另行验收版本、生效时间、币种、精度和历史重算边界。
5. 执行 320/600/960/1280、浅深色、键盘、200%缩放、横向表格和真实大数据量浏览器/容量矩阵。
