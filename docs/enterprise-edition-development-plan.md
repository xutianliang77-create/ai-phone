# 无界AI企业版开发方案与计划

版本：v1.52
日期：2026-07-19
状态：E0 执行计划，已对齐统一通讯平台和 PostgreSQL Primary 收敛

## 1. 开发原则

- 先公共底座，再会议，再客服，最后营销外呼。
- 每个阶段先完成数据契约和自动化门禁，再开放 UI 和真实 Provider。
- 服务器端和客户端层独立发布；Mac 不进入运行链路。
- 企业版只以平台托管 SaaS 交付，不开发客户侧服务端安装器。
- 不复制个人版 ASR、翻译、TTS、Speaker、LLM 和计费实现。
- 主产品稳定提交才能进入企业基线；个人工作区未提交 WIP 只作为设计输入，不得跨 worktree 复制或提交。
- SQLite WAL 仅用于本地开发和封闭演示；真实企业 SaaS 试点前完成 PostgreSQL。
- 真实 PSTN、CRM 或日历账号阻塞时，完成 Adapter、contract test、mock harness 和清晰降级，不伪造可用。
- 每项任务只有代码、自动化、真实环境证据和文档同时完成才可结项。

### 1.1 当前基线

- `ENT-CORE-001/002/003` 已到 `ready_for_acceptance`；Tenant/Member、RBAC 和 `apps/enterprise-web` 生产应用基础可供后续任务复用。
- Enterprise Web 已冻结 React 19、TypeScript 5.9、Vite 8、React Router 7 和 Vitest/Testing Library 技术基线，并实现真实登录、会话恢复和租户上下文。
- `ENT-DATA-001` 已实现三十四段 PostgreSQL up/down migration、复合 FK、强制 RLS、migration runner、schema verify 和归档 smoke；`0017..0034` 分别增加知识、术语/话术、企业 trace、审计导出、Meeting 聚合/入会/翻译、屏幕共享租约、会后材料、屏幕 OCR、日历同步、客服领域、Support Agent run/turn、Tool Registry、只读工具租约执行、可逆写确认/Outbox、高风险请求和坐席 claim。历史本地 PostgreSQL 16 验证不替代当前31+34 staging migrate/restore/PITR，任务保持 `in_progress`。
- `ENT-CORE-005` 已完成版本化术语包、话术模板、审核发布、有效时间解析、统一运行时引用和租户隔离矩阵，进入 `ready_for_acceptance`；真实 ASR/翻译/LLM Worker 消费和 A1/H3 仍待验收。
- `ENT-DATA-002` 已完成单一 `legacy|postgres` Repository runtime、HTTP 全链路注入、fail-closed 启动选择和独立 cell Worker。PostgreSQL 模式不回退、不双写；API 不执行跨租户恢复扫描，Worker 通过 cell forced RLS 发现最小引用后进入 tenant transaction 复核并 claim/finalize。代码和本地自动化进入 `ready_for_acceptance`，真实 PostgreSQL 并发、容量和恢复仍待 H3。
- `ENT-DATA-004` 已完成 JSON/SQLite 源读取、SQLite 副本 `quick_check`、空目标事务导入和六集合 count/SHA-256 读回对账；不一致回滚，且明确只用于内部演示数据迁移。真实 PostgreSQL import/reconcile 证据仍待 H3。
- `ENT-DATA-003` 已完成 tenant-scoped Inbox/Outbox、事务内领域提交、100次重放去重、lease/retry/recovery 和 SQLite/迁移自动化，进入 `ready_for_acceptance`；真实 PostgreSQL 并发 claim 和 Provider sandbox 仍是验收门禁。
- `ENT-DATA-007` 已合入上游稳定提交 `fe1c3c2`，用唯一 `API_STORAGE_DRIVER`、公共/enterprise 双 manifest 验证、同库 name/OID 校验和 tenant/directory/cell/migration/maintenance 分权连接收敛 API 与 cell Worker；代码和本地自动化进入 `ready_for_acceptance`，真实 PostgreSQL H3 未执行。
- `ENT-UI-001` 已完成生产令牌、Material Icons 注册表、Flutter 对照和浏览器验证，等待验收；`ENT-UI-002` 已完成共享 scope 真值、九角色导航矩阵、嵌套路由 guard 和 `ENT-CORE-011` 签名 route document；`ENT-UI-003` 已完成八态组件矩阵及 Provider/冲突/job 真值联调，均等待验收。
- `ENT-UI-006` 已完成 Knowledge Source、Term Pack、Script Template 的服务端真值页面、签名 route document 客户端、scope 写入口控制、draft/review/published/expired 与 PostgreSQL not_ready/forbidden/conflict 状态，进入 `ready_for_acceptance`；浏览器矩阵、真实 PostgreSQL 并发发布和 Worker/Provider 消费仍待 A1/H3。
- `ENT-UI-005` 已完成成员目录、现有账号加入、角色/状态编辑和九角色 scope 说明，所有成员请求绑定当前 tenant 与签名 route document；无 `member:write` 不渲染写入口，直接 URL 无 scope 时不发起成员读取，所有者和当前账号不提供自改入口。当前接口不是短信/邮件/Provider 邀请服务，真实邀请通道仍待后续设计；任务进入 `ready_for_acceptance`，浏览器矩阵和真实 PostgreSQL staging 仍待 A0/H3。
- `ENT-UI-007` 已完成成员/权益/区域/Provider/预算与用量二级设置导航，按 `tenant:read`、`member:read`、`billing:read/write`、`usage:read` 分别发现和守卫入口。区域只读，Provider 不接收/回显敏感配置，套餐变更只接受精确服务端 plan/version 并稳定重试幂等键，预算更新带 expectedVersion，用量只展示服务端 ledger 聚合；任务进入 `ready_for_acceptance`。本地 Chromium 1440/390px 只验证隔离 fixture 布局，不替代 UI-009/010、真实 PostgreSQL staging、账务/Provider 或生产放行。
- `ENT-UI-004` 已接入租户/区域、Provider、subscription、预算、usage aggregate 和会话 trace report 的首批工作台。页面按 scope 决定是否发起 billing/usage/audit 请求，预算只和同类别、同单位、同 UTC 账期聚合比较；业务聚合与价格表缺失时明确 not_ready/not_configured。当前仅通过静态类型检查和生产 Web 构建，按本轮要求未执行自动化、浏览器和 PostgreSQL 验证，任务保持 `in_progress`。
- `ENT-UI-008` 已实现审计筛选、签名 cursor、脱敏详情、显式 session 下钻和真实受控 JSONL 导出链路。导出由 PostgreSQL job/cell Worker 处理，强制目的、范围、保留期、幂等和 hash/size 回执；客户端只经重新鉴权的 API 下载，不获取对象存储凭据或 key。未配置对象存储、业务聚合或价格表时明确 not_ready/not_configured。按本轮要求未执行自动化、浏览器、migration 或双租户验证，任务保持 `in_progress`。
- `ENT-UI-009` 已实现持久化 system/light/dark 主题选择、浅深色品牌令牌、响应式租户/导航/页面收敛、动态字号、路由焦点、跳转主内容、可聚焦横向数据区和真实按钮/表格语义。当前仅形成静态代码候选；320/600/960/1280/1440、200% 缩放、键盘、axe、视觉回归和真机仍待 `ENT-UI-010` 恢复测试后验收，因此保持 `in_progress`。
- `ENT-UI-010` 已实现三浏览器引擎、九角色、五档宽度、双主题、键盘、axe 和视觉回归的 Playwright 门禁定义，以及 release matrix、bundle 体积/敏感信息/fixture/元数据扫描、clean HEAD 约束和脱敏客户端错误/性能事件链路。CI 已对齐 Node 24 并上传失败证据；本轮未运行 unit/API/E2E 或生成视觉基线，release gate 仍会失败闭合，任务保持 `in_progress`。
- `ENT-UI-011` 已实现与个人主导航隔离的 Flutter 企业入口：每次进入重新读取账号、active membership、签名 route document、`/enterprise/v1/me` scopes 和 Provider capability，严格核对 member/tenant/region/cell/route epoch/公开 URL/有效期。工作台与告警只展示已取得的服务端真值，会议/接管按 scope 发现且在 tenant-scoped API 未实现时明确 `not_ready`，不复用个人版路径。当前仅通过 `flutter analyze`，Flutter test、构建、真机、动态字体和横竖屏按要求未执行，任务保持 `in_progress`。
- `ENT-UI-012` 已实现公开 `/join/:meetingId` 访客壳并放在成员 AuthProvider 之外；邀请凭据只接受 fragment、清除地址后只驻留内存，query/格式错误/历史清理失败均拒绝。访客点击入会后以加密邀请换取短期 RTC grant，并由独立企业 LiveKit 客户端只发布麦克风和订阅音频；不读取 tenant/member，不调用个人 Call Link，字幕、数据、摄像头和共享明确未开放。当前仅通过 typecheck、生产构建、bundle 和文件规模静态门禁，任务保持 `in_progress`。
- `ENT-MTG-001` 已实现 Meeting/Participant/Artifact 领域模型、CAS 状态机、`0021` 数据库状态/身份/时间/恢复约束、tenant-scoped Repository 和 Primary runtime adapter。聚合读取把 meeting、participant、artifact 与唯一 communication binding 合并，恢复入口只返回 provisioning/active/ending；缺 binding 可见而不伪造。当前只通过 API typecheck、文件规模和 diff 门禁，未运行 migration、forced-RLS、并发 CAS、重启恢复或自动化，保持 `in_progress`。
- `ENT-CS-001` 已形成 `0028`、Support Channel/Customer/Queue/Session/Case/Tool 领域模型、数据库状态与身份 guard、幂等会话创建、support communication binding 原子绑定、tenant-scoped Repository/runtime 和非终态恢复代码候选。当前只执行静态门禁，未运行 migration、forced-RLS、CAS、重启恢复或自动化，保持 `in_progress`。
- `ENT-CS-002` 已形成共享 PSTN/Web/App 入站契约、短期 tenant/channel/route dispatch ticket、内部授权/入站 API、实时 Provider readiness、Inbox hash 去重、客户 hash 归并和统一 session/binding/audit/Outbox 事务代码候选。Provider webhook 签名仍由 edge Adapter 负责；当前未运行自动化、真实 Provider、并发或重启恢复，保持 `in_progress`。
- `ENT-CS-003` 已形成客服会话级 tenant RAG 契约/runtime/API：只允许服务中会话检索当前有效 published 知识，命中返回逐条 evidence/citation，无证据返回确定性无法确认与转人工指令，引用写入不含 query/content 的不可变审计。当前仅通过静态门禁，未运行自动化、真实 PostgreSQL、召回质量或 Agent 生成验收，保持 `in_progress`。
- `ENT-CS-009` 已形成 `0034`、queue SLA/lease、forced-RLS exclusive claim、session/claim/agent deferred binding、确定性 work-item 排序、self-claim、release/renew 和 manager reassign 的 Repository/runtime/API 代码候选。测试已定义但按要求未运行；真实 migration/RLS、双租户、两个坐席竞争、断线回收和真实接管未验收，保持 `in_progress`。
- `ENT-CS-010` 已形成 workbench activate/read API、claim 时 Agent run cancel、旧 claim 恢复栅栏、tenant-scoped 最终字幕、客户/知识/风险/历史聚合、expected-version lease heartbeat 和三栏 Web 坐席台。没有安全 Provider/API 的静音、转组、结束、工单和回呼固定 not_ready。当前只完成静态门禁；自动化、真实 PostgreSQL/RLS、Worker/TTS、LiveKit 300ms停播、浏览器和真实坐席媒体未验收，保持 `in_progress`。
- `ENT-MTG-004` 已形成 `0024`、单会议活动租约唯一约束、acquire/pause/resume/renew/stop 幂等 CAS、代际发布身份、最小权限 LiveKit grant、cell Worker 到期回收和撤销 outbox 代码候选。Web/iOS/Android 采集仍分别属于 MTG-005/006/007；本轮未运行 migration、并发、forced-RLS、Worker 或真实 LiveKit 测试，保持 `in_progress`。
- `ENT-MTG-005` 已形成成员 Web 屏幕共享代码候选：浏览器用户手势选择内容后读取真实 `displaySurface`，再申请租约并用独立 Room 发布；首次续租绑定 track SID，后续按10秒续租；观看端只接受服务端当前 publisher identity，暂停/停止先断本地发布且撤销 pending 保持可见。系统音频、访客发布、iOS/Android、simulcast 和主持人强停不在本任务内；本轮未运行测试或真实 LiveKit/浏览器门禁，保持 `in_progress`。
- `ENT-MTG-006` 已形成 iOS ReplayKit 代码候选：主 App 持有短期发布 grant 并维持独立屏幕 Room，Broadcast Upload Extension 只经 App Group Unix socket 发送视频样本；token-free 控制清单以 share/generation/nonce 和 lease expiry 失败闭合，系统停止、超时和离会均先清理本地再收敛服务端租约。当前未构建/安装 App，未执行真机后台、真实 LiveKit、网络切换和权限矩阵，保持 `in_progress`。
- `ENT-MTG-007` 已形成 Android MediaProjection 代码候选：一次性系统授权发生在服务端 acquire 前，授权后先启动带停止操作的 `mediaProjection` 前台服务，再由独立最小权限 Room 发布屏幕轨；系统投屏停止、通知停止和租约到期均进入同一停止状态机。前台服务不持有 RTC token。当前未运行测试、APK 构建/安装、真机、真实 LiveKit、后台与网络切换矩阵，保持 `in_progress`。
- `ENT-MTG-008` 已形成 Web 系统音频代码候选：只有 `getDisplayMedia` 实际返回独立 audio track 才申请系统音频 entitlement/grant，并以同 generation 的 `screen_share_audio` source 发布；观看端显式播放远端轨，共享者本机不回放。Enterprise Meeting Agent 只接收成员 microphone publication，双重排除共享 publisher/audio。iOS ReplayKit 与 Android MediaProjection 尚无真实系统音频采集管线，继续显式关闭。当前未运行浏览器/真实 LiveKit/ASR/回声矩阵，保持 `in_progress`。
- `ENT-MTG-009` 已形成 Web/Flutter 自适应布局代码候选：smooth/auto/high 分别固化主层与低/中 simulcast layer，publisher Room 开启 dynacast；观看端不再丢弃 SDK remote video track，而以真实 DOM/Flutter renderer 尺寸驱动 adaptive subscription。画面优先、并排、字幕优先均无遮挡 overlay，Web 960px 以下及 Flutter 宽度不足/大字体时纵向收敛。当前未运行弱网、真实 LiveKit、浏览器/横屏/动态字体矩阵，保持 `in_progress`。
- `ENT-MTG-010` 已形成主持人共享控制代码候选：独立 force-stop API 要求 `screen_share:stop` 和当前 meeting 活动参会者，复用 stop CAS 递增 generation 并写独立审计/状态 outbox；Web/Flutter 只对有 scope 的非共享者显示带 participant/generation 影响确认的高关注操作，Provider 撤销 pending 保持可见并使用原幂等键有界重试。当前未运行 API/RBAC/跨租户、并发、真实 LiveKit 500ms 撤销或旧轨道迟到矩阵，保持 `in_progress`。
- `ENT-MTG-011` 已形成会后材料代码候选：`0025` 固化幂等修订、规范化 segment/evidence、当前会议 speaker label 和 action CAS；Repository 从 append-only final events 去除 target fan-out 并选 latest revision，以 count/hash 冻结源。OpenAI-compatible review 只有在 readiness 成功时生成结论，所有结论/待办必须引用当前修订片段，owner/due/priority 未被证据确认时保持空值；未配置/失败只返回逐字稿。Web/Flutter 只消费服务端材料并支持结束、生成、复核状态、证据、修名、待办和发布。当前未运行自动化、migration/RLS、真实 Provider、浏览器/真机或导出 Adapter，保持 `in_progress`。
- `ENT-MTG-012` 已形成屏幕 OCR 翻译代码候选：`0026` 固化 tenant run/subscription/command/frame/block，Worker ticket 绑定当前 share generation、publisher、track、cell 和 route；Agent 默认不订阅任何轨道，只显式订阅授权 screen video，服务端在 Provider 前完成 pHash claim/usage ledger。Web/Flutter 默认关闭并按真实 contain 内容矩形渲染原图/译图/双语，Provider 或 data channel 故障不影响共享与字幕。当前未运行自动化、migration/RLS、真实 Provider/LiveKit、浏览器/真机或容量门禁，保持 `in_progress`。
- `ENT-MTG-013` 已形成日历 Adapter 代码候选：`0027` 保存 forced-RLS 同步记录，主持人命令经实时 readiness、未来预约状态和 tenant binding 守卫后写 AES-256-GCM 加密 outbox；Google Workspace service-account Provider 使用稳定 event ID 和409对账，Web/Flutter 提供同风格状态入口。mock/contract test 已定义但按要求未运行，真实 PostgreSQL、Google 管理授权、浏览器和真机也未验收，保持 `in_progress`。
- PostgreSQL、SaaS 控制面、对象存储、正式域名、真实 Provider 和目标国家合规确认均未通过门禁。
- 当前开发必须继续使用独立企业 worktree；个人版声纹和部署 WIP 不进入企业提交。
- 公共 PostgreSQL Primary、统一通讯、Billing 和 Product Records 的稳定代码基线已导入；`ENT-DATA-008` 和 `ENT-CORE-013/014/015` 已完成代码与本地自动化。`ENT-DATA-009` 已产出全表切换/对账/逻辑恢复工具、签名证据和一次性本地 PostgreSQL 16 演练，进入 `ready_for_acceptance`；不能继承主产品环境验收，也未通过异地 PITR/H3。

