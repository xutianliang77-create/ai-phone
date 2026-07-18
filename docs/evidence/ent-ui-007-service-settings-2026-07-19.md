# ENT-UI-007 区域、Provider、套餐与用量代码候选证据

日期：2026-07-19

范围：企业 Web 代码、自动化、本地生产构建和隔离 Chromium 桌面/移动检查；不是企业 staging、A1/H3 或生产放行证据

## 页面与交互

- `/settings` 现在提供 scope-aware 二级导航：成员与角色、套餐与权益、区域与数据、Provider、预算与用量。
- 区域页面只读展示已校验 route document 的 homeRegion、cell、route epoch、公开 API/RTC 主机、有效期和租户
  retention；没有区域选择器，也不显示 signature。服务端没有迁移申请 API 时明确显示尚未开放，不伪造保存成功。
- Provider 页面重新读取 capability document，展示 capability、status、reasonCode、区域、检测时间、feature 和脱敏
  fingerprint；not_configured/not_ready/探测失败均不解释为 ready。页面不接收或回显 Key、Secret、Webhook URL、
  Provider 健康地址，也没有不存在的配置写入口。
- 套餐与权益页面展示 billing account、当前 subscription、账期和版本化 entitlement snapshot；不显示
  billingContactSubjectId。只读角色无写表单；写角色只能提交精确 planCode/planVersion/seats/cycle，冲突重试保持同一
  idempotencyKey。没有套餐目录、支付、发票或退款 API 时不生成这些入口。
- 预算与用量页面分别按 billing:read/write 和 usage:read 读取；预算新建/编辑使用服务端 category/unit/period，编辑携带
  expectedVersion；账期聚合只读展示 settle/adjustment/net、count、ledger hash 和版本，不解释为余额、账单或实时
  Provider 用量。空结果不绘制示例趋势。

## 权限与失败边界

- 企业设置主入口由 tenant:read 发现；成员、账务、区域、Provider、用量的二级入口按各自 scope 过滤。
- 直接访问无权二级 URL 时先显示 forbidden，不调用成员、billing、budget 或 usage API；前端隐藏不替代服务端
  membership、RBAC 和签名 route document guard。
- billing/usage 请求都携带 Bearer、x-tenant-id 和 base64url route document，path 使用当前 tenant，body 不发送
  tenantId；Provider capability 只使用 Bearer 与当前 tenant header。
- 402/409/503、403 和未知错误分别进入 not_ready/conflict、forbidden 和 failed/degraded 真值状态；安全 trace ID 可见。
  PostgreSQL 未就绪时不回退到 SQLite/JSON，也不把旧 Provider 缓存伪装为实时结果。

## 自动化、构建与浏览器检查

- Enterprise Web：12 files / 72 tests，覆盖精确 endpoint/method/header/body、二级 scope 导航、直接 URL 越权不请求、
  区域只读/签名隐藏、Provider not_configured、账务只读、订阅冲突幂等重试、预算 expectedVersion、ledger 聚合和
  PostgreSQL not_ready 无 fallback。
- Enterprise Web production build：99 modules；JS 313.22 kB（gzip 95.86 kB），CSS 27.30 kB（gzip 5.20 kB）。
  构建产物不包含测试 fixture、Provider 密钥或成功配置。
- API 全量：190 files / 686 tests 通过；复验 billing/entitlement、预算、usage ledger/aggregate、tenant、RBAC、
  route document 和 PostgreSQL-required 边界。
- 全 Node 回归：386 files / 1448 tests 通过；根级 build 和 LiveKit compatibility 同步通过。
- 根级 typecheck、lint、file-size 和 git diff --check 门禁通过。
- 使用隔离 Playwright Chromium 对本地 Vite 页面做 1440×1000 套餐页和 390×844 用量页检查；本机 `/api/**` 由固定
  fixture 拦截，未连接或写入生产服务。桌面卡片/表单无溢出，移动端主导航图标可见、二级导航和宽表可横向滚动。

## 未完成验收

- 未执行 macOS/Windows Chrome/Safari/Edge 全矩阵、320/600/960/1280px、深色、200% 缩放、axe 或人工键盘记录；
  这些仍属于 ENT-UI-009/010，两个 Chromium 样本不构成 AC-UI-008/009/010 完整通过。
- 未连接真实 PostgreSQL staging，没有执行双租户并发订阅/预算更新、forced-RLS 攻击、恢复、容量或 H3 门禁。
- 未配置或调用真实 Provider、支付、发票、退款、余额或关账服务；不能宣称 Provider 或账务生产链路成功。
- 未构建或覆盖安装生产 App，未操作 Beelink、真机或外部服务。
