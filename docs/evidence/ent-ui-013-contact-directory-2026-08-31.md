# ENT-UI-013 客户与线索目录代码候选证据

日期：2026-08-31
任务：`ENT-UI-013`
状态：`in_progress`；功能代码候选已形成，测试与正式验收延后

## 实现范围

- `/contacts` 已从占位路由替换为真实企业 Web 页面。
- Marketing Lead 与 Support Customer 使用独立 DTO、API 和 PostgreSQL Repository，不建立跨域客户主数据。
- `GET /enterprise/v1/leads`、`GET /enterprise/v1/leads/:leadId` 要求 `campaign:read`。
- `GET /enterprise/v1/customers`、`GET /enterprise/v1/customers/:customerId` 要求 `support:read`。
- 四条路由要求 active membership、签名 tenant route 和 PostgreSQL Enterprise Repository runtime。
- 列表使用 HMAC seek cursor，绑定 tenant、目录类型、`updatedAt/id` 和有效期。
- 两个 Repository 使用 tenant `REPEATABLE READ READ ONLY` Unit of Work。

## 数据最小化

Lead 响应只包含遮罩 phone/external hint、国家/语言、活动数、授权资格、禁拨、最近已验证 disposition 和 CRM
状态；不包含号码密文/hash、attributes、授权证据正文、Outcome summary/evidence 或 CRM URL。

Customer 响应只包含遮罩 external hint、显示名、locale、consent scopes、会话/开放工单计数和有限状态历史；不包含
phone hash、attributes、intent、case subject/summary/resolution 或 channel config。每个数据库行核对 tenant，session/case
还核对 customer correlation。

## 客户端一致性

- 页签按 `campaign:read` 与 `support:read` 独立发现。
- 租户、页签、列表分页和详情请求使用单调递增 generation；旧响应不覆盖当前 loading/error/data。
- `403`、`503`、empty、loading 和 failed 使用统一企业状态组件。
- 使用现有 Material Icons、浅深色 token、8px 圆角和响应式规则，不引入第二套图标或品牌样式。

## 当前静态证据

- `@translation/contracts` typecheck：通过。
- `@translation/enterprise-web` typecheck：通过。
- `@translation/api-server` typecheck：通过；期间发现的既有 admission count 类型缺陷已由独立提交修复。
- 新入口 esbuild 静态转译：通过。
- `node tools/check-file-size.mjs`：通过。
- `git diff --check`：通过。
- `node scripts/check_enterprise_security_static.mjs`：2740 个文件、21 条规则，P0/P1/P2/P3 均为0。

依赖仅按现有 lockfile 使用 `npm ci --ignore-scripts` 安装，未修改 lockfile。按“功能优先、测试与验收延后”要求，
本任务未运行 unit/API/PostgreSQL/forced-RLS/浏览器/axe/视觉测试，也未配置真实 Provider。因此本文不是
`AC-UI-013`、A1、H3 或企业生产门禁通过证明。
