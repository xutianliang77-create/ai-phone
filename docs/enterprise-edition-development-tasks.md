# 无界AI企业版开发任务

版本：v1.17
日期：2026-07-18
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
- `ENT-DATA-001` 已有十三段 PostgreSQL up/down migration、tenant-first 索引、复合 FK、强制 RLS、checksum/锁和备份归档 smoke；`0008` 增加 user directory，`0009` 增加 cell pending-work projection，`0010` 修正 opaque subject，`0011` 增加企业通讯会话绑定，`0012` 增加 scope-bound Worker dispatch grant，`0013` 增加企业通讯运行策略、授权证据和不可变快照。一次性本地 PostgreSQL 16 验证不替代真实 migrate/restore/PITR 证据，任务保持 `in_progress`。
- `ENT-DATA-002` 已完成单一 `legacy|postgres` Enterprise Repository runtime adapter，Tenant/Member/Audit、Directory、lifecycle 和 HTTP 路由均通过同一 runtime；PostgreSQL 只有在启动 schema gate 已验证时才允许选中，不存在 fallback、双写或局部切换。独立 cell Worker 已实现 cell/worker/poll/batch/lease 配置、forced-RLS pending discovery、tenant transaction 二次复核、lifecycle/outbox claim/finalize、失败隔离和显式 publisher 降级。代码与本地自动化完成，进入 `ready_for_acceptance`；真实 PostgreSQL、并发 claim、容量和恢复证据仍属于 H3 门禁。
- `ENT-DATA-004` 已实现 JSON/SQLite 六类企业记录源读取、SQLite 临时副本与 `quick_check`、维护窗口空目标导入、事务内读回，以及逐集合 count/SHA-256 和总 hash 对账；任何不一致整体回滚。该工具只迁移当前 Tenant/Member/Job/Audit/Inbox/Outbox 演示数据，不是客户生产迁移通道，进入 `ready_for_acceptance`。
- `ENT-DATA-003` 已完成 tenant-scoped inbox 去重、稳定 JSON hash、领域写入/inbox/outbox 同事务、outbox 内容不可变、lease claim、指数退避和恢复处理；100 次相同事件重放只执行一次领域副作用，跨租户 provider ID/idempotency key 相互隔离。SQLite 证据仅用于自动化和封闭演示，真实 PostgreSQL 并发 claim 与 Provider sandbox 仍待正式验收。
- `ENT-DATA-007` 已把上游稳定提交 `fe1c3c2` 的公共 Primary Runtime 纳入企业分支，并以 `API_STORAGE_DRIVER` 作为唯一进程级 driver。统一启动编排现验证公共31段和 enterprise 13段 manifest，核对数据库 name/OID 后才创建企业 runtime；API tenant pool 复用公共 Primary pool，directory、cell、migration 和 maintenance 使用分权连接配置，Worker 不获取 directory 凭证。代码和本地自动化完成，进入 `ready_for_acceptance`；真实 PostgreSQL 双 manifest、最小权限角色、并发和恢复证据仍属于 H3。
- `ENT-DATA-008` 已新增公共 migration `031_communication_resource_scope`：session、leg、transcript、playback、Provider operation、dispatch/capacity、participant consent、recording 和 ingress 共12张表具有不可空 `scope_type + scope_id`、复合 scope FK、写入 scope trigger 和 forced RLS。企业 tenant transaction 同时设置 `app.tenant_id/app.scope_type/app.scope_id`，只向企业 unit-of-work 暴露六类白名单、单 SELECT、显式 scope predicate 的通讯 Repository；跨租户返回行会被二次拒绝。代码和本地自动化完成，进入 `ready_for_acceptance`；真实双租户 PostgreSQL CRUD/迟到事件攻击仍属于 A1/H3。
- `ENT-CORE-009` 已完成租户创建/区域开通幂等、失败重试、暂停、导出和删除执行器；导出固化 tenant/member/job 与 actor scope 快照，执行使用租约、有界重试和 receipt hash，删除只在 receipt 校验后进入 `deleted`，等待真实生命周期服务与对象存储验收。
- `ENT-CORE-011` 已完成按 active membership 签发短期 HMAC route document、route epoch 签名、公开端点校验和企业写入区域 guard，等待正式域名/密钥验收。
- `ENT-CORE-013` 已新增 enterprise `0011` 统一会话绑定表和事务型 Repository：Meeting/Support/Marketing 使用同一 tenant-scoped 公共 session，数据库复合 FK 固定唯一业务归属，route epoch、policy/entitlement 版本和区域快照不可变。状态机覆盖 dispatch/ready/active/degraded/draining/terminal，使用 version、generation 和 event sequence 拒绝旧路由、旧 Worker、重放与非法倒退；代码、定向矩阵和一次性本地 PostgreSQL 16 普通角色 RLS/down-up 验证完成，进入 `ready_for_acceptance`，不代表 A1/H3 或生产门禁通过。
- `ENT-CORE-014` 已新增 enterprise `0012` Worker dispatch grant、短期 HMAC ticket 和运行时 Adapter。签发从当前 binding 派生 tenant/session/cell/route epoch/generation/capability，capacity reserve 与 dispatch/grant 原子提交；accept/heartbeat/副作用授权/finalize 都重读 binding/grant/lease，cancel 同事务释放容量，旧 route/generation 和迟到结果失败闭合。代码、负向矩阵和一次性本地 PostgreSQL 16 普通角色验证完成，进入 `ready_for_acceptance`，不代表真实多实例、H3 容量或生产门禁通过。
- `ENT-CORE-015` 已新增 enterprise `0013` 通讯策略版本、purpose-specific 授权证据和不可变运行快照，发布 API 由 `tenant:write` 与签名 route document 双重保护；device/cloud ASR、翻译、TTS 依据有效 readiness/fingerprint 解析，声纹、录音和诊断音频无独立有效授权即禁用。Worker ticket v2 绑定 policy snapshot/version，签发与 lifecycle 都对失效快照、过期 readiness、未允许 capability 和撤回授权失败闭合。代码、负向矩阵和一次性本地 PostgreSQL 16 普通角色 RLS/down-forward 机制验证完成，进入 `ready_for_acceptance`；不代表真实设备/Provider、A1/H2/H3 或生产门禁通过。
- `ENT-CORE-008` 已完成 PSTN/CRM/Calendar/Channel 统一 capability document、实时 probe contract、敏感配置过滤和明确降级，等待真实 Provider 验收。
- `ENT-CORE-006` 已完成 append-only audit 契约、`audit:read` 查询 API、tenant/filter/sort/expiry 绑定的 HMAC cursor、成员与租户生命周期高风险结果埋点，以及 SQLite/PostgreSQL UPDATE/DELETE 拒绝约束，等待正式密钥、真实 PostgreSQL 与验收矩阵。
- `ENT-UI-001` 已完成生产颜色/字号/尺寸/圆角令牌、Material Icons 语义注册表、Flutter 对照和依赖扫描，等待验收。
- `ENT-UI-002` 已完成 active membership 租户选择、共享 role/scope 真值、九角色 route discovery、scope 导航、直接/嵌套路由 guard 及签名 route document 联调，等待验收。
- `ENT-UI-003` 已完成八态注册表、语义图标、ARIA live/alert、trace ID、可行动入口和组件矩阵，并接入服务端 Provider capability、租户生命周期 job 及 409/412 冲突映射，等待验收。
- PostgreSQL runtime、cell Worker 和演示数据导入对账代码已接通，但尚未在真实 PostgreSQL 上执行 migrate/import/reconcile、并发租约、恢复或容量门禁，不能据此宣称企业试点或生产可用。生命周期执行器也尚未接入真实对象存储/Provider 清理服务。基础 append-only 审计已实现，但受控审计导出、retention/对象清单和 Provider 删除收敛仍属于 `ENT-UI-008/ENT-REL-002`，企业业务聚合和外部 Provider 仍未通过实现或真实环境门禁。
- 主产品稳定提交 `fe1c3c2` 已作为 `ENT-DATA-007` 基线合入企业分支；后续个人工作区 WIP 仍不得直接进入企业提交。公共通讯 tenant scope 已完成本地代码门禁，切换/对账证据仍由 `ENT-DATA-009` 完成，主产品 staging 结果不能继承为企业验收证据。

