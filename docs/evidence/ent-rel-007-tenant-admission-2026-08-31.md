# ENT-REL-007 租户限流与共享 Cell 公平保护代码候选证据

日期：2026-08-31
状态：`in_progress` / 验收未执行

## 实现范围

- `0055_enterprise_tenant_admission`：Cell policy/state、Cell-Tenant state、tenant request、forced RLS、
  tenant-bound runtime functions、operator-only config/status/reconcile functions 和完整 down path。
- 准入同时限制 Cell/tenant concurrency、tenant rate window、Cell/tenant queue；虚拟完成时间按 weight 形成稳定
  eligible-head 顺序，队列/lease TTL 有界。
- Worker Dispatch 在既有 entitlement/public capacity/grant 前取得 admission；accept/authorize/heartbeat/refresh/
  finalize/cancel 全部复核、续租或释放 admission。
- Marketing Scheduler 在 usage hold/claim 前取得 `marketing_pstn` admission，Provider prepare 前复核；accepted/
  webhook 续租至最长通话边界，failed/completed 释放，未知结果保留有界 lease。
- Screen Share ID 改为 tenant/meeting/idempotency 的确定性 UUID；acquire/renew/resume/stop/force-stop/revocation
  与 `screen_share` admission 同事务收敛。
- Admission policy manifest 固定候选 commit/image，每个 Cell 必须配置四种 capability；独立管理角色、apply/status
  CLI 和 reconcile Worker 已提供。Health/release/platform scale 报告配置 readiness。
- 全局 admission 表不进入 Cell tenant 数据复制；queued/admitted 请求阻断迁移。DR/cutover manifest 更新为55段。

## 本轮验证边界

按用户要求未运行测试。已增加 policy parser、migration、SQL allowlist、repository、Worker Dispatch 和 health 测试
定义；仅对不依赖 workspace 包的 admission config/SQL/repository/identity 模块执行定向 strict TypeScript 静态检查。
未运行真实 `0055`、最小权限 GRANT/RLS、跨租户并发、权重公平、速率/队列边界、reconcile、Worker/PSTN/共享媒体、
25/50/100阶梯或120分钟 soak。

因此当前不能宣称 noisy-neighbor 已验证、容量数字可承诺、`AC-ENT-0056`、H1/H3 或 production ready。