## 2. 里程碑总览

| 阶段 | 目标 | 建议工作量 | 退出条件 |
| --- | --- | ---: | --- |
| E0 | SaaS 控制面和企业公共底座 | 5-7周 | 开通、区域、tenant/RBAC、Web 壳、entitlement、审计、计量和 PostgreSQL 通过 |
| E1 | 企业会议 MVP | 4-5周 | Web/iPhone 入会、字幕、屏幕共享和纪要闭环 |
| E2 | AI 客服 MVP | 5-6周 | 呼入、RAG、坐席接管、低风险工具和工单闭环 |
| E3 | 出海外呼受控试点 | 6-8周 | 合法线索、国家策略、PSTN、接管、禁拨和结算闭环 |
| E4 | SaaS 发布硬化 | 4-6周 | 多实例、隔离、安全、灾备、SLA 和发布门禁通过 |

工作量假设至少有 Backend/Data、Web、Flutter、RTC/AI、QA/SRE 五条执行轨并行；不是单人串行工期或对外承诺。估算不包含服务商商务签约、账号审批和各目标国家法律审查时间。

### 2.1 关键路径

```text
CORE-001/002 验收
  -> DATA-001 PostgreSQL
  -> DATA-002/003 Repository + Inbox/Outbox
  -> DATA-007/008 公共 Primary Runtime + 通讯资源 tenant scope
  -> CORE-009/010/011 租户生命周期、权益和区域路由
  -> CORE-013/014/015 统一通讯会话 + Worker Dispatch + 企业设备/声音策略
  -> CORE-006/007/008/012 审计、用量、readiness 和计量
  -> UI-002/003/004/005/007/010 企业壳和公共页面
  -> MTG-001/002/004/005 企业会议 MVP
  -> CS-001/003/004/009/010 AI 客服 MVP
  -> MKT-001..014 外呼受控试点
  -> DATA-009 全量切换证据
  -> REL-* 正式发布
```

