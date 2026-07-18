# ENT-UI-006 知识与术语管理代码候选证据

日期：2026-07-19

范围：企业 Web 代码、自动化与本地生产构建候选证据；不是企业 staging、A1/H3 或生产放行证据

## 页面与交互

- `/knowledge` 已从占位页替换为真实 Knowledge Source、Term Pack、Script Template 管理页。
- 三类资源均展示稳定资源、修订号、服务端状态、语言/国家/产品生效范围、内容数量和服务端 content hash。
- Knowledge 草稿正文按空行生成稳定 block ID；Term Pack 接受完整术语 JSON；Script Template 分列正文、
  必说语、禁语和变量。提交评审后内容进入只读 review，只有 review 可打开显式发布确认表单。
- published 显示“已发布，只读快照”；expired 显示“不参与运行时解析”；draft 明确“不进入运行时”。
- 术语包同时标明 ASR、翻译和 Agent 使用范围；话术模板显示业务 purpose。
- 页面沿用企业 token、8px 圆角和 Material Icons 注册表，没有引入第二套图标库或静态业务样本。

## 客户端安全边界

- 内容 API client 覆盖三类资源的 list/create/version/review/publish 18 个方法。
- 每个内容请求都发送 Bearer token、`x-tenant-id` 和 base64url 编码的
  `x-enterprise-route-document`；body 不发送可伪造 tenantId。
- `knowledge:read` 角色可以读取但不显示资源、修订、评审或发布写入口；服务端既有
  `knowledge:publish`、membership 和签名 route document guard 仍是最终授权边界。
- 写入始终使用当前服务端 `expectedVersion`；409/412 显示 conflict，不覆盖并发版本。
- `enterprise_postgres_required` 显示 not_ready，明确不回退到 SQLite/JSON；403 显示 forbidden，未知错误
  显示 failed。存在安全 trace ID 时统一状态组件可展示该 ID。

## 自动化与构建

- Enterprise Web：10 files / 55 tests，覆盖路由头与精确 endpoint/body、只读/发布角色、
  draft -> review -> published、published/expired 真值、Term/Script 范围以及 403/409/503 状态。
- Enterprise Web production build 通过：50 modules；JS 274.85 kB（gzip 86.69 kB），CSS 17.80 kB
  （gzip 4.04 kB）。构建产物没有静态示例租户或 Provider 成功数据。
- API 全量：190 files / 686 tests 通过，复验既有 `AC-ENT-0021/0022` 的 RBAC、route document、
  tenantId 伪造拒绝、状态机和 PostgreSQL-required 边界。
- 全 Node 回归：384 files / 1431 tests 通过，根级 build 与 LiveKit compatibility 同步通过。
- 根级 `typecheck`、`lint`、350 行 file-size 和 `git diff --check` 门禁通过。

## 未完成验收

- 未执行 macOS/Windows 的 Chrome/Safari/Edge 浏览器矩阵、200% 缩放、axe/人工键盘记录或视觉回归；
  这些仍属于 `ENT-UI-009/010`。
- 未连接真实 PostgreSQL staging，没有执行双租户并发 publish、故障恢复、容量或 H3 门禁。
- 未调用 ASR、翻译、LLM、embedding、对象存储或其他外部 Provider；页面和测试没有伪造 Provider 成功。
- 未构建或覆盖安装生产 App，未操作 Beelink 或真机。
