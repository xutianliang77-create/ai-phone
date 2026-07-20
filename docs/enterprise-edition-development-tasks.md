# 无界AI企业版开发任务

版本：v1.67
日期：2026-07-20
状态：E0 开发中，已对齐统一通讯平台和 PostgreSQL Primary 收敛

## 1. 状态定义

- `todo`：未开始。
- `in_progress`：开发或自动化尚未结束。
- `blocked`：仅限真实外部账号、法律确认或硬件阻塞。
- `ready_for_acceptance`：代码和自动化完成，等待真实验收。
- `accepted`：完成定义和验收证据全部通过。

任务已有设计稿或静态原型但生产代码、自动化或环境证据未完成时，状态仍为 `in_progress`，不能进入 `ready_for_acceptance`。

### 1.1 当前状态快照

- `ENT-CORE-001/002/003` 已完成代码和自动化，等待验收；生产 Web 应用位于 `apps/enterprise-web`。
- `ENT-DATA-001` 已有四十七段 PostgreSQL up/down migration、tenant-first 索引、复合 FK、强制 RLS、checksum/锁和备份归档 smoke；`0017..0034` 延续既有知识、会议、客服 Agent/Tools、高风险接管和坐席 claim，`0035..0041` 增加客服后续动作/质检及 Campaign、Lead、Consent、Suppression、Country Policy，`0042/0043` 增加不可变活动校验/审批快照和执行栅栏，`0044` 增加 Scheduler claim/lease/hold 栅栏，`0045` 增加 scoped PSTN dispatch、Provider/Webhook 状态证据和任务转换硬栅栏，`0046` 增加 Marketing Agent profile/run/turn 栅栏，`0047` 增加审批冻结的人工接管策略、桥接证据和超时收敛栅栏。历史本地 PostgreSQL 16 验证不替代当前31+47 staging migrate/restore/PITR 证据，任务保持 `in_progress`。
- `ENT-DATA-002` 已完成单一 `legacy|postgres` Enterprise Repository runtime adapter，Tenant/Member/Audit、Directory、lifecycle 和 HTTP 路由均通过同一 runtime；PostgreSQL 只有在启动 schema gate 已验证时才允许选中，不存在 fallback、双写或局部切换。独立 cell Worker 已实现 cell/worker/poll/batch/lease 配置、forced-RLS pending discovery、tenant transaction 二次复核、lifecycle/outbox claim/finalize、失败隔离和显式 publisher 降级。代码与本地自动化完成，进入 `ready_for_acceptance`；真实 PostgreSQL、并发 claim、容量和恢复证据仍属于 H3 门禁。
- `ENT-DATA-004` 已实现 JSON/SQLite 六类企业记录源读取、SQLite 临时副本与 `quick_check`、维护窗口空目标导入、事务内读回，以及逐集合 count/SHA-256 和总 hash 对账；任何不一致整体回滚。该工具只迁移当前 Tenant/Member/Job/Audit/Inbox/Outbox 演示数据，不是客户生产迁移通道，进入 `ready_for_acceptance`。
- `ENT-DATA-003` 已完成 tenant-scoped inbox 去重、稳定 JSON hash、领域写入/inbox/outbox 同事务、outbox 内容不可变、lease claim、指数退避和恢复处理；100 次相同事件重放只执行一次领域副作用，跨租户 provider ID/idempotency key 相互隔离。SQLite 证据仅用于自动化和封闭演示，真实 PostgreSQL 并发 claim 与 Provider sandbox 仍待正式验收。
- `ENT-DATA-007` 已把上游稳定提交 `fe1c3c2` 的公共 Primary Runtime 纳入企业分支，并以 `API_STORAGE_DRIVER` 作为唯一进程级 driver。统一启动编排现验证公共31段和 enterprise 47段 manifest，核对数据库 name/OID 后才创建企业 runtime；API tenant pool 复用公共 Primary pool，directory、cell、migration 和 maintenance 使用分权连接配置，Worker 不获取 directory 凭证。代码和本地自动化完成，进入 `ready_for_acceptance`；真实 PostgreSQL 双 manifest、最小权限角色、并发和恢复证据仍属于 H3。
- `ENT-OBS-001` 已进入开发：平台 `x-trace-id` 现注入 Enterprise TenantContext 和 PostgreSQL `app.trace_id`，`0019` 把会话绑定、usage event 与不可变 ledger 的 trace 固化并建立 tenant-first 索引；新增按 tenant scope 的会话报告契约/API，返回真实 segment 覆盖率/延迟、Provider operation、usage/ledger 和关联审计。当前无单位价格表，货币成本固定返回 `pricing_not_configured`，不把用量冒充金额。按本轮要求尚未执行测试矩阵、migration 和双租户负测，状态保持 `in_progress`。
- `ENT-DATA-008` 已新增公共 migration `031_communication_resource_scope`：session、leg、transcript、playback、Provider operation、dispatch/capacity、participant consent、recording 和 ingress 共12张表具有不可空 `scope_type + scope_id`、复合 scope FK、写入 scope trigger 和 forced RLS。企业 tenant transaction 同时设置 `app.tenant_id/app.scope_type/app.scope_id`，只向企业 unit-of-work 暴露六类白名单、单 SELECT、显式 scope predicate 的通讯 Repository；跨租户返回行会被二次拒绝。代码和本地自动化完成，进入 `ready_for_acceptance`；真实双租户 PostgreSQL CRUD/迟到事件攻击仍属于 A1/H3。
- `ENT-DATA-009` 已实现动态双 manifest、全业务表主键分页整行 count/SHA-256、关键 tenant/session/ledger/audit/consent/suppression/country-policy/approval/PSTN dispatch/Marketing Agent/object 清单、WAL 水位、HMAC baseline/cutover/restore evidence、源库 SQLSTATE `25006` writer fence、旧 writer 会话清退和 production startup 身份绑定。提交 `c9b5be2` 的历史本地证据覆盖公共31段/企业16段与81张表；当前代码为31+47和124张表，旧签名证据会被 startup gate 拒绝，必须在 staging 重新生成。任务保持 `ready_for_acceptance`；跨故障域自动选主、异地主机不可变 WAL/PITR 和 RPO/RTO 仍待 `ENT-REL-003`/H3。
- `ENT-CORE-004` 已新增 enterprise `0017`、共享契约、tenant Knowledge Repository/runtime 和七个服务端路由：source、递增 revision、一次性 chunk 集、review、publish、列表和检索均绑定 membership/RBAC/route document。服务端生成 chunk/content SHA-256 与 citation；数据库要求 review+非空 chunk 才能发布，并冻结 published version/chunk。检索强制 tenant/locale/country/product/effective-time，只取每个 source 最新有效 published revision；review、过期和跨租户数据返回空。代码、定向矩阵及一次性 PostgreSQL 16 普通角色 forced-RLS/down-up 验证完成，进入 `ready_for_acceptance`；embedding Provider、真实对象存储、恶意文档扫描和生产 A1/H3 尚未验收。
- `ENT-CORE-005` 已新增 enterprise `0018`、共享契约、Term Pack/Script Template Repository/runtime 和十三个服务端路由。稳定资源下的 revision 由服务端行锁递增，内容规范化后生成 SHA-256，review 后内容/hash 与 published 版本不可修改；resolver 强制 tenant/source-target locale/country/product/purpose/effective-time，只返回有效 published 版本，并给 ASR、翻译、LLM 同一 `termPackVersionId`，可选话术只给 LLM。代码、定向矩阵和一次性 PostgreSQL 16 非 owner/非 BYPASSRLS 普通角色 down-forward 验证完成，进入 `ready_for_acceptance`；真实 Worker/Provider、A1/H3 尚未验收。
- `ENT-CORE-009` 已完成租户创建/区域开通幂等、失败重试、暂停、导出和删除执行器；导出固化 tenant/member/job 与 actor scope 快照，执行使用租约、有界重试和 receipt hash，删除只在 receipt 校验后进入 `deleted`，等待真实生命周期服务与对象存储验收。
- `ENT-CORE-011` 已完成按 active membership 签发短期 HMAC route document、route epoch 签名、公开端点校验和企业写入区域 guard，等待正式域名/密钥验收。
- `ENT-CORE-013` 已新增 enterprise `0011` 统一会话绑定表和事务型 Repository：Meeting/Support/Marketing 使用同一 tenant-scoped 公共 session，数据库复合 FK 固定唯一业务归属，route epoch、policy/entitlement 版本和区域快照不可变。状态机覆盖 dispatch/ready/active/degraded/draining/terminal，使用 version、generation 和 event sequence 拒绝旧路由、旧 Worker、重放与非法倒退；代码、定向矩阵和一次性本地 PostgreSQL 16 普通角色 RLS/down-up 验证完成，进入 `ready_for_acceptance`，不代表 A1/H3 或生产门禁通过。
- `ENT-CORE-014` 已新增 enterprise `0012` Worker dispatch grant、短期 HMAC ticket 和运行时 Adapter。签发从当前 binding 派生 tenant/session/cell/route epoch/generation/capability，capacity reserve 与 dispatch/grant 原子提交；accept/heartbeat/副作用授权/finalize 都重读 binding/grant/lease，cancel 同事务释放容量，旧 route/generation 和迟到结果失败闭合。代码、负向矩阵和一次性本地 PostgreSQL 16 普通角色验证完成，进入 `ready_for_acceptance`，不代表真实多实例、H3 容量或生产门禁通过。
- `ENT-CORE-015` 已新增 enterprise `0013` 通讯策略版本、purpose-specific 授权证据和不可变运行快照，发布 API 由 `tenant:write` 与签名 route document 双重保护；device/cloud ASR、翻译、TTS 依据有效 readiness/fingerprint 解析，声纹、录音和诊断音频无独立有效授权即禁用。Worker ticket v2 绑定 policy snapshot/version，签发与 lifecycle 都对失效快照、过期 readiness、未允许 capability 和撤回授权失败闭合。代码、负向矩阵和一次性本地 PostgreSQL 16 普通角色 RLS/down-forward 机制验证完成，进入 `ready_for_acceptance`；不代表真实设备/Provider、A1/H2/H3 或生产门禁通过。
- `ENT-MTG-006` 已形成 iOS ReplayKit 代码候选：Broadcast Upload Extension 通过 App Group Unix socket 向主 App 传递视频样本，App Group 控制清单只保存 share/generation/publisher/lease/nonce，不保存 RTC token；Flutter 使用独立最小权限 publisher Room、25秒激活超时、10秒租约续期和系统停止回收，并按会议策略守卫入口。当前只通过 Flutter/Swift/Xcode 工程静态检查，未构建或安装 App，也未执行真机、真实 LiveKit、后台、网络切换或租约攻击测试，保持 `in_progress`。
- `ENT-MTG-007` 已形成 Android MediaProjection 代码候选：Android 13+ 先取得可见通知权限，再取得一次性屏幕捕获授权；Android 14 顺序固定为授权、启动 `mediaProjection` 前台服务、发布屏幕轨。前台服务只持有 share/generation/publisher/lease/nonce，并通过通知停止、租约到期和系统投屏停止汇合到 Flutter/服务端停止状态机。当前只通过 Flutter analyze 和静态配置检查，按要求未运行测试、APK 构建、安装、真机权限/后台/网络切换或真实 LiveKit，保持 `in_progress`。
- `ENT-MTG-008` 已形成 Web 系统音频代码候选：浏览器实际返回音频轨后才申请 `includesSystemAudio=true` 租约，独立发布/订阅 `screen_share_audio`；本机不回放，活动中音频单独结束时只移除音轨并保持共享画面。企业翻译 Agent 同时要求 `ent:<participantId>:<role>` identity 和 microphone source，拒绝 `ent-share:*` 及共享音轨。iOS/Android 仍固定关闭系统音频；当前只通过静态门禁，未运行浏览器、真实 LiveKit、回声或 ASR 验证，保持 `in_progress`。
- `ENT-MTG-009` 已形成 Web/Flutter 自适应共享布局代码候选：三档画质显式配置 screen-share simulcast layers 与 dynacast；Web 保留 `RemoteVideoTrack.attach`，Flutter 使用 `VideoTrackRenderer`，把真实可见尺寸反馈给 adaptive subscription。两端提供画面优先/并排/字幕优先，窄屏/大字体自动纵向且不以 overlay 遮挡控制。当前只通过静态门禁，未运行浏览器、真机、弱网或真实 LiveKit layer 验证，保持 `in_progress`。
- `ENT-CORE-007` 已新增 enterprise `0014` tenant usage budget、usage hold 和 append-only threshold alert，并增强 `usage_ledger` 的 budget/hold/source/hash 归属。reserve 在 tenant 行锁内汇总已结算量和有效 hold，settle 只追加 ledger 并单向结束 hold；同幂等键不同 hash 拒绝，预算超限在副作用前失败闭合。代码和自动化完成，进入 `ready_for_acceptance`；真实 PostgreSQL 并发、长稳和账务抽样仍待验收。
- `ENT-CORE-010` 已新增 enterprise `0015` tenant billing account、不可变 plan version、活动 subscription 唯一约束、不可变 entitlement snapshot 和 append-only change history。套餐变更只引用服务端 plan，账期由服务端生成；communication binding/Worker ticket v3 固化 entitlement version，dispatch 从活动 account/subscription/snapshot 读取 limit，不接受客户端 `maxUnits`。代码、定向矩阵和一次性本地 PostgreSQL 16 forced-RLS/down-forward 机制验证完成，进入 `ready_for_acceptance`；未接支付 Provider，也不代表 A1/H3 或生产账务门禁通过。
- `ENT-CORE-012` 已新增 enterprise `0016` tenant usage event、event/ledger 双向一致性、append-only adjustment、目标净额非负保护和按 UTC period 重建的 count/SHA-256 hash/watermark 聚合。budget settle 已接入原始 event；租户只开放 `usage:read` 聚合列表，冲正仅限内部 runtime 并追加审计。代码、定向测试和一次性本地 PostgreSQL 16 普通角色 forced-RLS/一致性/负数 guard 验证完成，进入 `ready_for_acceptance`；未执行真实关账、支付 Provider、A1/H3 或生产账务门禁。
- `ENT-CORE-008` 已完成 PSTN/CRM/Calendar/Channel/Screen OCR 统一 capability document、实时 probe contract、敏感配置过滤和明确降级，等待真实 Provider 验收。
- `ENT-CORE-006` 已完成 append-only audit 契约、`audit:read` 查询 API、tenant/filter/sort/expiry 绑定的 HMAC cursor、成员与租户生命周期高风险结果埋点，以及 SQLite/PostgreSQL UPDATE/DELETE 拒绝约束，等待正式密钥、真实 PostgreSQL 与验收矩阵。
- `ENT-UI-001` 已完成生产颜色/字号/尺寸/圆角令牌、Material Icons 语义注册表、Flutter 对照和依赖扫描，等待验收。
- `ENT-UI-002` 已完成 active membership 租户选择、共享 role/scope 真值、九角色 route discovery、scope 导航、直接/嵌套路由 guard 及签名 route document 联调，等待验收。
- `ENT-UI-003` 已完成八态注册表、语义图标、ARIA live/alert、trace ID、可行动入口和组件矩阵，并接入服务端 Provider capability、租户生命周期 job 及 409/412 冲突映射，等待验收。
- `ENT-UI-004` 已实现企业工作台首批服务端真值投影：租户/区域、Provider capability、subscription、预算告警、不可变 ledger 账期聚合，以及按明确 session ID 查询的质量/Provider/usage/ledger trace 报告。预算只比较相同 category、unit 和 period 的服务端记录，不跨单位求和；无业务聚合、价格表或质量样本时分别显示 not_ready、not_configured 或 no_samples，不生成示例趋势。当前只完成 typecheck 和生产 Web 构建，按本轮要求未执行自动化、浏览器和 PostgreSQL 测试，状态保持 `in_progress`。
- `ENT-UI-005` 已把成员目录、现有账号加入、角色/状态编辑和九角色 scope 说明接入企业 Web。成员请求绑定 Bearer、当前 tenant 与签名 route document，body 不接受 tenant 覆盖；只读角色、直接 URL、所有者和当前账号变更入口均失败闭合，服务端 membership/RBAC guard 仍是最终授权边界。当前成员 API 只接收已注册 userId 并直接创建 active membership，不发送短信、邮件或外部 Provider 邀请；代码与自动化完成，进入 `ready_for_acceptance`，真实邀请通道、浏览器矩阵和 PostgreSQL staging 仍待后续任务/正式验收。
- `ENT-UI-006` 已把 Knowledge Source、Term Pack 和 Script Template 的稳定资源、修订、评审与发布接入企业 Web。所有请求携带当前 tenant 与签名 route document；只读角色不显示写入口，服务端仍执行 scope guard；draft/review/published/expired、loading/empty/not_ready/forbidden/conflict/failed 均使用真实响应且不回退到 SQLite/JSON。代码与自动化完成，进入 `ready_for_acceptance`；浏览器矩阵、真实 PostgreSQL staging、并发发布和外部 Worker/Provider 消费仍待正式验收。
- `ENT-UI-007` 已把企业设置拆为成员、套餐与权益、区域与数据、Provider、预算与用量五个 scope-aware 二级入口。homeRegion/cell/route epoch/retention 只读且不显示签名；Provider 只读取 capability document，不接收密钥或伪造 ready；订阅变更复用幂等键，预算更新携带 expectedVersion，用量只展示不可变 ledger 账期聚合。只读角色和直接 URL 均在发请求前受 scope guard，503 不回退到 SQLite/JSON。代码、自动化、生产构建和隔离 Chromium 1440/390px 检查完成，进入 `ready_for_acceptance`；全浏览器/无障碍矩阵、真实 PostgreSQL staging、Provider 和账务生产门禁仍待正式验收。
- `ENT-UI-008` 已接入 tenant-scoped 审计筛选、签名 cursor 翻页、脱敏列表、事件详情和显式 session 质量/用量下钻；新增真实受控导出契约、`0020` job、Repository/runtime/API、cell Worker 与加密 S3 或非生产本地 artifact store。创建必须提供目的、最长31天半开范围、1至30天保留期和幂等键；下载重新鉴权、校验 size/SHA-256 并追加审计。对象存储未配置时返回 not_ready，不生成假文件；业务聚合/货币计价仍明确未就绪。当前只完成 typecheck/构建/静态门禁，按本轮要求未执行自动化、浏览器或 PostgreSQL 测试，状态保持 `in_progress`。
- `ENT-UI-009` 已增加持久化 system/light/dark 主题、与 Flutter 对齐的浅深色令牌、可见主题/租户控件、320/600/960/1280 收敛规则、移动端可滚动带文字导航、跳至主内容、路由焦点恢复、可聚焦横向表格、表格 caption、真实按钮语义和 `rem` 动态字号。浅色风险小字使用独立 AA 前景令牌，品牌 Signal 颜色不变。当前只完成 typecheck/构建/静态门禁，未执行浏览器尺寸、200% 缩放、键盘、axe、视觉回归或真机矩阵，状态保持 `in_progress`。
- `ENT-UI-010` 已增加独立 Playwright 三引擎配置、九角色 route 矩阵、320/600/960/1280/1440 双主题截图、动态字体/键盘/axe/客户端遥测用例、固定 release matrix、生产 bundle 体积/源码映射/敏感信息/fixture/发布元数据扫描和 Node 24 CI release-candidate job。浏览器异常只在本地生成 SHA-256 截断 fingerprint，携带 path/app version/commit，经 Bearer、tenant 与签名 route document 上报；服务端拒绝额外字段并只写结构化日志。当前只完成 typecheck、生产构建和静态 bundle 门禁，按要求未运行 unit/API/Playwright/axe/视觉回归，且视觉基线未生成，任务保持 `in_progress`。
- `ENT-UI-011` 已在个人版“我的”中增加独立企业工作区入口，并实现账号过期清理、active membership 发现、显式多租户选择、短期签名 route/region/cell/scope/Provider document 重新校验，以及工作台、会议、接管、告警、我的五入口。会议只向 `meeting:read` 显示，现读取 tenant-scoped Meeting 列表、换取短期 RTC grant 并通过独立企业 LiveKit 客户端加入音频；接管仍在 API 未完成时固定 `not_ready`，会议不回退个人同传或 Call Link。离线、401、跨成员/租户/区域和无效路由均不进入工作区。当前只完成 `flutter analyze` 静态门禁，按要求未运行 Flutter test、构建、真机、动态字体或横竖屏验证，任务保持 `in_progress`。
- `ENT-UI-012` 已增加完全位于成员 `AuthProvider/AppShell` 之外的 `/join/:meetingId` Web 访客壳，不发起账号、membership 或 tenant 请求，也不渲染租户导航和成员数据。邀请只接受 `#token=` fragment，拒绝 query token、非法 meeting ID/token，并立即从地址栏清除后只存页面内存；清除失败即拒绝。访客点击入会后以加密邀请换取短期 RTC grant，客户端只开放麦克风和订阅；字幕、数据、摄像头与共享继续关闭且不回退个人 Call Link。仅完成 typecheck、生产构建、bundle 与文件规模静态门禁，token 攻击、浏览器权限和设备矩阵按要求未执行，任务保持 `in_progress`。
- `ENT-CS-010` 已形成 tenant-scoped workbench activate/read API、claim 与 Agent run cancel 原子栅栏、旧 claim 恢复栅栏、最终字幕 revision 投影、客户/知识/风险/历史聚合和同风格三栏 Web 坐席台。字幕以2.5秒只读轮询，claim 按当前时间续一个 queue lease；乱序快照不覆盖较新 lease。静音、转组、结束、工单和回呼没有安全 Provider/API 时 disabled + reasonCode，不伪造成功。当前只完成 typecheck/构建/静态门禁，按要求未运行自动化、真实 PostgreSQL/RLS、Worker/TTS、LiveKit、浏览器或真实坐席媒体，任务保持 `in_progress`。
- `ENT-CS-012` 已形成 `0036` forced-RLS 质检规则/复核/发现、`quality:read/manage`、终态会话与 Agent run 双 guard、规则/source hash 精确重放、五类确定性结构发现、最新复核 Dashboard 和同风格证据详情。语义模型未配置时 review 固定 partial/not_configured、错误回答率为 null，不以无引用率替代。当前只完成静态门禁，按要求未运行自动化、真实 PostgreSQL/RLS、浏览器、自动批处理或人工金标质量验收，任务保持 `in_progress`。
- `ENT-MKT-001` 已形成共享 Campaign 契约、`0037` 创建幂等/owner FK/状态 trigger、forced-RLS 命令幂等账本、tenant-scoped Repository/runtime、list/read/create/draft patch/aggregate schedule API 和同风格 Web 页面。三类写命令同键同 hash 精确重放；schedule 需要 `campaign:approve`，且未审批、非 approved、无 policyVersion 或无未来 startAt 均失败闭合；成功也不创建 task 或调用 PSTN。当前只完成静态门禁，自动化、真实 PostgreSQL/RLS、浏览器、线索/策略/审批/Scheduler/Provider 均未验收，任务保持 `in_progress`。
- `ENT-MTG-001` 已增加 `0021` Meeting 聚合约束、Meeting/Participant/Artifact 领域记录与状态机、tenant-scoped PostgreSQL Repository、统一 runtime adapter 和可恢复聚合读取。meeting CAS 只允许 scheduled→provisioning→active→ending→ended 及受控取消/失败；参与者身份强制 user/external XOR、host 与 meeting host 一致，artifact 类型/发布状态受约束；聚合同时返回唯一 communication binding，重启恢复读取 provisioning/active/ending。当前未运行 migration、RLS/并发/恢复测试，任务保持 `in_progress`。
- `ENT-MTG-004` 已增加 `0024`、单会议活动租约唯一约束、append-only 命令账本、acquire/pause/resume/renew/stop 幂等 CAS、route/entitlement/participant fence、代际发布 identity 和仅屏幕源 LiveKit grant。cell Worker 依据 forced-RLS pending-work 到期回收并通过 outbox 幂等移除旧发布者；Provider 未配置或撤销失败返回 pending，不伪造完成。当前按要求未运行 migration、Repository/API/Worker、并发、forced-RLS 或真实 LiveKit 测试，任务保持 `in_progress`。
- `ENT-MTG-005` 已在成员 Web 会议页实现 `getDisplayMedia` 用户授权、真实 screen/window/tab 识别、独立最小权限发布房间、首次 track SID 绑定和10秒租约续期；主会议房间只渲染服务端当前 generation 指定 identity 的 screen track。暂停、恢复、停止和浏览器原生停止均先收敛本地媒体，撤销 pending 不伪装为已停止。当前按要求未运行 unit/API/Playwright、多浏览器、弱网或真实 LiveKit 测试，任务保持 `in_progress`。
- `ENT-MTG-010` 已增加独立 force-stop API、`screen_share:stop` guard、当前 meeting 活动参会者复核、stop CAS/generation fence、强停审计与状态 outbox，以及 Web/Flutter 带 participant/generation 影响确认的高关注操作。Provider 撤销 pending 时状态不回滚、不显示假成功，由原幂等键有界重试和持久 outbox 收敛。当前按要求未运行 API/RBAC/跨租户、CAS/重放、真实 LiveKit 500ms 撤销或浏览器/真机测试，任务保持 `in_progress`。
- `ENT-MTG-002` 已形成创建/列表/详情、访客邀请、成员/访客入会 API，创建在同一 PostgreSQL 事务内写 Meeting、host、communication binding、audit 和 outbox，并用 tenant+creation key 拒绝不同请求重放；邀请也以 tenant+meeting+key/hash 幂等，重放不重复创建 participant。邀请采用 AES-256-GCM 短期密文并绑定 tenant/meeting/participant/role/expiry；RTC grant 绑定 tenant/meeting/session/participant/role，只允许麦克风发布和订阅。Web 成员/访客与 Flutter 成员入口使用独立企业 LiveKit 客户端；密钥、route、policy、entitlement 或 Provider 缺失均明确 not_ready。当前未运行 API、RBAC/跨租户、token 攻击、PostgreSQL、浏览器或真机测试，任务保持 `in_progress`。
- PostgreSQL runtime、cell Worker 和演示数据导入对账代码已接通，但尚未在真实 PostgreSQL 上执行 migrate/import/reconcile、并发租约、恢复或容量门禁，不能据此宣称企业试点或生产可用。受控审计导出已实现到期拒绝和对象过期元数据，但物理删除、对象清单对账、Provider 删除收敛仍属于 `ENT-REL-002`；会议/客服/营销业务聚合和外部 Provider 仍未通过实现或真实环境门禁。
- 主产品稳定提交 `fe1c3c2` 已作为 `ENT-DATA-007` 基线合入企业分支；后续个人工作区 WIP 仍不得直接进入企业提交。公共通讯 tenant scope 已完成本地代码门禁，切换/对账证据仍由 `ENT-DATA-009` 完成，主产品 staging 结果不能继承为企业验收证据。