任何依赖真实外部副作用的任务都不能绕开 `DATA-003`、审计、幂等、readiness 和预算门禁直接进入 Provider 联调。

### 2.2 并行执行轨

| 执行轨 | E0 重点 | E1-E3 重点 | 合并门禁 |
| --- | --- | --- | --- |
| Backend/Data | PostgreSQL、Repository、控制面、权益、审计、outbox | Meeting/Support/Campaign 聚合和状态机 | migration、tenant isolation、幂等和 API contract |
| Web | CORE-003、UI-001..010 | 会议、坐席、营销、知识和审计页面 | role×route×state E2E、bundle 和视觉回归 |
| Flutter | UI-011、企业会话入口 | ReplayKit、会议、告警和接管 | analyze/test、真机、动态字体和横竖屏 |
| RTC/AI | Provider capability、LiveKit 契约 | 翻译、共享、RAG、Agent、PSTN | 真实媒体、Provider fingerprint 和降级证据 |
| QA/SRE/Security | 测试环境、证据模板、威胁模型 | 并发、故障、长稳、安全和灾备 | acceptance ID、日志/截图、trace/ledger 对账 |

### 2.3 阶段门禁规则

- 阶段入口：上游数据契约冻结；阻塞的外部账号有明确 owner、替代 mock 和降级 UI。
- 任务入口：依赖达到任务表要求；接口契约、失败语义和验收 ID 已确定。
- 合并入口：定向测试、受影响 workspace 测试、typecheck、文件大小和 diff 门禁通过。
- 阶段退出：功能、真实环境、故障恢复、文档和运行手册证据齐全；仅有静态原型不算退出。
- 发布入口：上一放行等级通过，且不存在 P0/P1 安全、串租户、误拨、重复结算或无法停止共享问题。

