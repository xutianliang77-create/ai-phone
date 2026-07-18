# ENT-MTG-005 Web 屏幕共享实现与静态门禁证据

日期：2026-07-19
状态：`in_progress`，代码候选已完成，真实验收未执行

## 实现范围

- 成员 Web 会议页在用户点击后调用 `getDisplayMedia`，禁用系统音频，并从实际 `displaySurface` 严格映射
  screen/window/tab；来源缺失或未知时停止临时采集且不申请租约。
- 屏幕使用独立于麦克风会议连接的 LiveKit Room 和 `ENT-MTG-004` generation 专属最小权限 grant；只发布
  `Track.Source.ScreenShare` video track，不发布 microphone、camera、data 或 system audio。
- 发布成功立即以服务端返回的 track SID renew，之后每10秒续租。API 响应严格校验 meeting/share、RTC URL、
  room、publisher identity、generation、token、有效期和能力集合。
- 主会议 Room 只接受服务端 current share 指定 identity 的 `screen_share` publication；暂停、结束或 generation
  变化立即清除旧画面，独立屏幕 publisher 不计入参会者人数。
- 页面沿用企业 Material 3 令牌和 Material Icons，展示真实来源、质量、generation、共享画面及开始/暂停/恢复/停止。
  pause 保留 capture 但撤销旧发布；resume 使用新 generation；stop、离会和浏览器原生 track ended 先结束本地媒体。
- Provider 撤销返回 pending 时复用同一幂等键有界重试，界面保持“正在停止/暂停”；耗尽后由服务端 outbox 继续，
  不伪造已停止。屏幕帧不写 API、数据库、日志或对象存储。
- 访客发布、系统音频、iOS/Android、simulcast、主持人强停和 OCR 不属于本任务。

## 静态门禁

- 根目录 `npm run typecheck`：全部 TypeScript workspace 通过。
- `npm run typecheck:e2e -w @translation/enterprise-web`：Playwright TypeScript 静态编译通过，未执行用例。
- `npm run build -w @translation/enterprise-web`：通过；LiveKit 保持独立延迟加载 chunk。
- `npm run check:bundle -w @translation/enterprise-web`：通过；非 release 模式，entry JavaScript 388137 bytes，
  全部 JavaScript 857373 bytes，CSS 46339 bytes。
- `npm run lint`：通过；文件规模门禁通过，受影响 TypeScript 文件均不超过350行。
- `git diff --check`：通过。

## 明确未执行

按本轮“测试先略过”要求，未运行 unit/API/Repository、全 Node 回归、Playwright/axe/视觉测试；未连接真实 LiveKit，
未验证多浏览器 screen/window/tab、权限拒绝、原生停止、暂停恢复、弱网/重连、两人竞争、旧 generation 迟到、
首帧/撤销时延或长期续租。

因此本证据不能证明 AC-SHARE-001/003/005/006/007/009/010、A1、H1/H2/H3 或企业生产门禁通过，
`ENT-MTG-005` 继续保持 `in_progress`。
