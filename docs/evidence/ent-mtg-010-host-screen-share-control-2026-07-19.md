# ENT-MTG-010 主持人共享控制实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`；仅代码候选与静态证据，不是 RBAC 攻击、真实 LiveKit、浏览器/真机或生产验收

## 1. 本次实现

- 新增 `POST /enterprise/v1/meetings/:meetingId/screen-shares/:shareId/force-stop`；只接受 expected version 和
  idempotency key，不接受 tenant、actor、role、participant 或 generation 覆盖字段。
- 路由强制 `screen_share:stop`，PostgreSQL runtime 再重读当前 meeting 活动参会者；目标 share 继续按 tenant +
  meeting + share 复合范围读取，客户端按钮不是授权真值。
- 强停复用 `0024` append-only ledger 的 stop CAS：把 active/paused share 置为 ended、清空 track SID/lease、递增
  version/generation。`force_stop` 请求 hash 与普通 stop 不共享幂等语义；审计为
  `meeting.screen_share.force_stop`，状态 outbox 为 `meeting.screen_share.force_stopped`。
- 被撤销的旧 generation 立即调用 LiveKit removeParticipant，同时写持久 `meeting.screen_share.revoke.requested`
  outbox；Provider 未配置/超时/失败返回 pending，数据库 fence 不回滚，也不伪造完成。
- Web/Flutter 只在 workspace 含 scope 且目标是他人的 active/paused share 时显示高关注操作。确认框展示目标
  participant、generation 和撤销影响；pending 保持停止中并以原 key 最多有界重试三次。
- Flutter current-share DTO 接受并保留远端真实 `includesSystemAudio` 布尔值，使移动主持人能控制 Web 系统音频共享；
  移动端自己的发布 grant 仍严格要求 `screenShareAudio=false`，没有扩大移动采集能力。
- 为保持350行生产文件门禁，把共享 outbox/audit 记录和 Web revocation retry 拆为单一职责模块；未改变普通
  acquire/pause/resume/renew/stop 语义。

## 2. 静态门禁

本轮按用户要求跳过 unit、API、Repository、migration、Playwright、Flutter test 和真实媒体测试。执行并通过：

- `flutter analyze --no-pub`
- 全仓 `pnpm typecheck`
- 全仓 `pnpm lint`（含生产文件不超过350行门禁）
- Enterprise Web `typecheck:e2e`
- Enterprise Web 生产 build
- Enterprise Web 非 release bundle 检查（9 files，entry JS 395717 bytes）
- `git diff --check`

## 3. 未完成门禁

- 未执行 owner/admin/meeting_host/member/auditor/guest × 自己/他人 × 同租户/跨租户/跨 meeting 的 API 矩阵。
- 未执行相同 key/hash 重放、不同 hash 冲突、stop/force-stop CAS 竞争、旧 renew/resume 迟到或 API/Worker 重启恢复。
- 未连接真实 LiveKit 验证500ms撤销目标、404/超时/失败、持久 outbox 重试和旧 publisher/track 永不恢复。
- 未执行 Web/Flutter 确认、重复点击、离线、动态权限回收、多浏览器或移动真机矩阵。
- 未通过 AC-SHARE-004、A1、H1/H2/H3 或企业生产门禁。
