# ENT-UI-009 响应式、深色与无障碍实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`

## 1. 本批交付

- 新增 `EnterpriseThemeProvider`，提供持久化 `system|light|dark` 偏好、系统主题变更监听和存储失败降级；解析后的主题只影响根节点 `data-theme/color-scheme`，不写入服务端租户或成员数据。
- 深色令牌与 Flutter 主题保持一致；浅色风险小字增加 `#A8433C` 可访问前景，和白色背景的静态对比度为 5.94:1，品牌 Signal `#C4574E` 保持不变。
- 960px 以下保留可用的顶部租户切换；600px 以下主导航改为可横向滚动的图标+文字底栏，顶部只保留租户与主题，页面动作、表单和卡片可单列重排。
- 登录页在 839px 及以下切为单栏，避免 600px 宽度落入 `320+420px` 双栏最小宽度造成页面溢出。
- 核心字号、行高、控件与壳尺寸使用 `rem`；默认视觉尺寸不变，为动态字体和浏览器缩放保留重排能力。
- 新增跳至主要内容、路由切换主区域焦点、统一 `focus-visible`、高对比/forced-colors/reduced-motion 基础规则。
- 审计、用量、成员和工作台表格增加命名 region、键盘焦点和 caption；设置横向导航可聚焦；知识类型切换由不完整 tab 语义改为 `aria-pressed` 按钮组；图标按钮保持可访问名称。
- 未使用全局横向溢出隐藏；高密度表格和导航在自身容器滚动。

## 2. 静态验证

以下命令已通过：

```text
npm run typecheck -w @translation/enterprise-web
pnpm typecheck
npm run build -w @translation/enterprise-web
npm run lint
npm run check:lines
git diff --check
```

Enterprise Web production bundle 由 Vite 8.1.4 构建成功；全仓 TypeScript workspace 检查通过，文件规模门禁通过。

## 3. 本批明确未执行

按当前开发指令“测试先略过”，未运行：

- Vitest、API 全量和全 Node 回归；
- Playwright、Chrome/Safari/Edge 浏览器矩阵；
- 320/600/960/1280/1440px 截图和布局断言；
- 200% 缩放、动态字体、横屏、键盘路径、axe、forced-colors 和视觉回归；
- PostgreSQL、Provider、Beelink、真机或生产 App 验证。

因此 `ENT-UI-009` 保持 `in_progress`。静态颜色计算、typecheck 和生产构建不能替代完整页面 WCAG AA、
AC-UI-008/009/010、A0/A1/H2/H3、企业试点或生产放行证据。

## 4. 后续验收入口

- `ENT-UI-010` 增加角色×页面×状态的组件/E2E、响应式截图、主题视觉回归、键盘路径、axe、bundle 扫描和前端错误监控门禁。
- 恢复测试后在桌面 Chrome/Safari/Edge 以及支持范围内的 iPhone/Flutter 动态字体场景执行验收矩阵。
