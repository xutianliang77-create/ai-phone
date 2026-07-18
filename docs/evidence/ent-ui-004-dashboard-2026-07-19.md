# ENT-UI-004 企业工作台实现证据

日期：2026-07-19

状态：`in_progress`
范围：首批服务端真值工作台，不含正式验收

## 1. 实现范围

- `/` 路由使用生产 `DashboardPage`，不再展示静态基础占位卡。
- 租户状态、home region 和 cell 来自已验证的 tenant context/route document。
- Provider 就绪数来自 `/enterprise/v1/provider-capabilities`，失败或未配置不显示 ready。
- 套餐、预算和用量分别来自 entitlement、budget 和 immutable ledger period aggregate API。
- 预算告警仅比较相同 category、unit、periodStart、periodEnd 的服务端记录，不跨单位求和。
- 具备 `audit:read` 时，可按明确 communication session ID 查询质量、Provider、usage/ledger 和 trace 报告。
- 会议、客服和营销聚合 API 尚未交付，业务状态明确显示 not_ready。
- 无质量/用量样本不补零、不生成趋势；无价格表时显示 `pricing_not_configured`，不估算金额。

## 2. 权限和失败闭合

| 数据 | 前端请求条件 | 缺失或失败表现 |
| --- | --- | --- |
| Provider capability | tenant context 已建立 | loading/不可用；不伪造 ready |
| Subscription/budget | `billing:read` | 不请求并显示无读取权限 |
| Usage aggregate | `usage:read` | 不请求并显示 forbidden |
| Session trace report | `audit:read` 且用户输入 session ID | 不提供查询入口；错误显示安全 trace ID |
| 业务聚合 | 服务端接口尚未交付 | 固定 not_ready，不使用 fixture |

服务端 membership、RBAC、route document 和 forced RLS 仍是最终授权边界；前端 scope 只负责请求发现和减少无权调用。

## 3. 静态门禁

- `pnpm typecheck`：通过。
- `npm run build -w @translation/enterprise-web`：通过。
- `npm run lint`：通过，包含源文件行数门禁；`DashboardPage.tsx` 当前 322 行。
- `git diff --check`：通过。

## 4. 明确未执行

按本轮要求暂缓测试，未执行 Vitest、API 全量、全 Node 回归、Playwright/浏览器矩阵、axe/键盘、PostgreSQL migration
或双租户攻击测试。因此本证据不能证明 AC-UI、A1、H3、企业试点或生产放行，`ENT-UI-004` 保持 `in_progress`。
