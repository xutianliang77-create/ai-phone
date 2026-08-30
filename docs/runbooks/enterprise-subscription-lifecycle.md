# Enterprise Subscription Lifecycle 值班手册

版本：v1.0
日期：2026-08-31
适用任务：`ENT-REL-008`
状态：代码候选；真实支付 Provider、PostgreSQL、故障和财务门禁未验收

## 1. 目的和边界

本手册用于订阅续费、支付失败、宽限期结束、支付恢复和注销事件的诊断与安全收敛。PostgreSQL 中的
`billing_accounts`、`subscriptions`、`entitlement_snapshots`、`billing_provider_events`、
`billing_lifecycle_commands`、`billing_lifecycle_decisions`、usage ledger/aggregate 和 audit 是唯一真值。

禁止通过手工 `UPDATE`、删除 Provider event/decision、复活旧 subscription/snapshot、伪造 Provider receipt 或
绕过 Worker generation 处理事故。SQLite/JSON 只能用于封闭演示，不是账务恢复路径。

## 2. 必需配置和 readiness

API 节点必须配置：

- `API_STORAGE_DRIVER=postgres`；
- `ENTERPRISE_BILLING_LIFECYCLE_PROVIDER`：标准化账务 Adapter 的稳定名称；
- `ENTERPRISE_BILLING_LIFECYCLE_SIGNING_SECRET`：至少32字节、与其他 webhook/release/DR key 分离；
- `ENTERPRISE_BILLING_LIFECYCLE_REPLAY_SECONDS`：30–900秒，默认300秒；
- 正常 Enterprise Cell Worker 配置和最小权限 tenant/cell 数据库连接。

`GET /health` 的 `enterpriseBillingLifecycleReadiness` 和 `GET /health/release-ready` 必须同时为 ready。缺 Provider、
短/缺 HMAC key 或 release 其他门禁不全时保持503；不得临时改成模拟成功。

## 3. 事件入口契约

内部 Adapter 调用 `POST /internal/enterprise/billing/subscription-events`，携带：

- `x-enterprise-billing-timestamp`：Unix秒；
- `x-enterprise-billing-signature`：`sha256=<hex>`；
- 固定 JSON 字段：tenant、provider、providerEventId、subscription、eventType、provider payload SHA-256、
  occurred/effective time；renew/recover 还必须有新 period start/end。

签名正文是 `<timestamp>.<canonical-json>`。同 Provider event ID 与同 request hash 返回 replay；相同 ID 但字段/hash
漂移返回409。签名、时间、Provider、字段或 tenant/subscription 绑定失败时，不会创建 event/command。

## 4. 状态矩阵

| Event | 前置状态 | 结果 | 新任务 | 进行中链路 |
| --- | --- | --- | --- | --- |
| `payment_failed` | account/subscription active | past_due/past_due | 立即阻断 | 冻结权益安全排空 |
| `grace_expired` | past_due/past_due | suspended/suspended，projection disabled | 阻断 | 短租约结束，允许停止/结算/审计 |
| `renewed` | active/past_due/suspended | 新 active subscription/snapshot | 重新解析后允许 | 旧链路仍绑定旧版本 |
| `payment_recovered` | active/past_due/suspended | 新 active subscription/snapshot | 重新解析后允许 | 旧链路仍绑定旧版本 |
| `cancelled` | 非closed且订阅可取消 | closed/cancelled，projection disabled | 永久阻断 | 只允许安全收敛 |

逆序、旧 subscription 或状态不匹配事件写 `ignored` decision，不强行“修正”当前状态。

## 5. 常规值班步骤

1. 记录候选 commit/image、tenant（脱敏）、Provider event ID、command ID、trace ID 和告警时间。
2. 从租户状态 API 读取 account/subscription/period/last decision；不要请求或记录 Provider 原始载荷/secret。
3. 确认 Provider event 的 tenant/subscription、event type、effective time 和 payload hash 与 Provider 控制台证据一致。
4. 确认 `platform_pending_work` 和 lifecycle command 的 status/attempt/owner/generation/lease；只读查询，不手改租约。
5. Worker processing lease 未过期时等待当前 owner；已过期时由正常 Cell Worker 以更高 generation 重领。
6. completed 后核对 decision、subscription/snapshot、audit，以及关闭区间内所有 category/unit 的 aggregate
   count/hash/watermark。
7. 将结果、期望/实际、时间线和脱敏证据交给独立 reviewer；没有真实财务对账不标记账务验收通过。

## 6. 故障处理

### 6.1 Provider/签名 not ready

- 保持内部入口和 release health 503；检查配置引用、key 版本、Adapter Provider 名称和时钟偏差。
- 不把事件直接写数据库，不借用 `INTERNAL_API_SECRET` 或其他 HMAC key，不扩大重放窗超过900秒。
- 恢复后由 Provider/Adapter 使用原 event ID 重放，确保只生成一个 command。

### 6.2 command backlog 或 Worker 崩溃

- 先确认 Cell Worker、数据库主库和协调 lease 状态；旧 owner 仍有效时不得启动手工并行处理。
- 过期 processing 由正常 Worker 重领；attempt 达5后进入 failed，需要工程/财务复核事件及状态，不直接重置 attempt。
- 外层 coordination 或内层 command lease 丢失会使 apply transaction 回滚；检查是否存在 decision/command terminal，
  不能只根据进程日志判断提交成功。

### 6.3 欠费后进行中会话

- 验证新 dispatch 已被 account/subscription guard 阻断。
- 不强停已接受 Provider、紧急人工接管或安全结束链路；允许其结束、撤销、挂断、结算和审计。
- 若旧 ticket 尝试创建新副作用，按安全事件处理并保留 ticket/version/trace 证据。

### 6.4 恢复后权益仍不可用

- 确认产生了新的 active subscription 和 entitlement snapshot，旧行是 superseded/retired。
- 确认 projection 的 entitlementVersion 指向新 snapshot，客户端/Worker 重新发现当前版本。
- 不把旧 snapshot 改回 active；版本漂移按事务失败或数据完整性事故升级。

### 6.5 usage 对账不一致

- 按 decision 的 `[closedPeriodStart, closedPeriodEnd)` 和每个真实 category/unit 对比 usage event、settle/adjustment
  ledger、aggregate count/hash/watermark。
- 只允许调用受控 rebuild；不得更新/删除原始 event、ledger 或 adjustment。
- 若 rebuild 仍不一致，停止财务关账并升级，不伪造金额或“已对账”。

## 7. Cell 迁移和 rollback

- tenant 存在 pending/processing lifecycle command 时禁止 Cell cutover/rollback。
- terminal provider event/command/decision 与租户业务数据一起参与 count/hash 迁移；`platform_pending_work` 是派生投影。
- `0056` down 只在所有 subscription 已回到旧版本可解释的 active/superseded 状态时执行；否则 migration
  失败是预期安全行为，必须先完成经财务批准的数据 remediation。

## 8. 放行证据

至少包含 `AC-ENT-0057` 的 migration/RLS、签名/replay、状态矩阵、双 Worker kill/reclaim、进行中安全排空、
Cell 迁移和财务 count/hash 抽样，并绑定同一 commit/image。当前代码/静态检查或模拟 Provider 均不能替代真实证据。
