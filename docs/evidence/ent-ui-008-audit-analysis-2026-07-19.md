# ENT-UI-008 审计与分析实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`

## 1. 本批交付

- Enterprise Web 新增 `/audit` 与 `/analytics` 真实页面：审计 action/resource/result 筛选、与筛选绑定的签名 cursor 翻页、默认缩略主体/资源标识、事件详情、明确 session ID 的质量/Provider/usage/ledger/trace 下钻。
- 数据分析没有业务聚合或价格表时显示 `not_ready/not_configured`，不补零、不生成示例趋势或客户端货币估价。
- 新增 `audit:export` 受控 JSONL 导出契约和 API：创建必须携带签名 tenant route document、幂等键、目的、最长31天半开范围和1至30天保留期；列表只允许 `audit:read`，创建和下载要求 `audit:export`。
- enterprise migration `0020_enterprise_audit_exports` 增加 forced-RLS job、不可变请求/终态、tenant-first index 和 cell pending work 投影。
- PostgreSQL Repository/runtime/cell Worker 最多导出10000条事件和10MiB；artifact manifest 与数据库保存 event count、size、SHA-256、expiresAt，terminal finalize 使用 attempt fence。
- artifact store 支持生产加密 S3（默认凭据链/工作负载身份或成对显式凭据）和非生产本地目录；生产拒绝本地目录与 HTTP S3 endpoint。未配置时 API 返回明确 503，不创建本地替代文件。
- 下载通过 API 重新执行 membership/RBAC/route guard，读取对象后核对对象 size/hash 与实际 SHA-256，并对 completed/failed/denied 结果追加审计；客户端不接收 bucket、object key 或凭据。
- 审计写入继续拒绝敏感详情键；PostgreSQL 历史读取映射对 token/secret/password/authorization/idempotency/phone/url 键再次替换为 `[REDACTED]`。

## 2. 静态验证

以下命令通过：

```text
npm run typecheck -w @translation/enterprise-web
pnpm typecheck
npm run build -w @translation/contracts
npm run build -w @translation/api-server
npm run build -w @translation/enterprise-web
npm run lint
git diff --check
```

构建结果包含 contracts/API TypeScript 产物、`0020` migration 复制和 Enterprise Web Vite production bundle。文件规模门禁通过，所有本批 TypeScript/TSX 文件均不超过350行。

## 3. 本批明确未执行

按当前开发指令“测试先略过”，未运行：

- Vitest、API 全量和全 Node 回归；
- migration up/down/forward、Repository/Worker 并发与 forced-RLS 双租户攻击；
- S3/MinIO 或本地 artifact store 行为测试、篡改/过期/下载矩阵；
- Playwright/Chromium/Safari/Edge、响应式、键盘、axe 和视觉回归；
- staging PostgreSQL、真实对象存储、Provider、Beelink、真机或生产 App 验证。

因此 `ENT-UI-008` 保持 `in_progress`，不能宣称 AC-ENT-0024、AC-UI、A1/H2/H3、企业试点或生产门禁通过。

## 4. 剩余边界

- 对象到期当前会拒绝下载，并向 S3 写 `Expires` 元数据；物理删除、不可变对象清单、删除重试与恢复对账仍由 `ENT-REL-002/003` 完成。
- 会议、客服、营销跨会话聚合 API 尚未实现；版本化单位价格、币种、舍入和 Provider 成本归属尚未实现。
- 当前 enterprise manifest 为公共31段 + enterprise 20段；旧 `ENT-DATA-009` 签名证据与当前 manifest 不一致，必须在隔离 staging 重新生成。
