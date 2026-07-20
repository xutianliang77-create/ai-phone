# ENT-MKT-013 CRM Adapter 实现与静态门禁证据

日期：2026-07-20
分支：`codex/enterprise-edition`
状态：`blocked`（代码候选完成；真实 Salesforce 账号和正式验收证据缺失）

## 1. 本次交付

- 新增 `0049_enterprise_marketing_crm_sync` up/down migration。`marketing_crm_syncs` 使用 tenant-first
  复合 FK、forced RLS、单 Outcome/单 External ID/单 actor command 唯一约束，以及 pending→pending/synced/failed
  单向 attempt/version trigger。该表已加入 schema verify、subject column 和 cutover critical manifest。
- 新增 CRM sync contract、PostgreSQL Repository/runtime、`campaign:read/write` API、审计和 Worker finalize。
  请求事务只写 sync + Outbox + audit；Provider receipt 在第二个 tenant transaction 原子收敛 sync/outbox。
- Outbox 使用独立 AES-256-GCM `emcrm1` envelope，AAD 绑定 tenant/sync/campaign/outcome/External ID。
  明文 Outcome 摘要和后续动作不写 sync 表、Outbox JSON、审计或浏览器 DTO。
- 首个 Provider 为 Salesforce。Adapter 要求 tenant binding、OAuth Client Credentials、HTTPS Salesforce 域、
  API version、sObject、External ID field 和 payload field；以稳定 External ID PATCH upsert，再 GET 同一资源并比较
  External ID、规范载荷和 Record ID。只有 GET 对账结果生成 synced receipt。
- 401 重新取 token；408/409/425/429/5xx、传输未知、对账暂不可用或 receipt 不完整继续同 event/同 External ID
  指数退避。明确 Provider 拒绝可终结 failed；CRM 故障不回滚 MKT-012 Outcome/action、通话终态或结算。
- Web 继续复用 Outcome 面板、Material Icons、现有 token/StatusPanel，区分“等待 Provider 回执/已对账/终态失败”。
  HTTP 202 只提示已进入加密 Outbox。CRM 请求逻辑随 Outcome lazy chunk 加载，未突破初始 JS 门禁。
- 已定义 AES-GCM tamper、tenant mock contract、稳定 External ID 去重、Salesforce PATCH+GET 对账、缺配置和429降级测试；
  按当前隔离边界未运行 Vitest/API/Repository/migration/forced-RLS/Playwright。

## 2. 配置边界

Worker 需要以下服务端变量，任何一项缺失均不得伪造 ready/success：

```text
ENTERPRISE_CRM_PROVIDER=salesforce
ENTERPRISE_SALESFORCE_TENANT_ID
ENTERPRISE_SALESFORCE_LOGIN_URL
ENTERPRISE_SALESFORCE_CLIENT_ID
ENTERPRISE_SALESFORCE_CLIENT_SECRET
ENTERPRISE_SALESFORCE_API_VERSION
ENTERPRISE_SALESFORCE_OBJECT_API_NAME
ENTERPRISE_SALESFORCE_EXTERNAL_ID_FIELD
ENTERPRISE_SALESFORCE_PAYLOAD_FIELD
ENTERPRISE_MARKETING_CRM_PAYLOAD_ACTIVE_KEY_ID
ENTERPRISE_MARKETING_CRM_PAYLOAD_KEYS_JSON
```

Salesforce 侧需要专用最小权限集成用户、自定义对象或明确 sObject、唯一 External ID 字段和可容纳规范 JSON 的
长文本字段。客户端不接收 login URL、OAuth、字段映射、payload、config fingerprint 或 Provider 原始响应。

## 3. 已执行门禁

| 门禁 | 结果 |
| --- | --- |
| 根级 `npm run typecheck` | 通过；全部 Node workspaces |
| 根级 `npm run lint` / 350行 | 通过；受检文件最大349行 |
| API Server `npm run build` | 通过；包含 `0049` migration copy |
| Enterprise Web `npm run build` | 通过；Outcome lazy chunk 11.83kB |
| Enterprise Web `npm run check:bundle` | 通过；entry JS 524231B、总 JS 1031289B、CSS 91722B，无 source map/敏感标记 |
| `git diff --check` | 通过 |
| migration 静态清单 | 49段；`0049` checksum `f20b875be37bee531e8ba4d71f779a796b849bf712c8ebc845c35750a5d9f44c` |
| schema 静态清单 | 92张 tenant tables、20张 cutover critical tables；当前文档总业务表基线126张 |
| 个人版隔离 | `/Users/xutianliang/Downloads/ai phone` 仍只有原有 `?? outputs/`，未暂存、覆盖或清理 |

曾在脏 worktree、无 release metadata 时执行 `check:bundle --release`，门禁按设计拒绝 clean worktree/version/commit，
且当时初始 JS 超预算194B。根因是把两个 CRM API 方法放入主 API factory；现已移到 Outcome lazy chunk，非 release
bundle 门禁以 524231B 通过。正式 release 模式仍须在 clean commit、锁定 version/commit 后重跑，不能用本次结果替代。

## 4. 尚未执行 / 不得宣称

- 未运行 Vitest、API/Repository、`0049` 空库/增量/down/forward、forced-RLS、双租户、RBAC、并发、崩溃窗口和
  key rotation/旧 Worker/未知 Provider 响应故障注入。
- 未连接真实 PostgreSQL、Salesforce sandbox/production、浏览器或真机；没有真实 OAuth、sObject、Record ID、
  Provider receipt 或“外部失败恢复后只同步一次”的环境证据。
- 未运行 release metadata/clean-commit Web gate、staging 31+49 manifest、count/hash、WAL/PITR、容量、A0/A1/A2/H2/H3。
- 因真实 Salesforce 账号未提供，`ENT-MKT-013` 保持 `blocked`，`AC-ENT-0046` 未通过；本证据不是企业生产放行。

## 5. 正式验收续跑

1. 在隔离 staging PostgreSQL 执行 `0049` 空库、增量、down/forward、schema verify、forced-RLS 双租户和普通角色矩阵。
2. 使用 Salesforce sandbox 专用集成用户配置最小权限对象/字段，验证 create/update upsert 和 GET 对账 receipt。
3. 注入401、429、5xx、PATCH响应丢失、GET mismatch、Worker publish/finalize 崩溃及50并发，核对 Salesforce 仅一条记录。
4. 重算公共31 + enterprise49 manifest、126张业务表 count/hash 和20张 critical table 签名切换/恢复证据。
5. 在 clean commit 和锁定 release metadata 后执行 Web unit/contract/三引擎 Playwright/axe/视觉/键盘/release bundle 门禁。
