# ENT-MTG-003 企业实时翻译实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`（代码候选；测试和真实环境验收未执行）

## 1. 本批交付

- enterprise migration `0023`：participant 字幕语言、译音偏好、playback generation，forced-RLS append-only target translation events。
- tenant-aware translation dispatch：policy/readiness snapshot、v3 ticket、capacity lease、LiveKit agent dispatch、真实 heartbeat 和短期 ticket refresh。
- 内部 Worker API：snapshot、heartbeat、refresh、final events、finalize；每一步重新验证 ticket、tenant、cell、route epoch、generation、policy、lease 和 meeting binding。
- Translation Agent：每个 `participantId + trackSid` 独立 ASR/翻译管线；普通 Worker 不持有 PostgreSQL 凭证。
- 定向事件：先按 tenant/meeting/target 幂等落库，再用固定 topic 和单一 LiveKit destination identity 发布。
- Web/Flutter：入会前个人字幕语言和译音偏好；只接受 server-sent 且 meeting/session/target/generation/playback generation 全匹配的 final 字幕，eventId 去重并限制窗口。
- 显式降级：定向 TTS 未实现，`translatedAudioAvailable=false`、事件状态 `not_ready`，Worker 禁用 TTS，未发布全局译音轨。
- 独立 Worker 启动入口：`scripts/start_enterprise_meeting_translation_worker.sh`，要求内部密钥和 LiveKit 配置，不接收数据库凭证。

## 2. 关键安全和一致性边界

1. tenant context 只从服务端验证后的 v3 ticket 派生，Worker body 不能选择 tenant。
2. source participant 必须在同一 meeting 已加入且未离开；target 只来自同租户 active participant 查询。
3. 同一 grant/source track/target/segment/revision 的内容重放只允许相同 hash；改写文本产生冲突。
4. LiveKit 客户端 participant 发送的数据包被 Web/Flutter 拒绝；服务端只向精确 target identity 发送可靠数据。
5. translation runtime 不就绪不阻断基础音频入会，但 join grant 必须明确返回 `not_ready + reasonCode`。
6. heartbeat 不再误调用 accept；accepted grant 只在 policy readiness 有效期内轮换短期 credential。

## 3. 已执行静态门禁

| 门禁 | 结果 |
| --- | --- |
| 全仓 TypeScript typecheck | 通过；包含 contracts、API Server、Translation Worker、Enterprise Web 及其余 Node workspaces |
| Enterprise Web E2E 源码 typecheck | 通过；仅编译 Playwright 源码，未执行浏览器测试 |
| Enterprise Web production build | 通过；Vite 转换125个模块 |
| Enterprise Web 非发布 bundle 扫描 | 通过；入口 JS 368,436 B、总 JS 837,661 B、CSS 44,547 B；未要求发布元数据 |
| Flutter enterprise `analyze` | 通过；依赖工具同时报告若干可升级包和 LiveKit/flutter_webrtc 尚未支持 Swift Package Manager 的非阻断提示 |
| Worker 启动脚本 `bash -n` 与 help | 通过；未启动 Worker 或连接外部 Provider |
| 全仓 lint / 文件规模门禁 | 通过；所有受检源文件不超过350行 |
| `git diff --check` | 通过 |

## 4. 明确未执行和未通过的门禁

按本轮指令不运行测试，因此以下均未执行，不能视为通过：

- unit、API、Repository、contract、Playwright、Flutter test 和全 Node 回归；
- `0023` PostgreSQL up/down、普通角色 forced-RLS、复合 FK、并发和恢复；
- 两租户/四人真实 LiveKit 音频、错 target、ticket 篡改/过期、旧 route/generation、事件重放和 Worker/API 重启矩阵；
- 真实 ASR、翻译、LiveKit Agent/dispatch Provider；
- Web 三浏览器、axe、视觉回归、弱网，以及 iPhone/Android 真机；
- per-target TTS 音轨、订阅授权、抢话和旧播放 generation 验收；
- staging 31+23 migration/cutover/restore/PITR 和企业生产门禁。

因此 `ENT-MTG-003` 只进入 `in_progress`，AC-MTG-006..012 与 A1 未通过，也未宣称 PostgreSQL 企业试点或生产可用。