## 3. E0 SaaS 控制面和企业公共底座

### 3.1 交付

- enterprise tenant、member、role 和 API credential。
- 租户注册、开通 saga、`homeRegion/cellId`、暂停、导出和注销。
- 套餐、席位、entitlement、试用、账期和用量聚合。
- 控制面 tenant directory 和区域 route document。
- 服务端 tenant context 和 Repository 强制隔离。
- 企业 Web 控制台壳、导航和登录。
- 与 Flutter 一致的 Web 主题、Material Icons、统一页面状态、权限导航和响应式门禁。
- 企业知识源、版本、术语包和发布流程。
- 企业审计、usage ledger、预算和 Provider readiness。
- PostgreSQL migration、备份、inbox/outbox 和幂等。

### 3.2 执行波次

| 波次 | 主要任务 | 可并行工作 | 退出证据 |
| --- | --- | --- | --- |
| E0-W0 | CORE-001/002 验收、CORE-003 技术选型、DATA-001 schema | UI-001 主题/图标、威胁模型、验收环境 | 决策记录、干净构建、PostgreSQL migration 测试 |
| E0-W1 | DATA-002/003/004、CORE-009/011 | UI-002/003、CORE-006/008 | 两租户攻击、单一 runtime、cell Worker、导入对账、幂等重放、路由签名、统一错误页 |
| E0-W1.5 | DATA-007/008、CORE-013/014/015 | DATA-009 演练准备、统一会话 contract test | 双 manifest、单 Primary Runtime、公共通讯表 forced RLS、企业业务唯一绑定、签名 dispatch ticket、旧 generation/route epoch fence |
| E0-W2 | CORE-010/012、CORE-004/005 已进入验收 | UI-004/005/006/007、OBS-001 | tenant billing account、entitlement/ledger 对账、知识/术语/话术版本、工作台真值 |
| E0-W3 | UI-008/009/010/011、REL-001 前置 | 对象存储恢复、控制面故障演练 | A0、AC-UI、A1 适用项和生产 Web 构建 |

