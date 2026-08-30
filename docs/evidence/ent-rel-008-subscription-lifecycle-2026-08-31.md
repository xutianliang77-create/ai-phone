# ENT-REL-008 订阅和欠费生命周期代码候选证据

日期：2026-08-31
任务：`ENT-REL-008`
验收：`AC-ENT-0057`
状态：`in_progress`

## 1. 本批交付

- `0056_enterprise_subscription_lifecycle`：Subscription lifecycle 约束、provider event、可恢复 command、
  不可变 decision、forced RLS、状态/租约 trigger 和 pending-work 投影。
- HMAC + Unix时间窗 + configured Provider 的内部标准化事件入口；同 event/hash 重放、异 hash 冲突。
- Tenant UOW Repository/runtime：ingest、claim、apply、当前状态、usage dimension 对账。
- Cell Worker 双层 coordination/command lease、最多五次 attempt、崩溃到期重领、decision/状态/aggregate/audit/
  command 同事务。
- payment_failed、grace_expired、renewed、payment_recovered、cancelled 和 ignored 状态矩阵；恢复创建新
  subscription/snapshot，旧 entitlement 仅供已建立链路安全排空。
- `billing:read` + 签名 route 状态 API、health/release fail-closed、Cell 迁移活动命令栅栏。
- 企业设置页独立展示 lifecycle event/decision；欠费导致活动 entitlement 404 时仍显示真实状态并隐藏套餐写表单。
- migration、HMAC 和 route 测试定义已增加，但按用户要求未执行。
- 静态 migration loader：56段，末段 `0056_enterprise_subscription_lifecycle`，内容 checksum
  `5d65fa62e30142938019ad31ba8467b8d266d1b6c95d9dfba805465dae18bd46`；这不是数据库执行证据。

## 2. 当前边界

- 未运行 Vitest、API 全量、Node 回归或真实 PostgreSQL migration/RLS/down-forward。
- 未连接真实支付 Provider/sandbox，不声明 Provider event 已真实到达。
- 未执行双 Worker kill/reclaim、进行中人工接管/已接受通话排空、Cell cutover 或财务抽样。
- 企业 worktree 没有本地依赖，完整 typecheck 会报告 Fastify 等模块缺失；只可把新增代码无自身类型诊断作为
  窄静态结果，不能声称全量 typecheck 通过。
- SQLite/JSON 继续返回 PostgreSQL required；没有真实金额/发票/退款或 production readiness 声明。

### 2.1 已执行的静态检查

- 生命周期核心源码、ingest/process/auth/migration 测试定义窄 TypeScript：通过；测试定义只编译，未执行。
- `packages/contracts` 新 DTO 窄 TypeScript：通过；Enterprise Web settings API 窄 TypeScript：通过。
- 新 API/Repository/route/test 文件和 Billing 设置页/相关前端测试 esbuild 静态转译：通过。
- `node tools/check-file-size.mjs`：通过；`git diff --check`：通过。
- enterprise 静态安全扫描：2719个文件、21条规则，P0/P1/P2/P3 均0。提交后仍需绑定最终commit复跑；
  该扫描不是 H2 渗透、依赖、密钥轮换或独立 reviewer 证据。
- 企业 worktree 没有安装完整依赖；完整 API/Web typecheck 会因缺 Fastify/React/LiveKit/OpenTelemetry 等依赖而
  无法成为通过证据，未执行 `npm install`，也未把个人版依赖复制进企业仓库。

## 3. 待验收矩阵

1. 公共31段 + enterprise 56段空库 up/down/forward、普通角色 forced-RLS 与跨租户攻击。
2. HMAC key轮换、错签名、时间边界、Provider漂移、同event异hash和payload限制。
3. 五类事件、重复/逆序/非法状态跳转和旧subscription事件。
4. claim/apply/aggregate/audit/finalize各点kill，双Worker只有一个有效decision/新subscription。
5. 欠费后新高成本任务阻断，进行中安全链路结束/结算/审计，旧ticket不得创建新副作用。
6. 关闭账期所有category/unit的usage event/ledger/adjustment/aggregate count/hash/watermark财务抽样。
7. 活动command阻断Cell迁移，终态event/decision/command迁移后逐表hash一致。

## 4. 结论

本文件只证明 ENT-REL-008 代码候选范围和未执行门禁，不证明 `AC-ENT-0057`、真实支付、PostgreSQL、H3 或
企业生产发布已通过。