## 2. P0 企业公共底座

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-CORE-001 | Tenant 和 Member | 无 | tenant/member schema、Repository、API | 所有企业资源强制 tenant scope | ready_for_acceptance |
| ENT-CORE-002 | RBAC | CORE-001 | 角色、scope、服务端 guard | 越权矩阵全部拒绝 | ready_for_acceptance |
| ENT-CORE-003 | 企业 Web 应用基础 | CORE-001/002 | 技术选型、应用脚手架、登录会话、路由和构建 | 干净环境可构建；登录失败不进入壳；不包含模型/Provider 地址 | ready_for_acceptance |
| ENT-CORE-004 | 企业知识版本 | CORE-001 | source/version/chunk/publish | 未发布和过期知识不可检索 | todo |
| ENT-CORE-005 | 企业术语和话术 | CORE-004 | term pack、script template | ASR/翻译/LLM 使用同一版本引用 | todo |
| ENT-CORE-006 | 审计事件 | CORE-001 | append-only audit API | 高风险操作都有 actor/target/result | ready_for_acceptance |
| ENT-CORE-007 | 企业用量与预算 | CORE-001 | ledger category、budget、alert | 重试不重复 hold/settle | todo |
| ENT-CORE-008 | Provider readiness | 无 | PSTN/CRM/Calendar/Channel capability | 缺配置明确 not_ready，不伪造成功 | ready_for_acceptance |
| ENT-CORE-009 | SaaS 租户生命周期 | CORE-001 | signup/provision/suspend/export/delete saga | 重试不重复租户，失败不标 active | ready_for_acceptance |
| ENT-CORE-010 | 套餐和 Entitlement | CORE-001/007 | tenant billing account、plan、subscription、seat、entitlement | 服务端按 tenant 和版本执行权益、限额和归属 | todo |
| ENT-CORE-011 | Tenant Directory | CORE-009 | homeRegion/cell、签名 route document | 区域错误时拒绝业务写入 | ready_for_acceptance |
| ENT-CORE-012 | SaaS 计量聚合 | CORE-007/010 | tenant usage event、账期聚合、调整流水 | 不修改原始 ledger，企业账单按 tenant account 可对账 | todo |
| ENT-CORE-013 | 企业统一通讯会话绑定 | DATA-007/008、CORE-001/011 | communication session、participant/media leg 绑定、route epoch、状态机 | 所有企业会议/客服/外呼共享 tenant-scoped session；重启和迟到事件可收敛 | ready_for_acceptance |
| ENT-CORE-014 | Tenant-aware Worker Dispatch | CORE-013、DATA-003/008 | 签名 dispatch ticket、capacity/lease、cancel/fence、cell route | 缺 tenant/cell/generation 失败闭合；旧 route/generation 不能提交副作用 | ready_for_acceptance |
| ENT-CORE-015 | 企业设备、声音和录制策略 | CORE-013/014、CORE-002 | device/cloud ASR、翻译、TTS、voice identity、录制和降级策略 | 策略按 tenant/version 执行；声纹和录音无授权不启用 | ready_for_acceptance |
| ENT-DATA-001 | 企业 PostgreSQL schema | CORE-001 | schema、migration、FK、backup | 真实企业试点数据库门禁通过 | in_progress |
| ENT-DATA-002 | Tenant-scoped Repository | DATA-001 | Repository context、runtime adapter、cell Worker 和 lint/test | 不存在无 tenant 查询入口、fallback 或双写 | ready_for_acceptance |
| ENT-DATA-003 | Inbox/Outbox | DATA-001 | 幂等收件、事务发件、重试 | 重放100次仅一次副作用 | ready_for_acceptance |
| ENT-DATA-007 | 公共 Primary Runtime 收敛 | DATA-001/002/003、上游稳定提交 | 双 migration manifest、单 Storage Driver/startup gate、分权连接池 | HTTP/企业 Repository/Worker 共用一个 verified Primary Runtime；无 fallback、shadow read 或双写 | ready_for_acceptance |
| ENT-DATA-008 | 公共通讯资源 tenant scope | DATA-007、CORE-001 | scope_type/scope_id、复合 FK、forced RLS、scoped Repository | session/leg/dispatch/provider/playback 无可选 owner 授权入口，跨租户矩阵全部拒绝 | ready_for_acceptance |
| ENT-OBS-001 | 企业链路追踪 | CORE-006 | trace IDs、质量和成本报告 | session 到 ledger/tool 可追踪 | todo |

