# ENT-MTG-012 屏幕 OCR 翻译实现与静态门禁证据

- 日期：2026-07-19
- 分支：`codex/enterprise-edition`
- 任务状态：`in_progress`（代码候选与静态门禁完成，自动化及真实环境验收未执行）

## 1. 本轮交付

- 新增 `wujie.enterprise.meeting.screen_ocr.v1` 契约，覆盖按参会者启停、目标语言、显示模式、run/subscription 和定向 layout event。
- 新增 `0026_enterprise_meeting_screen_ocr` 可逆迁移：五张 tenant-scoped 表、复合外键、forced RLS、append-only command/block 和 frame 单向状态约束；数据库、API 和日志均不保存原始屏幕帧。
- 新增 API/Repository/Worker runtime：短期 HMAC ticket 绑定 tenant、cell、route epoch、meeting、share generation、publisher 和 track；订阅、租约或路由失效后 fail closed。
- Worker 使用 `SUBSCRIBE_NONE`，只订阅 ticket 指定的当前屏幕视频轨；1至2秒采样，服务端 pHash claim 后才调用显式 HTTPS OCR Provider，并将已认领帧写入不可变 `screen_ocr_frames` usage ledger。
- Web/Flutter 默认关闭，只消费服务端返回且匹配当前 participant/share/generation/run/revision 的布局；按真实 contain 内容矩形支持原图、译图和双语显示。data channel 失败回退 API polling，Provider/调度未配置或失败不影响原屏幕共享和字幕。
- `screen.ocr` 已纳入 Provider readiness 和环境变量示例；未配置时返回明确降级，不伪造 OCR 成功。

## 2. 安全与数据边界

- 公共启停接口复用 tenant context、会议活动参会关系、entitlement 和幂等约束；内部接口要求 Worker ticket 并复核当前 subscription、share lease、generation、publisher、track、cell 与 route epoch。
- command 外键同时绑定 subscription 的 tenant/meeting/share/run，避免跨 run 复用订阅；相同语言订阅者可共享 run，无订阅的旧 run 被结束。
- 原始 RGBA 只存在于 Worker 到已配置 Provider 的单次内存请求中；持久化仅保留尺寸、感知 hash、状态、Provider fingerprint 和规范化文本块/坐标。
- 布局事件为参会者定向数据；Web/Flutter 对 meeting、participant、share、generation、run、revision 和 payload 大小执行严格校验。

## 3. 2026-07-19 静态门禁

- Contracts、API Server、Translation Worker、Enterprise Web `typecheck`：通过。
- Enterprise Web `typecheck:e2e`：通过；仅做 TypeScript 编译检查，未运行 Playwright。
- Flutter `analyze`：通过，`No issues found`。
- Contracts、API Server、Translation Worker、Enterprise Web 生产构建：通过。
- Enterprise Web 非 release bundle 检查：通过；9 files，entry JavaScript 420209 bytes，JavaScript 889470 bytes，CSS 53669 bytes。
- 文件大小门禁与 `git diff --check`：通过。
- migration loader：通过；26 migrations，最后一段 `0026_enterprise_meeting_screen_ocr`，66 tenant tables，27 subject columns，checksum `ada853824bca9bdeca95414eb89885f1e6a9c647ffa0cb1f529b4eb63b29c482`。

## 4. 本轮明确未运行

按当前开发指令，本轮未运行单元、API、Repository、migration、forced-RLS、跨租户/RBAC、并发、Playwright、Flutter 测试，也未连接真实 PostgreSQL、Provider、LiveKit、浏览器或真机。未执行真实帧 hash/坐标/容量、Provider 429/超时/畸形响应、旧 generation 迟到、租约/route epoch 回收和恢复矩阵。

## 5. 结论

`ENT-MTG-012` 的代码候选与静态门禁已完成，但保持 `in_progress`。本证据不代表 A1、H3、staging PostgreSQL、真实媒体或企业生产门禁通过。