每个波次可以按完成情况滚动，不以日历周强制切换；未通过数据和权限门禁的页面不能用前端 mock 标记“已完成”。

### 3.3 退出门禁

- 两个租户并发读写不能看到或修改对方资源。
- 角色越权全部被服务端拒绝。
- 重复命令只产生一个聚合状态和一条 ledger/outbox。
- 开通失败保持非 active，重试不重复创建租户或订阅。
- PostgreSQL 和对象存储恢复后租户、知识、ledger 和对象 hash 一致。

## 4. E1 企业会议 MVP

入口条件：E0 的 Tenant/RBAC、PostgreSQL、Inbox/Outbox、Web 壳、审计和基础用量达到 `ready_for_acceptance`；LiveKit capability 可探测。

### 4.1 交付顺序

1. meeting/participant/artifact 数据契约。
2. 创建、邀请、join token、开始和结束状态机。
3. 复用稳定 Speech Pipeline，但由 tenant-aware dispatch ticket、每 participant track 独立管线和服务端定向投递包裹，禁止复用个人会话身份或全局译音轨。
4. Web 企业会议页和移动端会议入口。
5. 屏幕共享租约和 Web `getDisplayMedia`。
6. iOS ReplayKit 和 Android MediaProjection 客户端代码候选；两端分别进入系统授权、后台、网络切换和真实 LiveKit 真机验收。
7. 自适应订阅、主持人停止、断线恢复和审计。
8. 会后逐字稿、摘要、决策和待办。
9. 屏幕 OCR 翻译作为 P1 灰度。