## 3. P0 企业 Web 与客户端体验

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-UI-001 | 视觉令牌与图标注册表 | CORE-003 | Web theme、Material Icons 映射、组件令牌 | 颜色/字号/8px圆角与 Flutter 一致；不混用图标库 | ready_for_acceptance |
| ENT-UI-002 | 租户选择与权限导航 | CORE-002/003/011 | route discovery、tenant picker、scope nav、guarded route | 九角色入口正确；直接 URL 仍由服务端拒绝 | ready_for_acceptance |
| ENT-UI-003 | 统一页面状态 | CORE-003/008 | loading/empty/not_ready/degraded/forbidden/conflict/processing/failed 组件 | 不出现空白页、假成功或覆盖冲突版本 | ready_for_acceptance |
| ENT-UI-004 | 企业工作台 | UI-002/003、CORE-007/008/010/012、OBS-001 | readiness、待办、业务状态、用量和告警 | 所有状态来自服务端；无真实样本不绘制趋势 | todo |
| ENT-UI-005 | 成员与角色设置 | UI-002/003、CORE-001/002 | 成员列表、邀请、角色/状态编辑、scope 说明 | 角色变更与服务端 scopes 一致；越权入口不可执行 | todo |
| ENT-UI-006 | 知识与术语管理 | UI-003、CORE-004/005 | source/version/publish、term pack、script template 页面 | 未发布/过期内容明确标识且不能被错误发布 | todo |
| ENT-UI-007 | 区域、Provider、套餐与用量 | UI-003、CORE-007/008/010/011/012 | region/route、capability、entitlement、budget、billing 页面 | homeRegion 只读；不回显密钥；未配置显示 not_ready | todo |
| ENT-UI-008 | 审计与分析 | UI-003、CORE-006、OBS-001 | 审计筛选/详情/导出、质量和成本下钻 | 敏感字段脱敏；导出有目的、范围、到期和审计 | todo |
| ENT-UI-009 | 响应式、深色和无障碍 | UI-001..008 | 320/600/960/1280 布局、dark mode、键盘和动态字体 | 无横向溢出；WCAG AA；200%缩放核心操作可达 | todo |
| ENT-UI-010 | Web 自动化与发布门禁 | UI-002..009 | unit、contract、E2E、视觉回归、bundle 和错误监控 | 角色×页面×状态矩阵通过；生产构建无示例数据 | todo |
| ENT-UI-011 | Flutter 企业入口 | UI-001/002、CORE-002 | 工作台、会议、接管、告警和我的入口 | 不复制批量管理；离线/越权不显示乐观成功 | todo |
| ENT-UI-012 | Web 访客参会壳 | CORE-003、MTG-002 | guest token 入会、设备检查、字幕和共享入口 | token 仅访问指定 meeting；不暴露租户导航和成员数据 | todo |

