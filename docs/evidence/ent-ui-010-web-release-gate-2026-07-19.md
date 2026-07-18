# ENT-UI-010 Web 自动化与发布门禁实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`

## 1. 本批交付

- Enterprise Web 增加独立 Playwright 配置，定义 Chromium、Firefox、WebKit，失败保留 trace/screenshot/video，并输出 JSON、HTML 和控制台报告。
- E2E 定义覆盖九角色精确导航、隐藏入口直接 URL、320/600/960/1280/1440 五档布局、light/dark 截图、主题持久化、200% 动态字号、skip link、axe A/AA 与脱敏遥测。
- 固定 `enterprise-release-matrix.json`，列出九角色、八页面状态、五档宽度、双主题、三浏览器引擎和九类必需 suite，防止通过删除测试范围放宽门禁。
- bundle scanner 限制 JavaScript 512KiB、CSS 96KiB，拒绝 source map、本地/内部地址、私钥/cloud key、fixture 身份、debug code，并要求 release version/commit 嵌入 bundle、匹配 clean Git HEAD。
- CI Node 版本由22对齐仓库要求的24；新增 Enterprise Web release-candidate job，执行 static gate、unit、三引擎 E2E，并保留14天失败/验收 artifact。
- 客户端捕获 error、unhandled rejection 和 navigation duration；原始 message/stack 只在浏览器本地参与 hash，不进入请求，path 去除 query/hash。
- 新增 `POST /enterprise/v1/observability/client-events`：要求 Bearer、active membership、`tenant:read` 与当前签名 route document，拒绝 body tenant/原始错误/额外字段，服务端补 tenant/region/cell/epoch/role/trace 后写结构化日志。
- 生产构建只在 Vite DEV 模式显示本地验证码，bundle scanner 会阻断 debug code 进入 release candidate。

## 2. 已执行的静态验证

```text
npm run typecheck -w @translation/contracts
npm run typecheck -w @translation/api-server
npm run typecheck -w @translation/enterprise-web
npm run typecheck:e2e -w @translation/enterprise-web
npm run build -w @translation/enterprise-web
npm run check:bundle -w @translation/enterprise-web -- --release
npm run lint
npm run check:lines
git diff --check
```

最终 clean-HEAD release metadata 扫描在独立提交生成后执行；普通构建扫描已验证 bundle 无上述禁止内容。

## 3. 本批明确未执行

按当前开发指令“测试先略过”，未运行：

- Enterprise Web Vitest、API route test、API 全量和全 Node 回归；
- Playwright Chromium/Firefox/WebKit、axe、键盘、响应式和视觉回归；
- `test:e2e:update`，因此没有生成或审批任何截图基线；
- GitHub Actions release-candidate job；
- PostgreSQL、Provider、Beelink、真机或生产 App 验证。

因此测试定义和 CI 配置不能作为测试通过证据；视觉基线缺失会让正式 release gate 失败闭合。
`ENT-UI-010` 保持 `in_progress`，不能宣称 AC-UI-001..012、A0/A1/H2/H3 或企业生产发布门禁通过。

## 4. 恢复测试后的执行顺序

1. 运行 Vitest、API 定向/全量和全 Node 回归，修复现有及新增契约失败。
2. 人工评审并生成首批三引擎/五宽度/双主题 visual baseline，再以无更新模式运行 Playwright。
3. 在 clean commit 上设置准确 release version/commit，运行完整 `check:enterprise-web-release`。
4. 由 CI artifact、浏览器矩阵和人工键盘记录共同决定是否把 UI-004/008/009/010 提升到 `ready_for_acceptance`。