## 2. P0 企业公共底座

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-CORE-001 | Tenant 和 Member | 无 | tenant/member schema、Repository、API | 所有企业资源强制 tenant scope | ready_for_acceptance |
| ENT-CORE-002 | RBAC | CORE-001 | 角色、scope、服务端 guard | 越权矩阵全部拒绝 | ready_for_acceptance |
| ENT-CORE-003 | 企业 Web 应用基础 | CORE-001/002 | 技术选型、应用脚手架、登录会话、路由和构建 | 干净环境可构建；登录失败不进入壳；不包含模型/Provider 地址 | ready_for_acceptance |
| ENT-CORE-004 | 企业知识版本 | CORE-001 | source/version/chunk/publish | 未发布和过期知识不可检索 | ready_for_acceptance |
| ENT-CORE-005 | 企业术语和话术 | CORE-004 | term pack、script template | ASR/翻译/LLM 使用同一版本引用 | ready_for_acceptance |
| ENT-CORE-006 | 审计事件 | CORE-001 | append-only audit API | 高风险操作都有 actor/target/result | ready_for_acceptance |
| ENT-CORE-007 | 企业用量与预算 | CORE-001 | ledger category、budget、alert | 重试不重复 hold/settle | ready_for_acceptance |
| ENT-CORE-008 | Provider readiness | 无 | PSTN/CRM/Calendar/Channel capability | 缺配置明确 not_ready，不伪造成功 | ready_for_acceptance |
| ENT-CORE-009 | SaaS 租户生命周期 | CORE-001 | signup/provision/suspend/export/delete saga | 重试不重复租户，失败不标 active | ready_for_acceptance |
| ENT-CORE-010 | 套餐和 Entitlement | CORE-001/007 | tenant billing account、plan、subscription、seat、entitlement | 服务端按 tenant 和版本执行权益、限额和归属 | ready_for_acceptance |
| ENT-CORE-011 | Tenant Directory | CORE-009 | homeRegion/cell、签名 route document | 区域错误时拒绝业务写入 | ready_for_acceptance |
| ENT-CORE-012 | SaaS 计量聚合 | CORE-007/010 | tenant usage event、账期聚合、调整流水 | 不修改原始 ledger，企业账单按 tenant account 可对账 | ready_for_acceptance |
| ENT-CORE-013 | 企业统一通讯会话绑定 | DATA-007/008、CORE-001/011 | communication session、participant/media leg 绑定、route epoch、状态机 | 所有企业会议/客服/外呼共享 tenant-scoped session；重启和迟到事件可收敛 | ready_for_acceptance |
| ENT-CORE-014 | Tenant-aware Worker Dispatch | CORE-013、DATA-003/008 | 签名 dispatch ticket、capacity/lease、cancel/fence、cell route | 缺 tenant/cell/generation 失败闭合；旧 route/generation 不能提交副作用 | ready_for_acceptance |
| ENT-CORE-015 | 企业设备、声音和录制策略 | CORE-013/014、CORE-002 | device/cloud ASR、翻译、TTS、voice identity、录制和降级策略 | 策略按 tenant/version 执行；声纹和录音无授权不启用 | ready_for_acceptance |
| ENT-DATA-001 | 企业 PostgreSQL schema | CORE-001 | schema、migration、FK、backup | 真实企业试点数据库门禁通过 | in_progress |
| ENT-DATA-002 | Tenant-scoped Repository | DATA-001 | Repository context、runtime adapter、cell Worker 和 lint/test | 不存在无 tenant 查询入口、fallback 或双写 | ready_for_acceptance |
| ENT-DATA-003 | Inbox/Outbox | DATA-001 | 幂等收件、事务发件、重试 | 重放100次仅一次副作用 | ready_for_acceptance |
| ENT-DATA-007 | 公共 Primary Runtime 收敛 | DATA-001/002/003、上游稳定提交 | 双 migration manifest、单 Storage Driver/startup gate、分权连接池 | HTTP/企业 Repository/Worker 共用一个 verified Primary Runtime；无 fallback、shadow read 或双写 | ready_for_acceptance |
| ENT-DATA-008 | 公共通讯资源 tenant scope | DATA-007、CORE-001 | scope_type/scope_id、复合 FK、forced RLS、scoped Repository | session/leg/dispatch/provider/playback 无可选 owner 授权入口，跨租户矩阵全部拒绝 | ready_for_acceptance |
| ENT-OBS-001 | 企业链路追踪 | CORE-006 | trace IDs、质量和成本报告 | session 到 ledger/tool 可追踪 | in_progress |