`ENT-CORE-003` 的生产脚手架、登录和构建已完成；`ENT-UI-001/002/003` 已进入验收。Provider capability 与租户生命周期 job 已使用服务端真值；尚未实现的业务领域页面继续明确显示未就绪。静态 HTML 原型不进入生产构建，也不能替代这些任务的验收。

## 4. P0 企业会议

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-MTG-001 | Meeting 聚合 | CORE-013、DATA-003/008 | meeting/participant/artifact schema、communication session binding | 重启后会议和统一会话状态可恢复 | todo |
| ENT-MTG-002 | 创建和入会 | MTG-001 | API、短期 token、Web/Flutter 入口 | host/guest/member 权限正确 | todo |
| ENT-MTG-003 | 企业实时翻译 | MTG-002、CORE-014 | tenant-aware Worker 路由、个人字幕语言 | 四人字幕和译音不串轨，旧 Worker 不恢复播放 | todo |
| ENT-MTG-004 | 屏幕共享租约 | MTG-002 | acquire/pause/resume/stop、CAS | 同时共享只成功一个 | todo |
| ENT-MTG-005 | Web 屏幕共享 | MTG-004 | getDisplayMedia、布局、控制 | screen/window/tab 可用 | todo |
| ENT-MTG-006 | iOS ReplayKit | MTG-004 | Broadcast Extension、Flutter bridge | 离开 App 后持续共享且可停止 | todo |
| ENT-MTG-007 | Android MediaProjection | MTG-004 | 平台桥接、前台服务 | iOS 产品化后进入真机门禁 | todo |
| ENT-MTG-008 | 共享系统音频 | MTG-005/006 | 独立 audio track 和策略 | 不进入错误 ASR，不形成回声环 | todo |
| ENT-MTG-009 | 共享自适应布局 | MTG-005 | simulcast、画面/字幕布局 | 小屏横屏大字体无重叠 | todo |
| ENT-MTG-010 | 主持人共享控制 | MTG-004 | grant/revoke/force stop | 撤销后旧 track 不恢复 | todo |
| ENT-MTG-011 | 会后材料 | MTG-003、CORE-004 | transcript/review/action items | 结论可回溯 segment | todo |
| ENT-MTG-012 | 屏幕 OCR 翻译 | MTG-005、CORE-004 | keyframe/hash/OCR/layout events | 默认关闭，失败不影响共享 | todo |
| ENT-MTG-013 | 日历 Adapter | MTG-001、CORE-008 | contract、mock、首个 Provider | 重试不重复创建会议 | todo |