### 4.2 退出门禁

- 两人和四人会议连续30分钟，字幕、翻译和身份不串线。
- Web 与 iPhone 双向入会和屏幕共享通过。
- 同时发起两次共享时仅一个成功，主持人可以强制停止。
- 共享断开不结束会议；会议结束不会残留共享轨道。
- 纪要结论可回溯 segment，不能补写不存在的决定。

## 5. E2 AI 客服 MVP

入口条件：企业知识版本、Provider readiness、审计、用量、Web 公共状态和至少一种真实呼入渠道可验收；没有真实 PSTN 时先以 Web/App 完成非 PSTN 路径。

### 5.1 交付顺序

1. support channel、queue、session、case 和 tool execution：`ENT-CS-001` 已形成代码候选，恢复测试后验收。
2. PSTN/Web/App 呼入 Adapter 和统一会话创建：`ENT-CS-002` 已形成内部 Adapter contract/runtime 代码候选，真实 edge Provider 待验收。
3. tenant-scoped RAG、引用和无答案转人工：`ENT-CS-003` 已形成代码候选，召回/隔离/审计矩阵待验收。
4. Support Agent 状态机和 JSON Schema 输出：`ENT-CS-004` 已形成 forced-RLS run/turn、API-owned generation、独立 Worker cell、RAG citation guard、上下文压缩、Provider 超时降级和 generation-bound TTS authorize 代码候选；恢复测试后验收。
5. 只读工具、可逆写工具和高风险工具三级 Policy：`ENT-CS-005` 已形成
   forced-RLS 不可变 Registry、固定 risk/scope/confirmation 映射、封闭 schema、Worker fence、
   参数 hash、幂等授权记录和 DB insert guard 代码候选；`ENT-CS-006` 已形成 order/logistics/inventory
   只读 Adapter contract、默认 not_configured、simulated mock、15秒 claim lease、5秒事务外调用、
   fenced finalize、严格结果/hash 回放和 customer ownership guard；`ENT-CS-007` 已形成 ticket/callback/note
   严格 contract、120秒客户 turn 确认、AES-GCM Outbox、Provider 幂等/fingerprint fence、Cell Worker
   恢复与 execution/outbox 原子 finalize 代码候选；`ENT-CS-008` 已形成不可执行 high-risk handoff
   request、run/session/customer/revision/risk evidence 绑定、幂等重放和 run/session 原子接管代码候选。
   四项均待恢复自动化、真实 PostgreSQL/RLS/并发与崩溃恢复验收；真实 Provider 仍待 CS-006/007
   配置。`ENT-CS-009` 已形成 queue SLA/lease、exclusive claim、self-release/renew 和 manager reassign
   代码候选，待恢复真实 PostgreSQL/RLS/并发与断线回收验收。
6. `ENT-CS-010` 已形成客服坐席工作台、字幕快照、客户/知识/风险上下文、Agent cancel fence 和 lease
   heartbeat 代码候选；下一阶段补 Worker interrupt/ack、真实 LiveKit 媒体控制、浏览器与 AC-ENT-0031 验收。
7. 工单、回拨、结果、质检和分析。
8. CRM/Ticket Adapter outbox。

### 5.2 退出门禁

- 无知识证据时不编造企业事实。
- 工具重复请求只执行一次；失败不得对客声称成功。
- 客户请求人工后 AI 在限定时间内停止发言。
- 接管坐席收到完整上下文、已执行动作和风险。
- CRM 不可用时会话正常结束，outbox 恢复后只同步一次。

