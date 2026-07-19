# ENT-MTG-013 日历 Adapter 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`；代码候选与静态门禁完成，自动化和真实环境验收未执行

## 1. 本次交付

- 新增 `0027_enterprise_meeting_calendar_sync` 可逆迁移：单会议/Provider 唯一记录、复合 tenant FK、forced RLS、
  不可变请求和单向终态 trigger，并登记进 schema verify 清单。
- 新增主持人 GET/POST API。写命令要求 `meeting:write`、签名 route、实时 `calendar.meetings` readiness、未来
  `scheduled` 状态、meeting version、tenant binding 和 `Idempotency-Key`；客户端不能提交 tenant、标题、时间、
  Provider event ID 或加入链接。
- API 同一 unit-of-work 写 sync、AES-256-GCM 密文 outbox 与 audit；Worker 同一 unit-of-work 写 Provider receipt、
  outbox finalize 与 audit。标题、起止时间和成员加入 URL 不以明文 outbox payload 保存。
- 首个 Provider 为 tenant-bound Google Workspace service account：JWT 使用 `calendar.events` scope，创建稳定
  base32hex-compatible event ID；POST 409 后 GET 并核对 private meeting/sync 标记，匹配才收敛为成功。
- Google 事件不创建 Google Meet、不添加 attendee、不携带 guest token。Provider 成功必须返回 event ID、etag、
  HTTPS web URL 和响应 hash；缺配置或异常不伪造成功。
- 提供可注入 mock 和未执行的 contract test 定义；同一 payload 重试的 mock 只保留一个 Provider 事件。
- Web 新增预约时间和 Material `event/sync/open_in_new` 日历卡；Flutter 使用同一 `event/sync` 语义，pending 有界轮询，
  成功后安全复制服务端验证链接。两端只向未来预约会议主持人显示入口，访客邀请保持独立。

Google Calendar 行为依据官方 `events.insert`、创建事件、错误处理和 service-account 文档：

- <https://developers.google.com/workspace/calendar/api/v3/reference/events/insert>
- <https://developers.google.com/workspace/calendar/api/guides/create-events>
- <https://developers.google.com/workspace/calendar/api/guides/errors>
- <https://developers.google.com/identity/protocols/oauth2/service-account>

## 2. 静态门禁

- contracts typecheck：通过。
- API typecheck 与 build：通过；迁移 SQL 已复制到构建产物。
- Enterprise Web typecheck、E2E TypeScript typecheck 与 production build：通过。
- Web bundle 检查：通过；9 files，entry JavaScript 425328 bytes，JavaScript 894589 bytes，CSS 54272 bytes。
- Flutter `analyze --no-pub`：通过，0 issues；新增/修改 Dart 文件 format check 无变化。
- migration loader：通过；27 migrations，最后一段 `0027_enterprise_meeting_calendar_sync`，67 tenant tables，
  28 subject columns，最后一段 checksum `c51e656736ad2a63fb34fadf51b36d20467d601a93582fa0c8ada7dbb53a7ba1`。
- 文件大小门禁：通过；`git diff --check`：通过。

## 3. 未执行和未放行

按本轮要求未运行 Node/Flutter unit、API、Repository、migration、forced-RLS、contract、Playwright 或真机测试；
也未连接真实 PostgreSQL、Google Workspace 管理域、service account、Provider health、Worker 集群、浏览器或设备。
因此没有验证 domain-wide delegation、真实 409/响应丢失、事务崩溃恢复、并发幂等、跨租户攻击、浏览器布局和真机轮询，
不能宣称 `accepted`、Google Calendar 生产可用、PostgreSQL 企业试点通过或企业生产门禁通过。