## 3. P0 企业 Web 与客户端体验

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-UI-001 | 视觉令牌与图标注册表 | CORE-003 | Web theme、Material Icons 映射、组件令牌 | 颜色/字号/8px圆角与 Flutter 一致；不混用图标库 | ready_for_acceptance |
| ENT-UI-002 | 租户选择与权限导航 | CORE-002/003/011 | route discovery、tenant picker、scope nav、guarded route | 九角色入口正确；直接 URL 仍由服务端拒绝 | ready_for_acceptance |
| ENT-UI-003 | 统一页面状态 | CORE-003/008 | loading/empty/not_ready/degraded/forbidden/conflict/processing/failed 组件 | 不出现空白页、假成功或覆盖冲突版本 | ready_for_acceptance |
| ENT-UI-004 | 企业工作台 | UI-002/003、CORE-007/008/010/012、OBS-001 | readiness、待办、业务状态、用量和告警 | 所有状态来自服务端；无真实样本不绘制趋势 | in_progress |
| ENT-UI-005 | 成员与角色设置 | UI-002/003、CORE-001/002 | 成员列表、现有账号加入、角色/状态编辑、scope 说明；外部邀请通道待后续实现 | 角色变更与服务端 scopes 一致；越权入口不可执行 | ready_for_acceptance |
| ENT-UI-006 | 知识与术语管理 | UI-003、CORE-004/005 | source/version/publish、term pack、script template 页面 | 未发布/过期内容明确标识且不能被错误发布 | ready_for_acceptance |
| ENT-UI-007 | 区域、Provider、套餐与用量 | UI-003、CORE-007/008/010/011/012 | region/route、capability、entitlement、budget、billing 页面 | homeRegion 只读；不回显密钥；未配置显示 not_ready | ready_for_acceptance |
| ENT-UI-008 | 审计与分析 | UI-003、CORE-006、OBS-001 | 审计筛选/详情/导出、质量和成本下钻 | 敏感字段脱敏；导出有目的、范围、到期和审计 | in_progress |
| ENT-UI-009 | 响应式、深色和无障碍 | UI-001..008 | 320/600/960/1280 布局、dark mode、键盘和动态字体 | 无横向溢出；WCAG AA；200%缩放核心操作可达 | in_progress |
| ENT-UI-010 | Web 自动化与发布门禁 | UI-002..009 | unit、contract、E2E、视觉回归、bundle 和错误监控 | 角色×页面×状态矩阵通过；生产构建无示例数据 | in_progress |
| ENT-UI-011 | Flutter 企业入口 | UI-001/002、CORE-002 | 工作台、会议、接管、告警和我的入口 | 不复制批量管理；离线/越权不显示乐观成功 | in_progress |
| ENT-UI-012 | Web 访客参会壳 | CORE-003、MTG-002 | guest token 入会、设备检查、字幕和共享入口 | token 仅访问指定 meeting；不暴露租户导航和成员数据 | in_progress |

