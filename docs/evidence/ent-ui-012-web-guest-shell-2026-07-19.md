# ENT-UI-012 Web 访客参会壳实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`

## 1. 本批交付

- 新增公开 `/join/:meetingId` 路由，优先于成员应用匹配并完全位于 `AuthProvider/AppShell` 外。
- 访客页不恢复成员账号、不请求 membership/tenant route、不展示企业导航、tenant selector 或成员数据。
- 邀请格式为 `/join/:meetingId#token=<opaque>`；拒绝 query token、非法 meeting ID/token，并立即清除 search/hash。
- URL 清理失败即拒绝；有效 token 只保留在当前 JavaScript 内存，不写 local/session storage、不显示、不记录。
- 设备卡只在访客点击后请求麦克风权限，成功后立即停止全部媒体轨道；错误只映射为有限状态。
- 屏幕共享只探测浏览器 API 能力，不在无 participant/session/lease 时调用 `getDisplayMedia`。
- 字幕和共享使用统一 Material Icons、状态和禁用控件；没有企业 meeting session 时明确 `not_ready`。
- `ENT-MTG-001/002` 未实现，本批不调用个人 Call Link guest-ticket、不发送 guest token、不连接 RTC，
  不产生任何入会成功状态。

## 2. 已执行静态门禁

```text
npm run typecheck -w @translation/enterprise-web
npm run build -w @translation/enterprise-web
npm run check:bundle -w @translation/enterprise-web
npm run check:lines
git diff --check
```

Enterprise Web Vite production build 成功；普通 bundle 扫描通过，JavaScript 352135 bytes、CSS 41207 bytes，
无 source map、敏感配置或本地 fixture 命中；文件规模门禁通过。

## 3. 本批明确未执行

按当前开发指令“测试先略过”，未运行：

- Vitest、API route、API 全量和全 Node 回归；
- Playwright 三引擎、URL/token 攻击、AuthProvider 隔离、麦克风权限或屏幕共享设备矩阵；
- 320/600/960/1280/1440、动态字体、键盘、axe 和视觉回归；
- 真实 enterprise meeting/guest token/LiveKit、PostgreSQL、Provider、真机或生产环境验证。

因此当前只能证明代码可类型检查、构建且静态 bundle 合规，不能证明 token 只访问指定 meeting，也不能满足
AC-UI、AC-MTG、A1/H2/H3 或企业生产发布门禁。`ENT-UI-012` 保持 `in_progress`。

## 4. 依赖完成后的验收顺序

1. `ENT-MTG-001` 完成 Meeting Repository/runtime、participant 与 communication session binding。
2. `ENT-MTG-002` 完成短期 guest token exchange，服务端绑定 tenant/meeting/participant/role/expiry/track permission。
3. 客户端仅把内存 token 放入 Authorization header，严格复核响应 meeting ID，不写 URL/body/storage/log。
4. 运行跨 meeting 重放、过期/撤销/伪造 token、query 泄漏、直接 URL、AuthProvider 请求隔离和浏览器设备矩阵。
