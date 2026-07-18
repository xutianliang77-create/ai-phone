# ENT-OBS-001 企业链路追踪实现候选证据

日期：2026-07-19

范围：可信 trace、PostgreSQL schema/Repository、共享契约和会话报告 API 的实现与静态类型校验；按开发阶段要求暂未执行测试，不是 staging、H1/H3 或生产放行证据

## 已实现

- Enterprise HTTP 请求继承或生成 W3C trace，安全 `x-trace-id` 进入 `EnterpriseTenantContext`，tenant PostgreSQL
  transaction 同时设置 `app.trace_id`；Fastify request id 只作为平台 trace 不可用时的本地 fallback。
- outbox event 保留入口 trace；本地处理器和独立 PostgreSQL cell Worker 在调用 publisher 前恢复该异步 trace，
  Provider operation 因而可读取同一父 trace，finalize 也不再以 Worker poll trace 覆盖业务链路。
- enterprise migration `0019_enterprise_observability_trace` 为 communication binding、usage event 和 append-only
  ledger 增加不可空 trace、tenant-first index 与 down migration；usage event/settle ledger 的 deferred consistency
  trigger 同时核对 trace，调整 ledger 保存发起调整的 trace。
- 新增 `EnterpriseSessionTraceReportResponse` 和
  `GET /enterprise/v1/observability/sessions/:sessionId/report`。接口要求 active membership 与 `audit:read`，
  PostgreSQL 不可用时返回 `enterprise_postgres_required`，不回退 SQLite/JSON。
- Repository 先在 tenant forced-RLS 下确认 communication binding/session，再读取每个 segment 最新 revision、
  Provider operation、tenant usage event/ledger reference 和同 trace 审计，跨租户 session ID 不返回资源。
- 质量只由真实 segment/latency 计算；无样本返回 `no_samples`。当前没有版本化单位价格表，报告只返回原始
  seconds/frames/characters/tokens 用量，`monetaryCost.amount=null`、`pricing_not_configured`，不伪造金额。
- 历史迁移记录使用显式 `legacy` trace，不构造虚假父链路，且报告不使用 `legacy` 关联审计。

## 本轮校验

- 根级 `pnpm typecheck` 通过，覆盖 Enterprise Web、contracts、API server、gateway/worker/runtime workspaces；
  contracts 与 API server 定向 build、根级 lint/file-size 和 `git diff --check` 通过。
- 未运行 Vitest、API 全量、全 Node 回归、migration up/down、PostgreSQL integration 或浏览器测试；
  这是用户明确要求“测试先略过”的开发阶段边界，不得解读为这些门禁通过。

## 待补验收

- migration `0019` 空库 up/down/forward、已有数据升级、append-only/identity trigger 和双 manifest checksum。
- `x-trace-id` 到 binding/provider/usage/ledger/audit 的精确关联，以及异步 outbox/Worker 父 trace 传播。
- owner/admin/auditor allow 与其他角色 deny；跨租户 session/trace、伪造 tenant/header/body、forced-RLS 和 404 隐藏。
- no-sample、legacy trace、Provider failed、usage-only、无 billing account/无 pricing 和异常行 fail-closed。
- 真实 PostgreSQL、OTLP、Provider、两租户并发会话、H1 长稳、账务抽样和 H3 恢复证据。

任务在上述自动化和目标环境证据完成前保持 `in_progress`，不能标记 `ready_for_acceptance`。