`ENT-CORE-003` 的生产脚手架、登录和构建已完成；`ENT-UI-001/002/003/005/006/007` 已进入验收，`ENT-UI-004/008/009/010/011/012` 因暂缓测试或依赖未完成保持开发中。Provider capability、租户生命周期 job、成员关系、知识/术语/话术版本、区域、权益、预算和用量聚合已使用服务端真值；Flutter 企业会议与 Web guest session 已接 MTG-003 的个人字幕偏好和服务端定向字幕消费代码候选，Provider/Worker 未就绪时继续明确降级，定向 TTS 与访客共享尚未开放；已认证成员的 Web/iOS/Android 共享分别形成 MTG-005/006/007 代码候选。静态 HTML 原型、未执行的测试定义和静态无障碍检查不进入生产验收，也不能替代浏览器、键盘、axe、视觉回归和真机矩阵。

## 4. P0 企业会议

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-MTG-001 | Meeting 聚合 | CORE-013、DATA-003/008 | meeting/participant/artifact schema、communication session binding | 重启后会议和统一会话状态可恢复 | in_progress |
| ENT-MTG-002 | 创建和入会 | MTG-001 | API、短期 token、Web/Flutter 入口 | host/guest/member 权限正确 | in_progress |
| ENT-MTG-003 | 企业实时翻译 | MTG-002、CORE-014 | tenant-aware Worker 路由、个人字幕语言 | 四人字幕和译音不串轨，旧 Worker 不恢复播放 | in_progress |
| ENT-MTG-004 | 屏幕共享租约 | MTG-002 | acquire/pause/resume/renew/stop、CAS、短期发布 grant、cell lease reaper、LiveKit 撤销 | 同时共享只成功一个；停止续租后服务端自行回收 | in_progress |
| ENT-MTG-005 | Web 屏幕共享 | MTG-004 | getDisplayMedia、独立发布房间、代际订阅过滤、布局与控制 | screen/window/tab 真实来源、暂停恢复和原生停止在浏览器/LiveKit 门禁通过 | in_progress |
| ENT-MTG-006 | iOS ReplayKit | MTG-004 | Broadcast Extension、App Group 无令牌交接、独立 publisher Room、Flutter bridge | 离开 App 后持续共享且可停止 | in_progress |
| ENT-MTG-007 | Android MediaProjection | MTG-004 | 一次性授权、mediaProjection 前台服务、可见停止通知、独立 publisher Room、原生停止监听 | 系统/通知/租约停止均收敛，token 不进入 Service；真机门禁通过前不宣称可用 | in_progress |
| ENT-MTG-008 | 共享系统音频 | MTG-005/006 | Web 独立 audio track、entitlement/grant 守卫、独立播放与 ASR source fence；移动端明确降级 | 不进入错误 ASR，不形成回声环；移动端无真实采集时不显示成功 | in_progress |
| ENT-MTG-009 | 共享自适应布局 | MTG-005 | Web/Flutter 显式 simulcast/dynacast、尺寸驱动订阅、三种画面/字幕布局 | 小屏横屏大字体无重叠；弱网层切换不阻断音频和字幕 | in_progress |
| ENT-MTG-010 | 主持人共享控制 | MTG-004 | grant/revoke/force stop | 撤销后旧 track 不恢复 | in_progress |
| ENT-MTG-011 | 会后材料 | MTG-003、CORE-004 | transcript/review/action items | 结论可回溯 segment | in_progress |
| ENT-MTG-012 | 屏幕 OCR 翻译 | MTG-005、CORE-004 | keyframe/hash/OCR/layout events | 默认关闭，失败不影响共享 | in_progress |
| ENT-MTG-013 | 日历 Adapter | MTG-001、CORE-008 | contract、mock、首个 Provider | 重试不重复创建会议 | in_progress |