## 6. E3 出海外呼受控试点

### 6.1 前置条件

- 至少一个真实 PSTN/SIP Provider。
- 目标国家法律和业务规则已经过企业法务确认。
- 可验证的线索授权证据。
- 企业禁拨名单和国家策略。
- 人工接管坐席可用。
- 计费、审计、投诉和停止机制通过。
- E2 人工队列和接管已通过真实链路验收，不能为外呼单独复制另一套接管状态。

### 6.2 交付顺序

1. campaign、lead、consent、suppression 和 call task。
2. CSV/CRM 导入、号码规范化和去重。
3. 国家策略、当地时间、频控和审批。
4. Agent 话术、知识和品牌告知。
5. Scheduler、原子 claim、hold 和 PSTN dispatch。
6. 实时字幕、Agent 对话、拒绝联系和接管。
7. outcome、回访、CRM 同步和分析。
8. 小白名单、单国家、单活动灰度。

### 6.3 退出门禁

- 无授权、禁拨、过期授权、错误时间和超频任务拨号数为零。
- AI 身份、品牌和目的告知可验证。
- 客户拒绝后立即挂断并阻断后续任务。
- 高风险内容不能由 AI 自动完成。
- webhook 重放、Worker 重启和网络重试不重复拨号或扣费。

## 7. E4 SaaS 发布硬化

入口条件：E1-E3 已按目标放行等级完成；任何 `blocked` Provider 或法律条目都有正式“不开放范围”，不能用功能开关掩盖未知风险。

- 多实例 Scheduler/Worker 的数据库租约或队列协调。
- SaaS 控制面高可用、区域路由、cell 隔离和受控迁移。
- 租户级限流、配额、预算和异常熔断。
- 数据保留、导出、删除、备份和恢复演练。
- SAST、依赖扫描、渗透测试和密钥轮换。
- 监控、告警、值班手册、容量和成本报告。
- 订阅续费、欠费暂停、超额策略、账单对账和客户状态页。
- 跨故障域 PostgreSQL 自动切换、旧主 writer fencing、重新加入和异地主机不可变备份/PITR；同机副本或人工切换不能替代生产门禁。
- 以 25/50/100 并发和 120 分钟真实混合流量验证 tenant 限流、Worker 容量和 noisy-neighbor 隔离。
- iOS、Web 正式构建；Android 按既定后续计划进入产品化验收。

## 8. 团队分工建议

| 责任域 | 主要工作 |
| --- | --- |
| 产品/设计 | 流程、权限、话术、坐席和会议体验 |
| Flutter | 企业入口、会议、ReplayKit、接管和通知 |
| Web | 企业控制台、坐席、参会和屏幕共享 |
| Backend | tenant、领域状态机、API、数据、计费和审计 |
| RTC/AI | LiveKit、PSTN、Agent、RAG、模型和抢话 |
| QA/SRE | 自动化、真机、并发、故障注入、部署和监控 |
| 法务/安全 | 国家策略、授权模板、保存和供应商评审 |

## 9. 分支和发布策略

- 每个 `ENT-*` 任务独立提交，禁止把模型切换与领域数据迁移混在一个发布。
- schema migration 必须向前兼容上一版客户端和 Worker。
- 企业功能使用 server-side feature flag，客户端开关不是真值。
- 企业试点按 tenant allowlist 开放。
- SaaS 试点使用正式域名和 PostgreSQL；SQLite 构建不接受真实企业数据。
- 外呼先单国家、单 Provider、低并发、白名单；达到门禁后逐步扩大。
- 屏幕 OCR、自动工具写入和营销 A/B 默认关闭。

### 9.1 单任务交付流程

1. 从任务表选择一个依赖已满足的 `ENT-*`，在开始时标记 `in_progress`。
2. 先补失败/越权/降级测试，再实现最小代码，不顺手重构无关模块。
3. 运行定向测试、受影响 workspace 全量、typecheck、文件大小和 `git diff --check`。
4. 更新任务状态、验收 ID、设计/技术文档和 `PROGRESS_LOG.md`。
5. 只暂存该任务文件，使用包含任务号的独立提交并推送。
6. 真实环境证据未齐时最多进入 `ready_for_acceptance`，不能标记 `accepted`。

## 10. 风险和处理