## 5. P1 AI 客服

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-CS-001 | 客服领域模型 | CORE-013、DATA-003/008 | channel/queue/session/case/tool schema、communication session binding | 状态机和重启恢复通过 | todo |
| ENT-CS-002 | 呼入 Channel Adapter | CS-001、CORE-008/014 | PSTN/Web/App contract、tenant dispatch | 三渠道创建同一 tenant-scoped communication session | todo |
| ENT-CS-003 | Tenant RAG | CORE-004、CS-001 | 检索过滤、引用、无答案路径 | 不跨租户、不无依据回答 | todo |
| ENT-CS-004 | Support Agent | CS-003、CORE-014/015 | 状态机、JSON schema、上下文压缩、声音/降级策略 | thinking 不泄露，超时可降级，取消后旧 TTS 不恢复 | todo |
| ENT-CS-005 | Tool Registry | CS-001 | 工具 schema、风险和权限 | 未注册工具不可执行 | todo |
| ENT-CS-006 | 只读工具 | CS-005 | order/logistics/inventory mock adapter | 权限和客户归属校验通过 | todo |
| ENT-CS-007 | 可逆写工具 | CS-005 | ticket/callback/note adapter | 未确认不执行，重复只执行一次 | todo |
| ENT-CS-008 | 高风险接管 | CS-005 | refund/payment/identity policy | AI 永不自动完成高风险动作 | todo |
| ENT-CS-009 | 坐席队列 | CS-001 | routing、SLA、claim/release | 两坐席不能同时接管同一会话 | todo |
| ENT-CS-010 | 坐席工作台 | CS-009、CS-004 | 字幕、客户、知识和通话控制 | 接管上下文完整且 AI 停止发言 | todo |
| ENT-CS-011 | 工单和回拨 | CS-007 | case、callback、outbox | 外部失败可重试且不阻塞结束 | todo |
| ENT-CS-012 | 质检分析 | CS-004、OBS-001 | quality rules、dashboard | 能定位错误回答和未告知 | todo |