`ENT-MTG-011` 已形成 `0025`、final event target fan-out 去重与 latest revision 冻结、source count/hash、幂等材料
修订、逐项 segment evidence、当前会议 speaker label、action CAS、artifact/audit/outbox、LLM review 明确降级及
Web/Flutter 服务端材料入口。Provider 未配置时只生成逐字稿，不生成假摘要；owner/due/priority 仅在引用证据可确认时绑定。
自动化、migration/forced-RLS、真实 Provider、浏览器/真机和导出 Adapter 未完成，保持 `in_progress`。

`ENT-MTG-012` 已形成 `0026` 五张 tenant-scoped forced-RLS 表、短期 HMAC Worker ticket、当前
tenant/cell/route/share/generation/track/subscription fence、`SUBSCRIBE_NONE` 精确 screen track 订阅、1至2秒采样、
服务端 pHash 去重、不可变 frame usage ledger、HTTPS OCR Provider 明确开关和实际 fingerprint。Web/Flutter 默认关闭，
只消费服务端定向且匹配当前 participant/share/run/revision 的布局，按 contain 内容矩形支持原图/译图/双语；data channel
故障使用 API polling，Provider/调度未配置时原共享和字幕继续。当前只完成静态门禁，自动化、migration/forced-RLS、
真实 Provider/LiveKit、浏览器/真机和容量门禁未执行，保持 `in_progress`。

`ENT-MTG-013` 已形成 `0027` 单会议/Provider 唯一同步记录、主持人 GET/POST API、实时 calendar readiness、
tenant-bound Google Workspace service-account Adapter、稳定 event ID/409 GET 对账、AES-256-GCM outbox 和原子 Worker
receipt finalize。Web 可预约并显示/打开日历事件，Flutter 显示同一状态并安全复制链接；两端都把访客邀请与成员入口分离。
可注入 mock 和“同 key 重试只创建一个 Provider 事件”的 contract test 已定义。按本轮要求未运行任何测试，也未执行
migration/forced-RLS、真实 Google Workspace 管理授权、Worker 重启、浏览器或真机验收，任务保持 `in_progress`。

`ENT-CS-001` 已形成 `0028` 客服领域代码候选：新增 forced-RLS queue，收紧 channel/customer/session/case/tool
的状态、身份、时间、幂等和复合 tenant FK；Repository/runtime 原子创建 support communication binding，
CAS 迁移会话并聚合恢复非终态资源。状态矩阵已定义但按要求未运行，真实 migration/forced-RLS/并发/
重启恢复均未验收，任务保持 `in_progress`。

`ENT-CS-002` 已形成 Provider-neutral 共享契约、内部 channel 授权/入站 API、短期 HMAC tenant dispatch ticket、
PSTN inbound readiness、Web/App first-party 路径，以及 Inbox hash 去重、客户 hash 归并、统一 support/communication
session、audit/Outbox 原子事务。ticket/路由负向测试已定义但按要求未运行，真实 Provider webhook 签名、PSTN/Web/App、
并发重放和重启恢复均未验收，任务保持 `in_progress`。

`ENT-CS-003` 已形成客服会话级 tenant RAG 契约、PostgreSQL runtime 和受 RBAC/签名 route 保护的 API。
只允许服务中会话检索当前有效 published 知识；命中返回 evidence/citation 并逐条审计引用，无证据返回无法确认和
转人工指令，不调用 LLM 伪造答案。测试已定义但按要求未运行，真实 PostgreSQL、双租户、过期/冲突知识、召回质量和
Support Agent 消费均未验收，任务保持 `in_progress`。

`ENT-CS-004` 已形成 `0029` forced-RLS Agent run/turn、幂等 sequence/hash 与单向状态 trigger、strict JSON schema
OpenAI-compatible Provider、thinking/额外字段/citation 子集 guard、最多12轮上下文压缩、无证据与 Provider
not-configured/timeout/unavailable/invalid-output 显式 handoff/degraded、API-owned prepare/complete 二次 evidence hash，以及
独立 LiveKit Worker cell 的 dispatch/heartbeat/ticket refresh/AbortSignal/播放前 TTS authorize/generation fence；被打断的
speech 不推进 delivered。测试文件已定义但按要求未运行，
真实 migration/forced-RLS、跨租户、Provider、LiveKit/ASR/TTS、接管/取消竞态和重启恢复均未验收，任务保持 `in_progress`。

`ENT-CS-005` 已形成 `0030` forced-RLS Tool Registry，工具定义按 tenant/name 串行生成
不可变 revision，只允许 `draft -> active -> retired`，同名同时只有一个 active 版。服务端固定
read/reversible/high-risk 与 scope/confirmation 的映射，限制封闭 primitive schema，并在内部授权时
重验 Worker ticket/lease/binding/policy/route/generation/run/session。参数只落 SHA-256，幂等冲突拒绝；
只读只进入 `requested`，可逆写只进入 `awaiting_confirmation`，高风险只返回人工接管且不创建
execution。数据库复合 FK/insert trigger 同样拒绝未注册、非 active、策略错配或高风险自动执行；
升级会取消已存非终态旧 execution。Agent `toolRequest` 仍为 `null`；只读执行见 `ENT-CS-006`，
可逆写确认见 `ENT-CS-007`，不可执行高风险接管见 `ENT-CS-008`。测试已定义但按要求未运行，真实 migration/forced-RLS、并发发布、双租户、
Provider/Adapter 和客户确认均未验收，任务保持 `in_progress`。