| 风险 | 处理 |
| --- | --- |
| 国家规则变化 | 版本化 CountryPolicy，过期即阻断活动 |
| LLM 幻觉 | RAG 引用、保守输出、工具策略和人工接管 |
| 批量误拨 | 授权快照、执行时复核、租户熔断和全局停止 |
| 数据串租户 | tenant-scoped Repository、DB 约束和攻击测试 |
| 屏幕泄露 | 默认不保存、主持人权限、显式授权和短期 token |
| 多租户 noisy neighbor | 租户级限流、并发、预算、cell 熔断和专属托管容量 |
| 控制面故障 | 区域数据面短时自治，禁止新开通和套餐变更 |
| 区域误路由 | 签名 route document，区域不匹配拒绝写入 |
| Provider 锁定 | Capability Adapter 和 contract test |
| 回声/抢话 | WebRTC AEC、exact reference、VAD 和半双工降级 |
| 上游未提交实现漂移 | 只对齐稳定提交；记录公共/enterprise migration manifest 和接口版本，不从个人工作区复制 WIP |
| 公共表仍为 user/optional owner scope | `scope_type + scope_id` 一等建模、复合 FK、forced RLS 和跨租户负向测试通过前禁止企业流量 |
| 临时依赖漏洞例外过期 | 记录 owner/版本/缓解/到期日；到期前修复或重新评审，不能宣称零漏洞 |
| 同故障域伪高可用 | 自动切换必须跨物理故障域并隔离旧主；异地主机备份/PITR 独立验收 |

## 11. 每阶段交付物

每个阶段必须同时交付：

- 功能和技术文档更新。
- schema migration 和回滚说明。
- API contract 和 Provider contract test。
- 单元、集成、端到端和故障注入测试。
- 真实 Beelink/服务器和 iPhone/Web 验收记录。
- 指标看板、告警和运行手册。
- `PROGRESS_LOG.md` 会话交接状态。

## 12. E0 立即执行清单

| 顺序 | 任务 | 结果 |
| ---: | --- | --- |
| 1 | 验收 `ENT-CORE-001/002` | 冻结 Tenant/Member/RBAC 作为所有企业接口权限基线 |
| 2 | `ENT-CORE-003` | 决定 Web 技术栈并建立生产脚手架、构建和登录壳 |
| 3 | `ENT-DATA-001` | 建立 PostgreSQL schema、migration、复合 FK、RLS 和备份 smoke |
| 4 | `ENT-DATA-002/003` | 强制 tenant Repository，建立 inbox/outbox 和幂等重放门禁 |
| 5 | `ENT-DATA-007/008` | 收敛公共/企业 migration 与 Primary Runtime，为通讯公共表增加不可省略的 tenant scope 和 forced RLS |
| 6 | `ENT-CORE-009/011` | 完成开通 saga、homeRegion/cell 和签名 route document |
| 7 | `ENT-CORE-013/014/015` | 建立统一通讯会话、tenant-aware Worker Dispatch 和企业设备/声音策略 |
| 8 | `ENT-UI-001/002/003` | 把设计令牌、Material Icons、租户权限导航和统一状态变为生产组件 |
| 9 | `ENT-CORE-006/008` | 完成审计和 Provider capability/readiness 真值 |
| 10 | `ENT-CORE-007/010/012` | 完成 tenant billing account、套餐、entitlement、预算、ledger 和账期聚合 |
| 11 | `ENT-CORE-004/005` | 知识、术语和话术版本闭环均已完成代码与本地机制验证，进入验收 |
| 12 | `ENT-DATA-009` | 验收 staging 全量/增量 hash、writer fence、切换/回滚和旧写入者清退证据；本地机制代码已完成 |
| 13 | `ENT-UI-004..012` | 完成公共页面、响应式、无障碍、Web 发布门禁、Flutter 企业入口和访客参会壳代码候选 |

E0 基线完成后已形成 `ENT-MTG-001/002` 代码候选；未通过真实 PostgreSQL、tenant/RBAC/token 攻击、Provider、浏览器与真机门禁，仍不能计为 E1 完成。

当前进展：`ENT-DATA-001` 已完成三十四段 schema 代码，等待 staging PostgreSQL migrate/restore/PITR
证据；`ENT-CS-001..009` 已分别形成客服领域/恢复 runtime、统一入站 Adapter、tenant RAG、Support Agent、
Tool Registry 授权边界、只读 Adapter 租约执行、可逆写确认/密文 Outbox、不可执行高风险接管和坐席
queue/SLA/exclusive claim 代码候选。因测试暂缓、migration/真实恢复、真实 Provider、浏览器或真机门禁未完成，
`ENT-OBS-001`、`ENT-UI-004/008/009/010/011/012`、`ENT-MTG-001..013` 和 `ENT-CS-001..009` 继续保持
`in_progress`。恢复测试时除既有 CS-001..008 矩阵外，还必须执行 CS-009 的 up/down/forward、forced-RLS
双租户、角色×操作、同会话双 claim、lease 到期、release/reassign、幂等冲突、崩溃回滚和重启恢复矩阵。
staging `ENT-DATA-009` 和 `ENT-REL-002/003` 的对象清理、跨故障域/PITR 仍未通过。
