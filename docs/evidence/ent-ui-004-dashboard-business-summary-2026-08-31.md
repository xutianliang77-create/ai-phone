# ENT-UI-004 工作台业务快照代码候选证据

日期：2026-08-31
任务：`ENT-UI-004`
状态：`in_progress`；业务汇总功能代码已接入，测试与正式验收延后

## 服务端快照

- 新增 `GET /enterprise/v1/dashboard/business-summary`。
- 路由要求 `tenant:read`、active membership、签名 tenant route 和 PostgreSQL runtime。
- `campaign:read`、`support:read`、`meeting:read` 分别决定是否执行对应域 SQL；缺 scope 返回 forbidden section。
- 同一 tenant `REPEATABLE READ READ ONLY` UOW 中先取得数据库 `generatedAt`，再分别执行三个独立 aggregate。
- Marketing 只读取 Campaign/Task；Support 只读取 Queue/Session/Claim/Case；Meeting 只读取 Meeting/Participant。
- 三个域不 cross join，不建立或写入第二套 Dashboard 聚合表。
- SLA breach 与 claim lease 使用同一数据库快照时间判断。

## Web 行为

- 原固定 `not_ready` 业务区已替换为外呼营销、AI 客服、企业会议真实计数卡。
- 没有时间序列时只显示快照计数，不绘制示例趋势；没有价格表时继续不显示货币成本。
- 需要关注的活动、客服 SLA 超时和失败会议进入“待办与告警”。
- 每次刷新递增 generation，旧请求不能覆盖新请求；Dashboard 以 tenant ID 为 React key，切租户重新挂载。
- 无 billing/usage scope 时相应资源立即回到 idle，不保留前一租户/角色数据。

## 当前证据边界

- `@translation/contracts` typecheck：通过。
- `@translation/enterprise-web` typecheck：通过。
- `@translation/api-server` typecheck：通过。
- Dashboard Web、路由和 Repository esbuild 静态转译：通过。
- 文件规模与 `git diff --check`：通过。
- 企业静态安全：2748 个文件、21 条规则，P0/P1/P2/P3 均为0。
- 按“功能优先、测试与验收延后”要求，未运行 unit/API/PostgreSQL/forced-RLS/浏览器/axe/视觉测试。

本文不是 `AC-UI-014`、A1、H2、H3 或企业生产门禁通过证明。真实验收还必须覆盖九角色×双租户 scope
矩阵、SQL 计数对账、同一时间点 SLA/lease、并发刷新、切租户竞态和响应敏感字段扫描。