`ENT-CS-006` 已形成 `0031` 只读 execution attempt/lease/Provider/result 状态、
`order.lookup/logistics.lookup/inventory.lookup` 严格 Adapter contract、默认 unavailable runtime、
tenant-bound simulated mock，以及 claim -> 事务外5秒调用 -> fenced finalize。每次执行重验签名 Worker
ticket、run、session/customer、active revision、schema/arguments hash 和 lease；订单/物流按当前客户
过滤，库存按 tenant 绑定，完成回放重验结果结构和 SHA-256，旧租约与迟到结果拒绝。Agent
`toolRequest` 仍为 `null`，真实 ERP/物流/库存 Provider 未配置。测试文件已定义但按要求未运行，真实
migration/forced-RLS、双租户、并发重领、崩溃恢复和 Provider 均未验收，任务保持 `in_progress`。

`ENT-CS-007` 已形成 `0032` 可逆写 confirmation/run/turn/outbox/attempt/result 状态，固定
`ticket.create/callback.schedule/note.add` 严格 Adapter contract、120秒确认挑战、挑战后客户 turn
hash/sequence 绑定、AES-256-GCM Outbox、Provider idempotency/fingerprint fence、Cell Worker 相同
幂等键恢复，以及 execution/outbox/audit 原子 finalize。未确认、含糊/过期确认、参数或 revision 变化、
Adapter/keyring 未配置均不会入队；未知网络结果只重试，确定 receipt 才完成。生产默认 unavailable，
mock 固定 `simulated=true`；Agent `toolRequest` 仍为 `null`。测试文件已定义但按要求未运行，真实
migration/forced-RLS、双租户、并发确认、崩溃窗口、Provider 端幂等和真实工单/回拨/备注均未验收，
任务保持 `in_progress`。

`ENT-CS-008` 已形成 `0033` forced-RLS、append-only 的 high-risk handoff request。退款、付款、身份验证
及其他 high-risk 工具均只保存 run/session/customer、active definition revision、arguments hash、固定策略
版本和 risk evidence hash；同幂等键异证据冲突。首次请求与 Agent run/support session 的
`handoff_requested` 迁移处于同一事务，接管后普通回答不能取得 TTS 授权；数据库继续拒绝 high-risk
execution、Outbox 和 Provider 调用。坐席排队/claim 由 `ENT-CS-009` 独立代码候选承接。测试已定义但按要求
未运行，真实 migration/forced-RLS、双租户、并发请求、TTS 停播和人工接通均未验收，任务保持
`in_progress`。

`ENT-CS-009` 已形成 `0034` queue SLA/claim lease 与 forced-RLS `support_agent_claims`。部分唯一索引保证
同 tenant/session 最多一个 active claim；deferred 复合 FK 把 `human_active` 的 session、claim 和 assigned
member 绑定。API 提供 queue create/list、SLA work-items、self-claim、renew/release 和 manager reassign；
坐席不能伪造 agent，只有 owner/admin/support_manager 可改派，目标必须是同 tenant active 客服角色。
lease 到期只在下一次 claim 时原子写 expired 证据并释放/重领，幂等 hash 与 optimistic version 拒绝重放
变体和旧写入。测试已定义但按要求未运行，真实 migration/forced-RLS、双租户、角色矩阵、同会话并发
claim、断线回收和人工接通均未验收，任务保持 `in_progress`。

`ENT-CS-010` 已形成 workbench activate/read runtime/API 与 Web 三栏工作台。claim 成功在同一 tenant
事务内把最新 Agent run 取消；刷新旧 claim 时重新校验 assigned user、active claim 与未过期 lease 后补建
相同 fence。工作台只公开客户、case、工具结果、风险类别、有界 Agent 上下文和 tenant-scoped 最终字幕，
知识检索沿用 Agent locale/country/product；媒体/工单/回呼能力缺失时固定 not_ready。测试与真实环境证据
未执行，任务保持 `in_progress`。

## 5. P1 AI 客服

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-CS-001 | 客服领域模型 | CORE-013、DATA-003/008 | channel/queue/session/case/tool schema、communication session binding | 状态机和重启恢复通过 | in_progress |
| ENT-CS-002 | 呼入 Channel Adapter | CS-001、CORE-008/014 | PSTN/Web/App contract、tenant dispatch | 三渠道创建同一 tenant-scoped communication session | in_progress |
| ENT-CS-003 | Tenant RAG | CORE-004、CS-001 | 检索过滤、引用、无答案路径 | 不跨租户、不无依据回答 | in_progress |
| ENT-CS-004 | Support Agent | CS-003、CORE-014/015 | 状态机、JSON schema、上下文压缩、声音/降级策略 | thinking 不泄露，超时可降级，取消后旧 TTS 不恢复 | in_progress |
| ENT-CS-005 | Tool Registry | CS-001 | 不可变 revision、封闭 schema、风险/scope/确认策略、授权网关 | 未注册/非 active 不可执行，高风险不落 execution | in_progress |
| ENT-CS-006 | 只读工具 | CS-005 | order/logistics/inventory Adapter、租约执行、simulated mock | 权限、客户归属、幂等回放和迟到结果 fence 通过 | in_progress |
| ENT-CS-007 | 可逆写工具 | CS-005 | ticket/callback/note adapter、确认挑战、密文 outbox、Worker finalize | 未确认不执行，重复只执行一次 | in_progress |
| ENT-CS-008 | 高风险接管 | CS-005 | 不可执行 handoff request、refund/payment/identity 分类、证据 hash、run/session 原子接管 | AI 永不自动完成高风险动作；幂等重放且无 execution/Outbox | in_progress |
| ENT-CS-009 | 坐席队列 | CS-001 | `0034`、确定性 routing、SLA/lease、claim/release/renew/reassign API | 两坐席不能同时接管同一会话；断线可回收；改派受主管守卫 | in_progress |
| ENT-CS-010 | 坐席工作台 | CS-009、CS-004 | workbench activate/read、Agent cancel fence、字幕/客户/知识/风险/历史、lease heartbeat、显式媒体降级 | 接管上下文完整；后续 AI 授权失败闭合；物理停播与媒体控制待真实验收 | in_progress |
| ENT-CS-011 | 工单和回拨 | CS-007 | `0035`、case/callback/followup、密文 outbox、Worker finalize、Web 表单 | 外部未知结果同键重试且不阻塞结束；真实 Provider/RLS/崩溃恢复待验收 | in_progress |
| ENT-CS-012 | 质检分析 | CS-004、OBS-001 | `0036`、`quality:read/manage`、不可变规则/复核/发现、终态 source hash、五类结构规则、Dashboard/证据详情 | 定位未告知、无引用、风险未转人工、禁用承诺和未送达；语义错误率不伪造 | in_progress |

