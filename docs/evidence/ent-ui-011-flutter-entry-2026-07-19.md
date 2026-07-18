# ENT-UI-011 Flutter 企业入口实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`

## 1. 本批交付

- 在个人版“我的”中增加独立“企业工作区”入口，不替换个人版五栏主导航。
- 入口复用账号 Bearer 会话，但会在每次进入时重新读取 active membership、短期签名 route document、
  `/enterprise/v1/me` scopes 和 Provider capability document。
- 单企业自动进入；多企业在没有仍有效的已选 tenant 时显式选择。tenant ID 只在完整上下文校验成功后保存。
- 客户端核对 selected/context member identity、active 状态、tenant、region、cell、route epoch、有效期、
  非本地 HTTPS/WSS URL、非空签名以及 capability region/status；任一不一致均拒绝进入。
- 401/无效或过期会话清理账号会话与 tenant 选择；离线和超时不恢复缓存工作区，也不显示乐观成功。
- 企业壳使用 Material `NavigationBar` 和 outlined/filled 图标对，提供工作台、会议、接管、告警和我的。
- 会议只向 `meeting:read` 显示，接管只向 `support:takeover` 显示；服务端 guard 仍是最终授权边界。
- 工作台和告警仅展示 tenant/route/scope/Provider 服务端真值。企业会议列表与接管队列 API 尚未完成，
  两页固定显示 `not_ready`，不回退到个人同传、Call Link 或 AI 代打。

## 2. 已执行静态门禁

```text
dart format apps/mobile/lib/src/features/enterprise apps/mobile/lib/src/features/shell/presentation/pages/settings_home_page.dart
(cd apps/mobile && flutter analyze)
npm run check:lines
git diff --check
```

`flutter analyze` 返回 `No issues found`。文件规模门禁要求生产源码不超过350行，入口状态机拆分后满足门禁。
一次从仓库根目录发起的宽范围 `flutter analyze` 误包含未安装依赖的独立
`test-apps/iphone14_model_tester`，只产生该测试 App 的既有依赖错误，未作为本任务门禁；随后按移动端 package
边界执行上述命令并通过。

## 3. 本批明确未执行

按当前开发指令“测试先略过”，未运行：

- Flutter unit/widget/integration test；
- Flutter build、安装、模拟器或真机；
- 动态字体、VoiceOver/TalkBack、横竖屏、弱网和离线真机矩阵；
- API、全 Node、PostgreSQL、Provider、Beelink 或生产 App 验证。

因此静态分析不能证明五入口运行时、九角色 scope、离线/401、路由篡改、动态字体或真机交互已通过。
`ENT-UI-011` 保持 `in_progress`，不能宣称 AC-UI、A1/H2/H3、企业试点或移动端生产放行通过。

## 4. 恢复测试后的验收顺序

1. 增加并运行 API client 的正常、401、超时、跨 member/tenant/region/cell、过期 route 和 Provider region 负测。
2. 运行九角色 widget matrix，验证会议/接管入口发现、直接状态和 tenant 切换。
3. 在 iOS/Android 模拟器与目标真机运行动态字体、横竖屏、VoiceOver/TalkBack、弱网/离线恢复。
4. 企业会议和接管 tenant-scoped API 完成后，用真实服务端 guard 替换 `not_ready`，再进入 A1 验收。
