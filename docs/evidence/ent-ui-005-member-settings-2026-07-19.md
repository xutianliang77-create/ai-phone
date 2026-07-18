# ENT-UI-005 成员与角色设置代码候选证据

日期：2026-07-19

范围：企业 Web 代码、自动化、本地生产构建和单一 Chromium 桌面检查；不是企业 staging、A1/H3 或生产放行证据

## 页面与交互

- `/settings` 已从占位页替换为真实成员与角色设置页，展示服务端成员 ID、角色、状态、加入时间和记录版本。
- `member:write` 角色可以按已注册 `userId` 添加成员，并编辑其他非 owner 成员的角色和状态。
- 企业所有者受服务端保护；页面同时不提供当前账号自改入口，避免当前上下文 scope 与刚变更角色暂时不一致。
- 九个角色和 scope 直接读取共享 `enterpriseRoleScopes`，中文说明没有复制一份独立授权矩阵。
- 页面沿用企业令牌、8px 圆角、Material Icons 注册表、表格和统一状态组件，没有引入第二套图标库。
- 当前服务端成员创建接口直接创建 active membership，不会发送短信、邮件或 Provider 邀请；页面明确展示该边界，
  账号不存在时不伪造成功。

## 客户端安全边界

- 成员 API client 覆盖 list/create/update；所有请求携带 Bearer、`x-tenant-id` 和 base64url 编码的签名
  `x-enterprise-route-document`，请求 body 不发送可伪造 tenantId。
- `member:read` 角色可查看成员和 scope，但不显示新增/编辑入口；缺少 settings scope 的直接 URL 不发起
  `listMembers` 请求。
- 所有者和当前账号不显示编辑入口；其他更新仍由服务端 membership、`member:write` 和 route document guard
  做最终授权，不把前端隐藏当作安全边界。
- 403 显示 forbidden；重复成员、所有者保护和并发冲突映射为 conflict；PostgreSQL 未就绪显示 not_ready 并
  明确不回退 SQLite/JSON；未知错误显示 failed，安全 trace ID 由统一状态组件展示。

## 自动化、构建与浏览器检查

- Enterprise Web：11 files / 64 tests，覆盖成员 endpoint/method/header/body、只读与写角色、共享 scope 数量、
  新增、角色/状态更新、403/409/503、直接 URL 越权不执行成员读取。
- Enterprise Web production build 通过：89 modules；JS 287.79 kB（gzip 90.00 kB），CSS 21.58 kB
  （gzip 4.58 kB）。构建产物不包含页面测试中的示例成员或 Provider 成功数据。
- API 全量：190 files / 686 tests 通过，复验成员角色×读写、跨租户、tenantId 伪造、签名 route document、
  owner 保护和审计 guard。
- 全 Node 回归：385 files / 1440 tests 通过；根级 build 和 LiveKit compatibility 同步通过。
- 根级 `typecheck`、`lint`、350 行 file-size 和 `git diff --check` 门禁通过。
- 使用隔离 Playwright Chromium 在 1440×1000 检查真实 Vite 页面：成员表、添加表单、角色 scope 卡片、
  导航和 Material Icons 正常；网络只拦截本机 `/api/**`，没有连接或写入生产服务。

## 未完成验收

- 未实现短信、邮件或 Provider 邀请通道；本任务只完成现有已注册账号的企业成员加入。
- 未执行 macOS/Windows Chrome/Safari/Edge 全矩阵、320/600/960/1280px、深色、200% 缩放、axe 或人工键盘记录；
  这些仍属于 `ENT-UI-009/010`。
- 未连接真实 PostgreSQL staging，没有执行双租户并发成员更新、故障恢复、容量或 H3 门禁。
- 未调用任何外部 Provider，未构建或覆盖安装生产 App，未操作 Beelink 或真机。