## 6. P1/P2 出海外呼营销

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-MKT-001 | Campaign 聚合 | CORE-001、DATA-003 | `0037`、共享契约、三类写命令幂等、CAS、Repository/API、同风格 Web 页面 | 未审批活动不能调度；重试不重复变更；不提前生成 task 或 PSTN 副作用 | in_progress |
| ENT-MKT-002 | 线索导入 | MKT-001 | `0038`、CSV/API、E.164、AES-GCM/HMAC、tenant Lead 去重、Campaign 关联、逐行错误报告、版本化回滚、Web 面板 | 整批失败零业务写入；同号码/外部 ID 不分裂；回滚保留证据且不提前生成授权/任务 | in_progress |
| ENT-MKT-003 | 授权证据 | MKT-002 | `0039`、Campaign/Lead/purpose 绑定、对象实体验证、hash/大小/类型、不可变历史、幂等撤回、有效性 API、task insert/reschedule guard、Web 面板 | 无有效授权时可执行任务数为零；撤回后无替代授权的待任务取消；不把其他用途推导为自动营销电话授权 | in_progress |
| ENT-MKT-004 | 禁拨名单 | MKT-002 | `0040`、tenant/global 不可变证据、拒绝/撤回来源、幂等 API、同号码并发锁、task insert/reschedule guard、跨活动待任务取消、Web 面板 | 拒绝后立即阻断全部待任务；普通成员不能伪造 global 记录；全局注册表缺配置时失败闭合 | in_progress |
| ENT-MKT-005 | Country Policy | MKT-003/004 | `0041`、不可变国家版本、当地时间窗口、跨活动频控、三段告知、语音信箱、readiness/API/Web、task SQL guard | 缺失/未来/过期、错误时区、窗口外、重试过密或超频时任务为零；审批快照由 MKT-006 固化 | in_progress |
| ENT-MKT-006 | 活动审批 | MKT-005、CORE-002 | `0042/0043`、validate/approve/reject、不可变 validation/decision、策略/Lead/Consent/Suppression 快照、API/Web/执行 guard | 只有当前 ready snapshot 可批准；任一证据漂移时 schedule/task 为零 | in_progress |
| ENT-MKT-007 | Scheduler | MKT-006、CORE-007/014 | `0044`、审批快照任务物化、当地窗口 due query、SKIP LOCKED/CAS claim、route fence、usage hold、租户/活动并发、只读 Web 状态 | 50并发不重复 claim，过期租约可恢复，单租户超载不拖垮 cell | in_progress |
| ENT-MKT-008 | PSTN dispatch | MKT-007、CORE-008/014、DATA-008 | `0045`、Provider adapter、签名 webhook、communication binding、Outbox、60秒 settle、scoped dispatch、只读 Web 状态 | 重放不重复拨号/扣费，旧 route/generation 不能拨号，Provider 未配置失败闭合 | blocked |
| ENT-MKT-009 | Marketing Agent | MKT-008、CORE-004/005 | `0046`、版本化 profile、服务端状态机、签名 runtime ticket、严格 LLM Adapter、knowledge citation、disclosure/TTS fence、Campaign Web 配置 | 无依据不承诺；告知未播放不能继续；退订原子写 suppression 并结束；Provider 未配置失败闭合 | in_progress |
| ENT-MKT-010 | 实时监控 | MKT-008、OBS-001 | campaign/call 只读投影、最终字幕、Agent 意图/风险、Provider 延迟/失败、5秒非流式 Web 快照 | 真实状态延迟和失败可观测；无样本/未接实时流不伪造成功 | in_progress |
| ENT-MKT-011 | 人工接管 | MKT-009、CS-009 | 冻结 handoff policy、Marketing→Support bridge、唯一 claim、Provider 停播/坐席加入回执、超时收敛 | 只有有效 claim、AI 数据库 fence 和 300ms Provider 停播+坐席加入回执同时成立才显示 active；未配置/回拨不伪造成功 | in_progress |
| ENT-MKT-012 | Outcome | MKT-009 | disposition、intent、next action | 有证据且不重复生成任务 | todo |
| ENT-MKT-013 | CRM Adapter | MKT-012、CORE-008 | contract、outbox、首个 Provider | 外部失败恢复后只同步一次 | blocked |
| ENT-MKT-014 | 活动分析 | MKT-012、OBS-001 | funnel、cost、complaint | 指标可按国家/活动/版本拆分 | todo |

`blocked` 只表示真实服务商账号未提供；Adapter、mock、contract test 和 UI 降级仍必须开发。

`ENT-MKT-002` 已形成 `0038`、号码规范化/保护、tenant 身份去重、批次/关联/逐行证据、Repository/runtime/API
和 Web 面板代码候选。当前仅执行静态门禁；定义但未运行的测试覆盖格式与号码保护，完整的 migration/forced-RLS、
双租户、幂等/并发、回滚保留、浏览器与密钥备份恢复矩阵仍待 `AC-ENT-0035`，因此状态保持 `in_progress`。
`ENT-MKT-002` 本身不生成授权，授权登记由独立 `ENT-MKT-003` 链路完成；它仍未实现
`ENT-MKT-004/005/006/007/008`，不能据此生成禁拨、审批、任务或真实拨号。

`ENT-MKT-003` 已形成 `0039`、对象证据校验 Adapter、不可变 Consent Repository/runtime/API、当前有效性解析、
撤回审计和 Web 详情面板。对象存储未配置、证据实体/hash/大小/类型不一致、用途不是
`automated_marketing_call`、活动/线索不匹配或非 PostgreSQL runtime 时失败闭合；数据库在 task insert/重排时
再次验证同 Campaign/Lead 的有效授权。真实对象存储、migration/forced-RLS、双租户、并发撤回与浏览器矩阵仍待
`AC-ENT-0036`，状态保持 `in_progress`。该任务未实现禁拨、国家策略、审批快照、Scheduler、PSTN 或 Provider 成功。

`ENT-MKT-004` 已形成 `0040`、不可变 Suppression Repository/runtime/API、tenant/global scope 读取、拒绝联系/
撤回授权/投诉/人工录入来源、同号码 advisory transaction lock、task insert/reschedule 数据库 guard、跨活动
pending/scheduled/retry 原子取消，以及同一授权详情中的禁拨面板。公开 API 只允许 active membership 和
`campaign:write` 创建 tenant scope；global scope 仅允许受信 system actor 的 `global_registry` 投影，普通租户请求
不能伪造。当前全局禁拨注册表 Adapter 明确 `not_configured`，即使企业名单未命中也返回 not_ready；国家策略、
Scheduler dispatch 和 PSTN 物理停止仍未实现。自动化、真实 PostgreSQL/forced-RLS、同号码并发、浏览器和全局名单
同步验收均未执行，`AC-ENT-0037` 未通过，任务保持 `in_progress`。

`ENT-MKT-005` 已形成 `0041`、不可变 Country Policy Repository/runtime/API、同 actor 幂等发布、同国家版本与
生效区间互斥、Campaign 目标时间 readiness，以及 Web 发布/列表/逐活动阻断状态。每个版本固定当地星期/分钟窗口、
最大尝试数与滚动小时窗口、最小重试间隔、品牌/AI 身份/营销目的告知、语音信箱模式和合规确认依据；非
`compliant_message` 不允许夹带留言内容。`marketing_call_tasks` 必须显式引用策略版本，数据库在同号码事务锁内按
Lead 国家和 IANA 时区复核有效期、当地窗口与跨活动频控。Campaign 进入 scheduled 时也要求所有目标国家在计划
开始时间有有效版本。当前只形成静态候选，`AC-ENT-0038`、真实 PostgreSQL/forced-RLS、时区/DST、并发竞态、浏览器
和企业法务签核抽样均未执行，状态保持 `in_progress`；本任务不固化审批快照、不生成任务、不调用 Scheduler/PSTN。

`ENT-MKT-006` 已形成 `0042/0043`、不可变 validation snapshot/approval decision、Campaign/Policy/Lead/Consent/
Suppression 规范 JSON 与 hash、validate/approve/reject Repository/runtime/API，以及同风格 Web 折叠审批面板。ready
validation 要求未来开始时间、至少一条有效 Lead、全部国家策略、Lead 国家/IANA timezone、逐 Lead Consent 和零禁拨；
批准前在 phone advisory lock 与数据 share locks 下重建快照，任一漂移返回 stale。数据库把每次 Campaign 状态迁移绑定
到 snapshot/decision actor、时间和源版本，scheduled/task 再复核当前快照。当前只形成静态候选，`AC-ENT-0039`、
真实 PostgreSQL/forced-RLS、双租户、并发撤回/禁拨、浏览器和法务审批抽样未执行，保持 `in_progress`；不生成 task、
usage hold、Outbox 或 PSTN 请求。

`ENT-MKT-007` 已形成 `0044` 和 PostgreSQL-only Scheduler 代码候选。schedule 在 Campaign 状态迁移同一事务中，
按冻结 approval snapshot 为每条 Lead 生成确定性 attempt-1 task；任一 Lead 在八日搜索窗口内无法解析 IANA 当地合规
时间时整批零写入。内部 claim 同时校验内部密钥、签名 route document、当前 cell/route epoch、Campaign/tenant 并发、
`worker.voice_agent_runtime.concurrent` entitlement、60秒 `marketing_call_seconds` hold、当前审批/Consent/Suppression/
Country Policy/当地窗口，并以 tenant lock、`FOR UPDATE SKIP LOCKED`、task version CAS 和不可逆 token hash 防重复。
租约过期原子释放 hold 并回 retry；Consent 撤回或 Suppression 写入会取消尚未 dispatch 的 claim 并释放 hold。
本任务没有创建 communication session、Outbox、Provider/PSTN 请求或伪造外呼成功；自动化、真实 PostgreSQL/RLS、
50 Scheduler 并发、故障隔离、浏览器与 staging 31+47 证据均未执行，`AC-ENT-0040` 未通过，状态保持 `in_progress`。