## 6. P1/P2 出海外呼营销

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-MKT-001 | Campaign 聚合 | CORE-001、DATA-003 | campaign/status/approval | 未审批活动不能调度 | todo |
| ENT-MKT-002 | 线索导入 | MKT-001 | CSV/API、E.164、去重、错误报告 | 批次可回滚且不重复线索 | todo |
| ENT-MKT-003 | 授权证据 | MKT-002 | consent schema/object/hash | 无有效授权任务数为零 | todo |
| ENT-MKT-004 | 禁拨名单 | MKT-002 | tenant/global scope、撤回 | 拒绝后立即阻断全部待任务 | todo |
| ENT-MKT-005 | Country Policy | MKT-003/004 | 时间、频控、告知、语音信箱策略 | 版本过期时活动阻断 | todo |
| ENT-MKT-006 | 活动审批 | MKT-005、CORE-002 | validate/approve/reject | 审批固化策略和数据快照 | todo |
| ENT-MKT-007 | Scheduler | MKT-006、CORE-007/014 | due query、CAS claim、tenant capacity、并发 | 50并发不重复 claim，单租户超载不拖垮 cell | todo |
| ENT-MKT-008 | PSTN dispatch | MKT-007、CORE-008/014、DATA-008 | Provider adapter、webhook、hold、scoped dispatch | 重放不重复拨号/扣费，旧 route/generation 不能拨号 | blocked |
| ENT-MKT-009 | Marketing Agent | MKT-008、CORE-004 | 话术状态机、知识和告知 | 无依据不承诺，拒绝立即结束 | todo |
| ENT-MKT-010 | 实时监控 | MKT-008、OBS-001 | dashboard、字幕、风险 | 状态延迟和失败可观测 | todo |
| ENT-MKT-011 | 人工接管 | MKT-009、CS-009 | handoff、超时和回拨 | 接管后 AI 音频立即停止 | todo |
| ENT-MKT-012 | Outcome | MKT-009 | disposition、intent、next action | 有证据且不重复生成任务 | todo |
| ENT-MKT-013 | CRM Adapter | MKT-012、CORE-008 | contract、outbox、首个 Provider | 外部失败恢复后只同步一次 | blocked |
| ENT-MKT-014 | 活动分析 | MKT-012、OBS-001 | funnel、cost、complaint | 指标可按国家/活动/版本拆分 | todo |

`blocked` 只表示真实服务商账号未提供；Adapter、mock、contract test 和 UI 降级仍必须开发。

## 7. P2 企业发布

| 编号 | 任务 | 依赖 | 交付物 | 完成定义 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ENT-DATA-004 | SQLite/JSON 演示数据导入 | DATA-002/003 | source copy/check、empty-target import、count/hash reconcile | 不一致回滚；只迁移内部演示数据，不承载生产 | ready_for_acceptance |
| ENT-DATA-005 | Cell 数据迁移和回滚 | CORE-011、DATA-001/009 | export/import/reconcile/rollback | 记录、ledger、hash 全量一致 | todo |
| ENT-DATA-006 | 多实例协调 | DATA-003/007/008 | lease/queue、无全局内存真值 | Worker 故障不重复执行 | todo |
| ENT-DATA-009 | Primary 数据切换和全量对账 | DATA-007/008、CORE-013/014 | 全量/增量 count/hash、水位、writer fence、cutover/rollback 证据 | 旧 writer 清退；切换前后 tenant/session/ledger/object 引用一致 | todo |
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
