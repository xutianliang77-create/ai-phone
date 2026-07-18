# ENT-MTG-004 屏幕共享租约实现与静态门禁证据

日期：2026-07-19
状态：`in_progress`，代码候选已完成，真实验收未执行

## 实现范围

- 共享 contracts 增加 source/quality/status、lease DTO、acquire/control/renew 请求和最小权限发布 grant。
- enterprise migration `0024_enterprise_meeting_screen_share_leases` 增加 communication binding、route epoch、
  generation、acquire 幂等/hash、严格生命周期约束、append-only 命令账本、forced RLS 和 cell pending-work。
- PostgreSQL Repository/runtime 实现 current、acquire、pause、resume、renew、stop，使用 tenant/meeting 行锁、
  expected-version CAS、幂等命令账本、单会议活动租约唯一约束和租户并发 entitlement。
- API 要求 Bearer、active membership、`meeting:read`、签名 route document 和 mutation `Idempotency-Key`；
  participant role、meeting policy、communication binding、route epoch 和 entitlement 在服务端重读。
- 发布 identity 按 share generation 隔离；LiveKit grant 只允许 `SCREEN_SHARE` 和经独立 entitlement 允许的
  `SCREEN_SHARE_AUDIO`，禁止 microphone、camera、data 和 subscribe，TTL 不超过租约剩余时间。
- pause、stop、route fence 和到期均生成幂等撤销 outbox。cell Worker 在客户端停止续租后自行把租约收敛为
  expired，并由专用 outbox publisher 幂等调用 LiveKit `removeParticipant`；404 视为已完成，未配置或失败保持 retry。
- 屏幕帧不写数据库或对象存储；Web/iOS/Android 采集、系统音频处理、主持人 force-stop UI、simulcast 和 OCR
  不属于本任务，继续由 `ENT-MTG-005..010/012` 实现。

## 静态门禁

- `npm run typecheck -w @translation/api-server`：通过。
- `npm run typecheck -w @translation/contracts`：通过。
- 根目录 `npm run typecheck`：全部 TypeScript workspace 通过。
- `npm run lint`：通过；文件大小门禁通过，受影响 TypeScript 文件均不超过350行。
- `git diff --check`：通过。
- 当前代码 manifest：公共31段、enterprise 24段、88张业务表；历史31+16或31+23签名证据不适用于本提交。

## 明确未执行

按本轮“测试先略过”要求，未运行 unit/API/Repository/Worker、全 Node 回归、Web/Flutter/Playwright 测试；
未执行 PostgreSQL migration up/down/forward、forced-RLS 双租户攻击、双 acquire/CAS、Worker 到期与重启恢复、
outbox 重放、真实 LiveKit 撤销、弱网、浏览器或真机矩阵。

因此本证据不能证明 AC-SHARE-001..010、A1、H1/H2/H3、PostgreSQL 企业试点或生产门禁通过，
`ENT-MTG-004` 继续保持 `in_progress`。