`ENT-MKT-008` 已形成 `0045`、PostgreSQL-only PSTN Repository/runtime、HTTPS Bridge Adapter、HMAC webhook、
PSTN Bridge enterprise context 透传和同风格只读 Web 面板。prepare transaction 重读 claim token/generation、签名
route/current cell、approval、Lead/link、Consent、Suppression、Country Policy/当地窗口和活动 entitlement，随后创建
tenant-scoped communication session/binding、安全 Outbox 与稳定 Provider idempotency key；Provider 只在事务外调用，
finalize transaction 以同一 dispatch 证据转换 task，并仅在首次接受时结算固定60秒 hold。Provider 响应未知时保留
`unknown` 并禁止 lease reaper 盲目生成下一代拨号；签名 webhook 以 event ID 去重，重读 route/generation/provider
call fence 后推进 answered/completed/failed，不重复结算。Provider、HTTPS Bridge、webhook secret、手机号 keyring 或
持久 idempotency 保证缺失时固定 `not_ready`，不生成模拟成功。当前只形成静态候选；自动化、`0045` migrate/down、
forced-RLS、真实 Provider/PSTN、响应丢失对账、50并发和浏览器均未执行，`AC-ENT-0041` 未通过；任务仍由外部
PSTN sandbox/凭据和正式验证阻塞，保持 `blocked`。

`ENT-MKT-009` 已形成 `0046`、PostgreSQL-only profile/run/turn Repository/runtime、PSTN prepare 同事务 Agent run、
短期 HMAC runtime ticket、严格 OpenAI-compatible JSON Adapter、知识引用/禁语验证、disclosure/TTS authorize-delivered
双栅栏和同风格 Campaign 配置面板。profile 只在未提交草稿可改，开场必须包含品牌、AI 身份和营销目的；运行时固定
published Term Pack/Script Template 与 context hash。退订由服务端确定性识别并原子写 suppression 后结束；转人工当前只
记录请求并停止 AI，真实接管仍属于 `ENT-MKT-011`。Provider、HTTPS runtime、签名 secret、profile 或 published 内容
任一缺失都使 PSTN readiness 失败闭合。当前只形成代码、测试定义和静态候选；`0046` migrate/down、forced-RLS、
双租户、真实 LLM/PSTN/通话、浏览器和承诺/引用攻击矩阵均未执行，`AC-ENT-0042` 未通过，任务保持 `in_progress`。

`ENT-MKT-010` 已形成 PostgreSQL-only Campaign 汇总和单通话监控 Repository/runtime/API，使用 `campaign:read`、签名
route、forced-RLS business tables 与公共 `scope_type/scope_id` 白名单读取。快照显示脱敏 Lead、dispatch/task/run/turn、
告知交付、最终 revision 字幕、意图/风险/引用、Provider operation、接受/接听延迟、状态 age 和确定性关注原因；Web
复用既有 token/Material Icons，并只在面板展开时按5秒刷新。Realtime Gateway 尚未接入，响应和页面均明确
`streamStatus=not_configured/非流式`，也没有接管或 Outcome 写入口。当前通过 typecheck、build、E2E TypeScript、文件规模和
开发态 bundle 静态门禁；自动化、真实
PostgreSQL/RLS、双租户、真实通话、浏览器、100路刷新负载和流式订阅未验收，`AC-ENT-0043` 未通过，保持
`in_progress`。

`ENT-MKT-011` 已形成 `0047` forced-RLS `marketing_handoff_policies/marketing_handoffs`、未提交草稿才可编辑的
Support Queue/PSTN Channel/超时策略、审批快照冻结，以及 handoff turn 交付后同事务创建的 Marketing
→ Support Session 桥接。坐席仍只通过 `support_agent_claims` 领取；工作台在 claim 有效、Marketing run
已存在停播 fence 后才发起事务外 Provider 激活，并且只在300ms内返回 AI 音频已停止与坐席已加入的
完整回执时标记 media active。Provider 未配置、非 HTTPS、无幂等保证、无坐席加入保证或无300ms保证时明确
`not_configured/not_ready`。超时 Worker 只将未领取会话收敛为 `timed_out/callback_required`，审计固定
`physicalProviderAction=not_verified`，不伪造挂断或回拨成功。当前只完成静态候选；自动化、`0047`
migrate/down/forward、forced-RLS/双租户、真实 PostgreSQL/PSTN/坐席、300ms 和浏览器未验收，
`AC-ENT-0044` 未通过，任务保持 `in_progress`。下一项为 `ENT-MKT-012` Outcome。

## 7. P2 企业发布

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-DATA-004 | SQLite/JSON 演示数据导入 | DATA-002/003 | source copy/check、empty-target import、count/hash reconcile | 不一致回滚；只迁移内部演示数据，不承载生产 | ready_for_acceptance |
| ENT-DATA-005 | Cell 数据迁移和回滚 | CORE-011、DATA-001/009 | export/import/reconcile/rollback | 记录、ledger、hash 全量一致 | todo |
| ENT-DATA-006 | 多实例协调 | DATA-003/007/008 | lease/queue、无全局内存真值 | Worker 故障不重复执行 | todo |
| ENT-DATA-009 | Primary 数据切换和全量对账 | DATA-007/008、CORE-013/014 | 全量/增量 count/hash、水位、writer fence、cutover/rollback/restore 签名证据 | 旧 writer 清退；切换前后 tenant/session/ledger/object 引用一致 | ready_for_acceptance |
| ENT-REL-001 | 企业安全门禁 | CORE-002/006 | SAST、依赖、密钥和渗透测试 | P0/P1 问题清零 | todo |
| ENT-REL-002 | 数据生命周期 | DATA-001/003 | retention/export/delete jobs | 删除可审计且对象最终收敛 | todo |
| ENT-REL-003 | 备份和灾备 | DATA-005/009 | 跨故障域自动切换、旧主 fencing、异地主机不可变备份、PITR | 达到约定 RPO/RTO，旧主不能恢复写入 | todo |
| ENT-REL-004 | 灰度和熔断 | OBS-001 | tenant flag、kill switch、runbook | 单租户异常可隔离停止 | todo |
| ENT-REL-005 | 企业发布材料 | 全部 | 文档、SLA、隐私、管理员手册 | 发布清单全部有证据 | todo |
| ENT-REL-006 | SaaS 控制面高可用 | CORE-009/010/011 | directory、provisioning、status | 控制面故障不破坏进行中会话 | todo |
| ENT-REL-007 | 租户限流和熔断 | CORE-010/014、OBS-001 | quota、dispatch capacity、concurrency、kill switch | 单租户异常不拖垮共享 cell | todo |
| ENT-REL-008 | 订阅和欠费状态 | CORE-010/012 | renew/past_due/suspend/resume | 不误停进行中安全链路，不漏账 | todo |

## 8. 任务到验收的映射

| 任务域 | 必须通过的验收组 |
| --- | --- |
| `ENT-CORE-*` | `AC-ENT-*`、SaaS 控制面、A1 租户/RBAC/幂等 |
| `ENT-UI-*` | `AC-UI-*`、对应业务验收、浏览器/真机和无障碍 |
| `ENT-DATA-*` | A0 单 Primary、A1 数据隔离、H1 故障注入、H3 PostgreSQL/Cell/灾备 |
| `ENT-MTG-*` | `AC-MTG-*`、`AC-SHARE-*`、会后材料和真实媒体 |
| `ENT-CS-*` | `AC-CS-*`、RAG、工具、人工接管和 CRM 故障 |
| `ENT-MKT-*` | A3 合规预检、并发、真实白名单通话和结算 |
| `ENT-OBS-*` | H1 长稳、链路证据、告警和成本追踪 |
| `ENT-REL-*` | H1/H2/H3、发布材料、值班和 kill switch |

任务从 `ready_for_acceptance` 进入 `accepted` 时，提交说明或任务记录必须列出对应 acceptance ID、证据路径和阻塞项；不能只引用一次全量测试结果。

## 9. Definition of Done

- 代码遵循现有模块边界，不出现超大文件。
- 数据模型、API、事件和 UI 状态一致。
- 单元、集成、contract、E2E 和故障测试通过。
- 每个企业写入按 tenant/user/resource 隔离，并有并发测试。
- 公共运行表只有在一等 tenant scope、复合约束和 forced RLS 通过后才能承载企业流量；可选 owner/user 过滤不算授权。
- 只集成主产品稳定提交；未提交 WIP 和同机 staging 结果不能作为企业验收证据。
- 敏感日志脱敏，token、号码、声纹、音频和屏幕内容不入普通日志。
- 外部 Provider 未配置时明确降级，不显示假成功。
- 需要真实媒体、真机或真实 Provider 的任务必须附证据。
- 文档、配置、迁移、运行手册和 `PROGRESS_LOG.md` 同步。
