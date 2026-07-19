# ENT-CS-002 呼入 Channel Adapter 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 `EnterpriseSupportInboundEvent` contract，PSTN/Web/App 统一提交稳定 provider event ID、
  SHA-256 客户键、可选电话 hash、locale、intent、priority 和 canonical UTC 时间；不接受原始电话号码。
- 新增短期 HMAC dispatch ticket，绑定 tenant、channel、channel type、homeRegion、cell、routeEpoch 和到期时间；
  弱密钥、篡改、过期和旧路由均失败闭合。
- 新增受 `support:manage`、签名 tenant route 和实时 Provider readiness 保护的 channel 创建 API；响应不回显
  `configRef`。
- 新增只接受强 `INTERNAL_API_SECRET` 的 channel 授权和入站 API。外部 Provider webhook 必须先在 edge
  Adapter 完成签名、时间窗和重放验证，不能直接调用 tenant Repository。
- PostgreSQL 入站事务锁定 tenant 路由，复核 channel/policy/entitlement，以 canonical payload hash 写 Inbox，
  按 hash 化客户键归并客户，并原子创建 support session、公共 communication session、唯一 binding、审计和
  `support.session.created` Outbox。
- 相同 source/event/hash 重放返回原会话；同 ID 不同 hash 或事件 source 与 channel provider 不一致时冲突。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript build/typecheck | 通过 |
| API Server TypeScript build/typecheck | 通过 |
| 全 workspace TypeScript typecheck | 通过 |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |
| migration/schema manifest | 无新增 migration；仍为28段、68张 tenant 表、29个主体字段、总表102张 |

## 3. 明确未执行

按要求未运行任何 Vitest/API/Repository/contract/forced-RLS/并发/重启恢复测试；ticket 负向测试仅定义未执行。
未连接真实 PostgreSQL、PSTN Provider、Web/App Gateway、Provider webhook、浏览器、真机或生产服务。

因此本批不证明三渠道真实媒体已接通，也不证明 AC-CS-006..009、A2/H3 或企业生产门禁通过。恢复测试后需覆盖
三渠道 contract、Provider 签名、tenant/channel/type/route ticket 攻击、相同/冲突重放、事务故障注入、并发入站、
Outbox 恢复和真实 Provider sandbox。
