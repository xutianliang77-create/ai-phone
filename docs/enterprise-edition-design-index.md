# 无界AI企业版设计文档索引

版本：v1.70
日期：2026-08-31
状态：SaaS 详细设计基线，已纳入统一通讯平台和 PostgreSQL Primary 演进

## 1. 产品边界

企业版建立在无界AI统一通讯平台之上，复用 `communicationSession`、LiveKit、
Speech/Translation/Voice Agent Runtime、Provider Adapter 和可靠事件能力，只新增三条企业业务主线：

1. 出海 AI 外呼营销。
2. AI 客服。
3. 企业会议，包括屏幕共享。

企业版不扩展为通用 OA、CRM 或呼叫中心全家桶。客户、工单、线索和会议数据只服务于上述三条主线；外部 CRM、工单、日历和通讯渠道通过 Adapter 集成。

企业版只以多租户 SaaS 方式提供。客户使用企业 Web 控制台、Flutter App、Web 参会页和公开 API，不安装或维护 AI Phone 服务器、模型、LiveKit、数据库或 PSTN Bridge。当前范围不包含本地化或私有化交付。

## 2. 文档清单

| 文档 | 说明 |
| --- | --- |
| [企业版详细功能设计](./enterprise-edition-functional-design.md) | 用户、页面、流程、状态和业务规则 |
| [企业版 UI 详细设计](./enterprise-edition-ui-design.md) | 视觉令牌、图标、布局、组件、页面和响应式规则 |
| [企业版技术架构](./enterprise-edition-technical-architecture.md) | 系统边界、组件、数据流和部署拓扑 |
| [企业版详细技术设计](./enterprise-edition-technical-design.md) | API、数据模型、事件、并发、安全和降级 |
| [企业版开发方案与计划](./enterprise-edition-development-plan.md) | 阶段、依赖、里程碑、风险和发布策略 |
| [企业版开发任务](./enterprise-edition-development-tasks.md) | 可执行任务、完成定义和依赖关系 |
| [企业版验收任务与计划](./enterprise-edition-acceptance-plan.md) | 功能、真机、并发、合规和放行门禁 |

### 2.1 四份核心设计的阅读顺序

1. [企业版详细功能设计](./enterprise-edition-functional-design.md)：先确认产品边界、角色、页面、四条核心流程和异常状态。
2. [企业版 UI 详细设计](./enterprise-edition-ui-design.md)：把功能映射为一致的品牌视觉、Material Icons、页面布局、状态和权限展示。
3. [企业版技术架构](./enterprise-edition-technical-architecture.md)：再确认控制面/区域数据面、业务/实时/媒体路径、逻辑组件和当前仓库映射。
4. [企业版详细技术设计](./enterprise-edition-technical-design.md)：最后落到 API 契约、数据模型、事务、幂等、Provider readiness、安全和测试门禁。

四份文档共同使用成熟度语义 `designed`、`implemented`、`verified`、`production_ready`，运行时 readiness 另用 `not_configured`、`checking`、`ready`、`degraded`、`not_ready`；SQLite 环境固定报告 `demo_only`。文档中的目标组件不自动代表代码已经实现；当前实现和任务状态以开发任务表、代码、测试和环境证据为准。

当前 `ENT-DATA-002/004/009` 已具备单一 Enterprise Repository runtime、独立 PostgreSQL
cell Worker、JSON/SQLite 演示导入，以及全业务表 Primary 切换/恢复签名证据工具。
一次性本地 PostgreSQL 16 双库、writer fence、逻辑恢复和篡改负测已通过机制验证；
这不等于 `ENT-DATA-001`、异地主机 WAL/PITR、容量、安全或企业生产门禁已经通过。

无界AI主产品公共 PostgreSQL migration、Primary Runtime、可靠 Inbox/Outbox、
fencing、Billing/Product Records、verify-full 和韧性代码已形成稳定提交 `fe1c3c2`，并由
`ENT-DATA-007` 合入企业分支。企业版已经完成单 driver、双 manifest、同库身份和分权
连接的本地自动化，当前 manifest 为公共31段、enterprise 56段；`ENT-DATA-008` 和
`ENT-CORE-013/014/015` 已完成公共通讯 tenant scope、企业业务会话绑定、签名 Worker dispatch fence
及设备/声音/录制策略快照的代码/本地自动化，但不能继承主产品 staging 验收。`ENT-DATA-009` 已增加
31+16 migration manifest 的历史本地证据、全表主键分页 count/hash、WAL 水位、writer fence、签名
cutover/restore 证据和 production startup 绑定门禁；当前 `0017..0056` 必须按31+56重新生成切换证据。
`ENT-DATA-005` 已增加单租户跨 Cell 的签名 export/cutover/rollback 维护链路：动态覆盖全部
enterprise tenant 表和公共 tenant communication scope，检查活动会话/租约、源只读与旧 writer 清退，
以目标空租户、外键顺序流式导入、对象引用 receipt、逐表 count/SHA-256 和 route epoch +1 对账失败闭合；
回滚从当前 Cell 反向全量覆盖旧 Cell。当前只通过静态门禁，未执行真实31+56 PostgreSQL、对象复制、
控制面路由发布或跨 Cell 演练，任务保持 `in_progress`。
`ENT-DATA-006` 已把 `platform_pending_work` 升级为同 Cell 多实例持久协调队列：Cell 角色只能在
forced-RLS 与数据库 trigger 下更新 owner/generation/lease 三类协调列，使用单事务
`FOR UPDATE SKIP LOCKED` 批量 claim，执行期间续租，完成/重试后按 owner+generation 条件释放；租户业务
job/outbox 的 attempt/CAS 和稳定 Provider event/job ID 仍是最终副作用栅栏。Redis 只能作为可选唤醒优化，
不得成为队列或租户状态真值。当前只通过静态门禁，未执行 `0050`、真实 PostgreSQL/RLS、多进程崩溃恢复或
Provider 去重验收，任务保持 `in_progress`。
`ENT-REL-001` 已增加企业候选版本安全门禁：CI 对 tracked/untracked 文本执行21条高置信 SAST 与密钥扫描，
生产依赖继续使用精确版本、缓解措施和到期日绑定的临时例外；隔离 test/staging 渗透执行器只从环境变量
读取凭据，结果不保存请求/响应正文，并以 HMAC 绑定 commit、目标、计划 hash、时间窗和必测攻击类别。
API 浏览器 CORS 已从任意 Origin 反射收敛为生产默认同源、显式精确 allowlist，固定 LiveKit 模块也不再
通过动态代码构造加载；iOS release 已移除 ATS 任意网络加载。当前静态扫描 P0/P1 为0、依赖高危/严重为0，但仍有14个 moderate 项属于同一
OpenTelemetry 临时例外；真实隔离环境渗透、独立 reviewer、密钥轮换/恢复和外部 SAST 报告均未执行，
`AC-ENT-0050` 未通过，任务保持 `in_progress`，不得宣称“零漏洞”或企业生产安全门禁已通过。
`ENT-REL-002` 已复用 audit export、tenant lifecycle 和 `platform_pending_work` 三条既有真值，增加
`0051` forced-RLS `data_lifecycle_jobs`：审计导出完成时在同一数据库事务自动登记不可变保存期/对象摘要，
到期或租户删除时由 Cell Worker 以 owner/generation/lease 处理真实对象删除，并在删除后再次 HEAD/本地存在性
复核；已不存在也只以显式 `already_absent` 回执收敛。数据库在创建导出时锁定 tenant 并拒绝删除期迟到导出，
租户删除在任何对象 job 或 processing audit export 未完成时不会调用最终执行器，
HTTP 删除执行器还必须返回数据库/对象/Provider 三段 remaining=0 的 hash 绑定回执。当前仅通过静态候选门禁，
未执行 `0051`、真实 S3/PostgreSQL/forced-RLS/故障注入或 Provider 清理，任务保持 `in_progress`。
`ENT-REL-003` 已把既有 PostgreSQL resilience runner 升级为 schema-v2 企业灾备证据门禁：演练开始前
验签并绑定 staging cutover evidence、候选 commit/image、topology、目标数据库 identity 以及当前公共31段/
enterprise 56段 manifest；各 Provider step 必须回显 run/group/step。签名结果进一步要求自动选主 timeline/
generation 递增、旧主 SQLSTATE `25006` 与旧 route/Worker fence、原主只读 standby 重入、第三故障域不可变
备份锁，以及 PITR 前后 marker 与全量/关键 manifest hash 一致。缺 Provider Adapter、容量/cutover 证据、独立
HMAC key 或任一实测字段即失败闭合。当前仅完成代码、未执行测试定义和静态门禁，不代表真实跨故障域切换、
异地主机恢复、RPO/RTO、`AC-ENT-0052` 或 H3 已通过，任务保持 `in_progress`。
`ENT-REL-004` 已增加 PostgreSQL-only 租户灰度与能力熔断控制：`0052` 对控制状态和事件证据分别强制
tenant RLS，`0053` 补齐 tenant root 自租户策略，使普通非 owner、非 `BYPASSRLS` 角色能够取得真实 tenant 行锁；
租户成员只读状态，平台内部专用密钥才能变更。2026-07-21 已在本机官方 PostgreSQL 16.14 从空库执行公共31段+
enterprise 53段、`53 -> 52 -> 51 -> 53` down/forward、普通角色双租户 RLS、两个连接池同 operation 竞争、
open/half-open/probe/close/kill 和追加证据不可变验证，并用两个 API 进程读取同库状态；定向6文件32项通过。
真实 Support/OCR/PSTN Provider 故障、kill SLO、告警和值班独立复核仍未执行，因此 `AC-ENT-0053` 未通过，
任务保持 `in_progress`，该本机单节点证据不等于 staging/H3 或生产门禁。
`ENT-REL-005` 已增加企业 SaaS 候选发布材料 schema、文件/hash/候选绑定 validator、CLI 和
`/health/release-ready` 强制门禁，并提供服务说明、发布说明、SLA、隐私/数据处理、管理员、运维/事件和发布清单
七份候选文档。A0–A3/H1–H3 任一缺失、跨候选、文件漂移、草稿或六方审批不全均返回 not_ready；本轮未运行
测试，也没有真实候选 image、验收证据、批准 SLA 或审批，因此任务保持 `in_progress`，不代表 A4/生产 ready。
`ENT-REL-006` 已增加 `0054` 控制面 instance/provision projection、独立最小权限 session、多实例
`SKIP LOCKED` Worker、generation/lease、PostgreSQL 开通异步202、开通/套餐配置失败闭合、同候选 live status
和运行手册。全局控制面表不进入 Cell 数据复制，活动 provision claim 会阻断迁移；控制面不参与已建立区域会话。
测试定义未执行，真实31+56 PostgreSQL、双实例/故障域/kill/network partition/区域自治均未验收，保持 `in_progress`。
`ENT-REL-007` 已增加 `0055` Tenant Admission：候选绑定四能力 policy、Cell/tenant并发/速率/有限队列、
weight virtual finish、runtime/operator函数、独立admin/reconcile Worker，并接入Worker Dispatch、Marketing PSTN和
Screen Share全生命周期。全局admission表不进入Cell复制，活动请求阻断迁移。测试定义未执行，真实RLS/双租户公平/
Provider媒体/25-50-100/120分钟soak均未验收，保持 `in_progress`，不得把REL-004称为限流器。
`ENT-REL-008` 已增加 `0056` Subscription Lifecycle：HMAC/时间窗 Provider event、可恢复 command、不可变
decision、账户/订阅转换 trigger、Cell Worker 双租约、冻结 entitlement 安全排空、恢复新版本、账期 usage
count/hash 重建、`billing:read` 状态 API、企业设置只读状态页和 health/release fail-closed。测试定义未执行，真实支付 Provider、
31+56 PostgreSQL/RLS、双Worker故障、会话排空和财务抽样均未验收，保持 `in_progress`。
`ENT-CORE-004` 已增加 tenant-scoped source/version/chunk、草稿审核发布状态机、发布后不可变约束、
locale/country/product/effective-time 检索和知识引用 ID；
`ENT-CORE-005` 已增加版本化 term pack/script template、审核发布和生效窗口、发布后不可变约束，
并由服务端 resolver 固化 ASR/翻译/LLM 的同一 `termPackVersionId`；话术版本只作为 LLM 附加引用。
`ENT-CORE-007/010/012` 已增加 tenant usage budget、幂等 hold/settle、tenant billing account、
不可变 plan/subscription/entitlement 版本、原始 usage event、append-only adjustment、账期
count/hash 聚合和 dispatch 服务端限额。真实设备/Provider、支付账务环境、关账、A1/H2/H3 仍待完成。
`ENT-OBS-001` 已提供 tenant-scoped 单会话质量/Provider/usage/ledger/audit 报告；`ENT-UI-004` 已把该报告与
tenant/route、Provider、subscription、budget 和 usage aggregate 接入企业工作台。两项本轮均未执行自动化、浏览器
或 PostgreSQL 测试，保持 `in_progress`，业务聚合和货币价格缺失时仍明确 not_ready/not_configured。
`ENT-UI-008` 已增加审计筛选/详情、显式 session 下钻和有目的/范围/保留期/hash 的受控导出；
未配置加密对象存储时明确 not_ready；到期物理清理已接入 `ENT-REL-002` 静态候选，但仍待真实对象存储验收。本轮同样只完成静态门禁，
不能据此宣称 PostgreSQL、对象存储、H2/H3 或生产门禁通过。
`ENT-UI-009` 已增加持久化 system/light/dark 主题、320/600/960/1280 响应式规则、动态字号、跳至主内容、
路由焦点、可聚焦横向表格与明确 ARIA 语义；本轮只形成静态代码候选，未完成浏览器、200% 缩放、键盘、
axe、视觉回归或真机验收，不能据此宣称 WCAG AA 或生产门禁通过。
`ENT-UI-010` 已定义三引擎 Playwright 角色/路由/响应式/主题/键盘/axe/视觉门禁、固定 release matrix、
bundle 敏感信息与 clean commit 扫描，以及签名租户上下文中的脱敏客户端错误/性能事件。测试和视觉基线本轮
未执行，任务保持 `in_progress`，不能据此宣称 AC-UI 或 Web release gate 已通过。
`ENT-UI-011` 已增加与个人主导航隔离的 Flutter 企业入口，重新校验账号、active membership、签名 route、
region/cell/scope 和 Provider document，并按 scope 发现工作台、会议、接管、告警、我的；会议页现读取 tenant-scoped
Meeting API、换取短期 RTC grant 并使用独立企业 LiveKit 音频客户端；接管页已接 queue/work-item/claim/lease/workbench，
将数据库 claim、AI speech fence 和 Provider media receipt 分层展示，后台/冲突时先清除本地控制。
当前只通过 Flutter 静态分析，测试、构建和真机门禁未执行。
`ENT-UI-012` 已增加独立于成员 AuthProvider/AppShell 的 Web 访客参会壳，fragment guest token 清除后只驻留内存，
query/非法凭据/清除失败均拒绝；访客可显式用加密邀请换取仅允许麦克风发布和订阅的短期 RTC grant，
入会前还必须用户点击麦克风检查，临时 audio track 在检查结束立即停止；拒绝、无设备和不安全上下文均明确显示。
共享仍保持 not_ready。测试与浏览器设备门禁未执行。
`ENT-MTG-001` 已增加 Meeting/Participant/Artifact 领域状态机、`0021` schema 约束、tenant-scoped PostgreSQL
Repository/runtime 和包含 communication binding 的恢复聚合读取。`ENT-MTG-002` 已形成创建/邀请/成员与访客入会、
加密邀请、短期 LiveKit grant、Web/Flutter 入口代码候选。`ENT-MTG-003` 新增 `0023`、tenant-aware Worker
snapshot/heartbeat/refresh/finalize、每 participant track 独立 ASR/翻译、append-only target event、LiveKit 服务端
定向字幕和 Web/Flutter 可信消费；定向 TTS 明确 not_ready。`ENT-MTG-004` 新增 `0024`、屏幕共享租约/命令账本、
最小权限代际 grant、cell 到期回收和 LiveKit 撤销 outbox。`ENT-MTG-005` 已增加 Web 用户手势采集、实际
display surface 识别、独立发布房间、track SID 续租、代际订阅过滤及开始/暂停/恢复/停止界面。`ENT-MTG-006`
已增加 iOS ReplayKit Broadcast Upload Extension、App Group 无令牌控制清单、独立 Flutter publisher Room、租约续期、
系统停止回收及成员角色/画质界面；扩展只向主 App 的 Unix socket 发送视频帧，不持有 RTC token。`ENT-MTG-007`
已增加 Android MediaProjection 显式授权、可见前台通知、独立 Flutter publisher Room、租约到期回收，以及系统投屏/
通知停止汇合；前台服务只持有 token-free 控制元数据。`ENT-MTG-008` 已增加 Web 真实系统音频请求、独立
`screen_share_audio` 发布与观看、本机不回放，以及翻译 Agent 的 participant identity + microphone source 双重守卫；
iOS/Android 没有真实音频采集管线时继续关闭入口。`ENT-MTG-009` 已增加 Web/Flutter 显式 simulcast/dynacast、
基于真实渲染元素尺寸的 adaptive subscription，以及画面优先/并排/字幕优先布局；窄屏与大字体不使用遮挡式 overlay。
`ENT-MTG-010` 已增加 scope 与活动参会关系双重守卫的主持人强停、generation fence、审计/outbox 和有界 LiveKit 撤销；
`ENT-MTG-011` 已增加 `0025`、服务端逐字稿 fan-out 去重/latest revision 冻结、source count/hash、逐项 evidence、
OpenAI-compatible 显式降级复核、当前会议 speaker label、action CAS，以及 Web/Flutter 服务端材料消费和人工发布。
`ENT-MTG-012` 已增加 `0026`、per-participant 默认关闭订阅、短期 share/track/route ticket、`SUBSCRIBE_NONE` 精确订阅、
服务端 pHash claim/usage ledger、HTTPS OCR Provider/readiness、定向布局事件与 Web/Flutter contain 坐标叠加；原始帧不落库，
Provider/data channel 失败不影响共享和字幕。
`ENT-MTG-013` 已增加 `0027`、主持人预约会议日历 API、tenant-bound Google Workspace service-account Adapter、稳定 event ID
和409对账、AES-256-GCM outbox、原子 Worker receipt finalize，以及同 Material 图标体系的 Web/Flutter 状态入口。测试、
真实 PostgreSQL/Google Workspace、浏览器和真机验收未执行，任务保持 `in_progress`。
`ENT-CS-001` 已增加 `0028`、客服 channel/customer/queue/session/case/tool 状态与 tenant 约束、幂等创建、
support communication binding 原子绑定、Repository/runtime 和非终态恢复聚合。按要求未执行自动化、
migration/forced-RLS、并发 CAS 或重启恢复，任务保持 `in_progress`，也不代表 A2/H3 已通过。
`ENT-CS-002` 已增加共享 Channel Adapter 契约、短期 tenant dispatch ticket、内部授权/入站路由、Provider readiness、
Inbox hash 去重与统一 session/binding/audit/Outbox 事务；真实 Provider edge、自动化和恢复门禁未执行，保持
`in_progress`。
`ENT-CS-003` 已增加客服会话级 tenant RAG 契约/runtime/API，只检索当前有效 published 知识，命中返回并审计
逐条 evidence/citation，无证据明确无法确认并提供转人工指令；自动化、真实 PostgreSQL、召回质量和 Agent 生成门禁
未执行，保持 `in_progress`。
`ENT-CS-004` 已增加 `0029` forced-RLS Support Agent run/turn、strict JSON schema 与 thinking/citation guard、
API-owned prepare/complete、最多12轮上下文、无证据/Provider 超时显式 handoff/degraded，以及独立 LiveKit Worker cell
的短期 ticket 轮换、TTS 前 ticket/policy/generation 重验和中断后禁止 delivered fence。当前只通过静态门禁；migration/RLS、自动化、真实 Provider、
LiveKit/ASR/TTS、取消/接管竞态和重启恢复未执行，保持 `in_progress`。
`ENT-CS-005` 已增加 `0030` forced-RLS Tool Registry、不可变 revision、固定
risk/scope/confirmation 映射、封闭 primitive schema、签名 Worker fence、参数 hash、幂等授权记录和
DB insert guard。只读只创建 `requested`，可逆写只创建 `awaiting_confirmation`，高风险只返回人工接管且不创建
execution；Agent 工具输出仍未开放，只读执行见 `ENT-CS-006`，可逆写确认/密文 Outbox/Worker 收敛见
`ENT-CS-007`，不可执行高风险接管见 `ENT-CS-008`。`ENT-CS-007` 固定 ticket/callback/note，确认绑定挑战后客户
turn，未知 Provider 结果使用相同幂等键重试，默认 unavailable、mock simulated=true。当前只进入静态门禁，
migration/RLS、自动化、并发发布、双租户和真实 Provider/Adapter 未执行，保持 `in_progress`。
`ENT-CS-006` 已增加 `0031` read execution attempt/lease/result 状态、order/logistics/inventory 严格
Adapter contract、默认 not_configured runtime、tenant-bound simulated mock，以及 transaction claim、
事务外限时调用和 lease/version/definition/session/customer fenced finalize。完成回放重新校验结果并重算
hash；Agent `toolRequest` 仍为 `null`，真实 Provider 未配置。当前只通过静态门禁，测试、真实 migration/
forced-RLS、双租户、并发重领、崩溃恢复和 Provider 验收未执行，保持 `in_progress`。
`ENT-CS-007` 已增加 `0032`、120秒确认挑战、挑战后客户 turn hash/sequence 绑定、ticket/callback/note
严格 Adapter、AES-GCM Outbox、Cell Worker 同幂等键恢复和 execution/outbox 原子 finalize。未确认、含糊/
过期确认、参数/工具版本变化或配置缺失均不入队；未知网络结果不写确定失败。生产默认 unavailable，
mock 固定 simulated=true，Agent `toolRequest` 仍为 `null`。测试、真实 migration/forced-RLS、并发确认、
崩溃恢复和真实 Provider 均未执行，保持 `in_progress`。
`ENT-CS-008` 已增加 `0033` forced-RLS/append-only high-risk handoff request，将退款、付款、身份验证及
其他 high-risk 请求绑定到 run/session/customer/active revision/arguments hash/risk evidence hash；首次
请求与 run/session 的 handoff_requested 原子提交，同键异证据冲突，接管后只允许 handoff TTS。该路径
不创建 execution、Outbox 或 Provider 调用，坐席 queue/claim 由 `ENT-CS-009` 独立实现。测试和真实 PostgreSQL/
RLS/并发/TTS/人工接通验收未执行，保持 `in_progress`。
`ENT-CS-009` 已增加 `0034` queue SLA/claim lease、forced-RLS exclusive claim、session/claim/assigned member
deferred binding、确定性 work-item 排序、self-claim、renew/release 和 manager reassign API。坐席身份只取
当前 membership，改派同时受 HTTP/runtime/DB 守卫；lease 过期在下一次 claim 时原子释放重领。测试已定义
但未运行，真实 migration/RLS、双租户、并发/崩溃/重启和人工媒体未验收，保持 `in_progress`；这也不表示
`ENT-CS-010` 工作台已经实现。
`ENT-CS-010` 已增加 tenant-scoped workbench activate/read 聚合、claim 时 Agent run 原子取消、旧 claim
补建停止栅栏、最终 revision 字幕快照、客户/知识/风险/历史三栏 Web 页面，以及独立 expected-version lease
心跳。静音、转组、结束、工单和回呼未接 Provider/API 时固定 not_ready。当前只通过静态门禁，测试、真实
PostgreSQL/forced-RLS、Worker/LiveKit 300ms停播、浏览器和真实坐席媒体未验收，保持 `in_progress`。
`ENT-CS-011` 已增加 `0035` forced-RLS `support_callbacks/support_followup_commands`、坐席 claim/session
双版本栅栏、确定性幂等业务 ID、密文 `support.followup.requested` Outbox、Cell Worker 同键重试和
case/callback 最终投影。Web 只在服务端 Adapter readiness 为 ready 时开放工单/回拨表单，入队只显示
processing；未配置返回 not_ready，simulated 明示非真实外部效果。当前只通过静态门禁，自动化、真实
PostgreSQL/RLS、崩溃恢复和真实 Ticket/Callback Provider 未验收，保持 `in_progress`。
`ENT-CS-012` 已增加 `0036` forced-RLS `support_quality_rule_versions/reviews/findings`、独立
`quality:read/manage`、终态会话/Agent run 绑定、规则与 source hash 精确重放、五类确定性结构发现，以及
同风格 Web Dashboard/证据详情。语义模型未配置时 review 固定 partial/not_configured、错误回答率为 null，
不以无引用率冒充语义错误率。当前只通过静态门禁，自动化、真实 PostgreSQL/RLS、浏览器、自动批处理和
人工金标质量验收未执行，保持 `in_progress`。
`ENT-MKT-001` 已增加共享 Campaign 契约、`0037` 聚合约束/创建幂等键/owner 复合外键/状态 trigger、
tenant-scoped PostgreSQL Repository/runtime，以及 list/read/create/draft update/aggregate schedule API；三类写命令
均携带请求 SHA-256，草稿更新和待调度命令复用 forced-RLS `idempotency_keys` 精确重放。
未审批、非 approved 状态、无策略版本、无未来开始时间或缺 `campaign:approve` 均不能进入 `scheduled`。
Enterprise Web 复用既有 Material Icons、浅深色 token、8px 圆角和统一状态页，提供真实草稿创建/编辑和
活动卡片；授权、审批、Scheduler、call task 与 PSTN 均未提前实现或伪造成功。当前只通过
静态门禁，自动化、真实 PostgreSQL/RLS、浏览器和 Provider 均未验收，保持 `in_progress`。
`ENT-MKT-002` 已增加 `0038` forced-RLS 导入批次/Campaign Lead/逐行证据、tenant Lead 唯一身份、CSV/API
规范化、libphonenumber E.164、AES-GCM 原始/规范号码密文、tenant HMAC 去重、可重放导入/回滚 Repository/API
和同风格 Web 面板。整批错误零业务写入；导入与回滚只在未提交草稿开放，号码只返回 hint，不生成授权、禁拨、
任务、Outbox、usage 或 PSTN 副作用。当前只通过静态门禁，自动化、真实 PostgreSQL/RLS、密钥恢复和浏览器均未
验收，保持 `in_progress`。
`ENT-MKT-003` 已增加 `0039` Campaign/Lead 绑定授权证据、对象实体验证、hash/大小/类型、登记/撤回幂等、
不可改写 trigger、执行时有效性查询和 call-task 数据库硬栅栏；撤回会取消没有替代授权的待执行任务。
Enterprise Web 复用现有 Material Icons 与品牌 token 展示授权状态和历史。当前仅形成代码与静态门禁候选，
真实对象存储、PostgreSQL/forced-RLS、并发、浏览器与法务证据验收未执行，保持 `in_progress`。
`ENT-MKT-004` 已增加 `0040` tenant/global 不可变禁拨证据、公开 tenant-only 写入、受信 system global 投影、
拒绝联系/撤回/投诉来源、同号码 advisory lock、跨活动待任务取消和 call-task SQL 硬栅栏；Web 在授权详情中复用
现有 `block/public` Material Icons 与品牌 token 展示真实禁拨历史和全局 readiness。全局注册表 Adapter 当前明确
not_configured，自动化、真实 PostgreSQL/RLS、并发、浏览器与名单同步未验收，保持 `in_progress`。
`ENT-MKT-005` 已增加 `0041` forced-RLS 不可变国家策略版本、发布幂等与国家/有效期不重叠约束、当地时间窗口、
跨活动频控、品牌/AI 身份/营销目的告知、语音信箱策略、Campaign 目标时间 readiness 和 call-task SQL 硬栅栏。
任务必须引用与 Lead 国家一致且覆盖计划时间的具体版本；Lead 时区缺失/非法、窗口外、重试过密或超频均拒绝。
Enterprise Web 继续复用 `policy/schedule/speed/record_voice_over/voicemail` Material Icons 与既有 token；配置只表示
企业合规输入，不冒充具体法域法律结论。自动化、真实 PostgreSQL/RLS、时区/并发、浏览器和法务签核抽样未验收，
保持 `in_progress`；本任务本身不包含审批快照、Scheduler 与 PSTN。
`ENT-MKT-006` 已增加 `0042/0043` forced-RLS 不可变 validation/decision、Campaign/Policy/Lead/Consent/
Suppression 规范快照与 hash、validate/approve/reject API、同号码锁、状态转换和 schedule/task 数据库复核；Web 使用
相同 Material Icons/token 按需读取并展示服务端证据。当前仅形成静态代码候选，自动化、真实 PostgreSQL/RLS、
审批/撤回/禁拨竞态、浏览器和法务抽样未验收，保持 `in_progress`；Scheduler、Outbox、PSTN 属于 MKT-007..009。
`ENT-MKT-007` 已增加 `0044` task generation/claim/lease/hold 栅栏、approval snapshot 到确定性 task 的同事务物化、
IANA 当地窗口 due query、签名 route/current epoch、entitlement 租户并发、Campaign 并发、固定60秒 usage hold、
`SKIP LOCKED`/CAS claim、过期重试和撤回/禁拨释放，以及同风格只读 Web 调度面板。当前只形成静态候选；自动化、
真实 PostgreSQL/RLS、50并发、cell 隔离和浏览器未验收，保持 `in_progress`。
`ENT-MKT-008` 已增加 `0045` scoped dispatch、communication session/binding、无明文号码 Outbox、稳定 Provider
idempotency key、HTTPS PSTN Bridge Adapter、HMAC webhook、Provider accept 后固定60秒 settle 和 route/generation/
provider call 栅栏；Web 只读显示真实计数/readiness。响应未知保持 reconciliation required 且不会盲目重拨；Provider、
Bridge、webhook、keyring 或持久幂等保证未配置时固定 `not_ready`。当前只形成静态候选，未运行自动化、真实
PostgreSQL/RLS、PSTN Provider、响应丢失对账、并发或浏览器，`AC-ENT-0041` 未通过，任务保持 `blocked`。
`ENT-MKT-009` 已增加 `0046` forced-RLS Marketing Agent profile/run/turn、PSTN 同事务 run、短期签名 runtime ticket、
严格 LLM JSON Adapter、published knowledge/Term Pack/Script Template 冻结、disclosure/TTS 交付栅栏、退订
suppression 和同风格 Campaign profile 页面。无证据、承诺性内容、越界引用、未配置 LLM/runtime/人工接管均失败
闭合。当前只形成静态候选，未运行自动化、真实 PostgreSQL/RLS、LLM/PSTN 通话或浏览器，`AC-ENT-0042` 未通过，
任务保持 `in_progress`。
`ENT-MKT-010` 已增加 `campaign:read` 的 Campaign/单通话 PostgreSQL 只读投影、最终 revision 字幕、Agent 意图/风险、
Provider operation、接受/接听延迟和状态新鲜度，以及同风格 Web 监控面板。当前传输明确为5秒服务端快照且
Realtime Gateway `not_configured`，不把轮询冒充流式成功；自动化、真实 PostgreSQL/RLS、通话、浏览器、负载和
WSS/SSE 未验收，`AC-ENT-0043` 未通过，监控任务保持 `in_progress`。
`ENT-MKT-011` 已增加 `0047` forced-RLS 接管策略/桥接证据、审批快照冻结、Marketing 转 Support
Session 原子物化，并复用 `support_agent_claims` 作为唯一坐席领取真值。工作台分离显示 AI 数据库
停播栅栏与 Provider 媒体回执；HTTPS/idempotency/坐席加入/300ms 保证缺任一项即 `not_ready`。
超时 Worker 只记录 `timed_out/callback_required` 和 `physicalProviderAction=not_verified`，不伪造挂断或回拨成功。
当前只形成静态代码候选；未运行自动化、真实 PostgreSQL/RLS、PSTN Provider、坐席媒体或 300ms
验收，`AC-ENT-0044` 未通过，任务保持 `in_progress`。
`ENT-MKT-012` 已增加 `0048` Outcome/内部 next action 不可变栅栏、终态 task/dispatch/run 绑定、最终字幕/
已交付 Agent turn 与 handoff/suppression/Provider 失败证据、稳定 evidence/source hash、单 task 唯一和同风格 Web 面板。
后续动作只保存 `requested`，页面明确外部已执行为0；CRM/日历/消息 Adapter 和 receipt 属于 `ENT-MKT-013`。
当前只形成静态代码候选；未运行自动化、真实 PostgreSQL/RLS、双租户、真实通话或浏览器验收，
`AC-ENT-0045` 未通过，任务保持 `in_progress`。下一项为 `ENT-MKT-013` CRM Adapter。
`ENT-MKT-013` 已增加 `0049` forced-RLS CRM sync 聚合、AES-256-GCM Outbox、稳定 External ID、
Salesforce OAuth Client Credentials REST upsert、PATCH 后 GET 对账回执、指数退避 Worker finalize、
tenant/provider fingerprint 绑定、mock contract 和同风格 Web 状态入口。缺失租户绑定、OAuth、API 版本、
对象/External ID/载荷字段或密钥时明确 `not_ready`；Outbox 请求和 MKT-012 `requested` 均不代表 CRM 成功。
当前只形成代码与静态门禁候选，未运行自动化、`0049` migrate/down/forward、forced-RLS 双租户、真实
PostgreSQL/Salesforce sandbox、Worker 故障注入或浏览器验收，`AC-ENT-0046` 未通过；由于真实 Salesforce
账号仍缺失，任务保持 `blocked`。
`ENT-MKT-014` 已增加 PostgreSQL-only 活动分析只读投影和同风格 Web 面板。API 在
`REPEATABLE READ READ ONLY` 快照中从 Campaign Lead、task、PSTN dispatch、verified Outcome、明确
`complaint` suppression、usage event/ledger adjustment 与已对账 CRM receipt 计算漏斗、用量和国家/执行版本拆分；
不建立第二套分析真值。当前没有单位价格表，货币金额固定为 `null + pricing_not_configured`；无通话样本显示
`no_call_samples`，不补数。当前只通过静态门禁，未运行自动化、真实 PostgreSQL/RLS、浏览器或容量验收，
`AC-ENT-0047` 未通过，任务保持 `in_progress`。
当前按要求未执行
测试、migration、RLS、RBAC/ticket/evidence 攻击、并发共享、Worker/Provider、四人媒体、浏览器、真机与重启恢复，
因此上述任务均保持 `in_progress`。

## 3. 继承文档

本设计不替换现有个人版和实时媒体设计，以下文档继续作为底层约束：

- [两层部署与数据流设计](./ai-phone-two-tier-deployment-data-flow-design.md)
- [翻译电话技术方案](./ai-phone-translation-technical-design.md)
- [模型 Provider 接入层](./model-provider-access-layer.md)
- [LLM Provider 接入层](./llm-provider-access-layer-design.md)
- [说话人归属设计](./ai-phone-speaker-attribution-design.md)
- [实时翻译协议设计](./ai-phone-translation-protocol-design.md)
- [ENT-MTG-003 实现与静态门禁证据](./evidence/ent-mtg-003-enterprise-realtime-translation-2026-07-19.md)
- [ENT-MTG-004 屏幕共享租约实现与静态门禁证据](./evidence/ent-mtg-004-screen-share-lease-2026-07-19.md)
- [ENT-MTG-005 Web 屏幕共享实现与静态门禁证据](./evidence/ent-mtg-005-web-screen-share-2026-07-19.md)
- [ENT-MTG-011 会后材料实现与静态门禁证据](./evidence/ent-mtg-011-meeting-materials-2026-07-19.md)
- [ENT-CS-009 坐席队列实现与静态门禁证据](./evidence/ent-cs-009-support-agent-queue-2026-07-19.md)
- [ENT-CS-010 坐席工作台实现与静态门禁证据](./evidence/ent-cs-010-support-workbench-2026-07-19.md)
- [ENT-CS-011 工单与回拨实现和静态门禁证据](./evidence/ent-cs-011-support-followups-2026-07-19.md)
- [ENT-CS-012 客服质检分析实现和静态门禁证据](./evidence/ent-cs-012-support-quality-2026-07-19.md)
- [ENT-MKT-001 Campaign 聚合实现和静态门禁证据](./evidence/ent-mkt-001-campaign-aggregate-2026-07-19.md)
- [ENT-MKT-002 线索导入实现和静态门禁证据](./evidence/ent-mkt-002-lead-import-2026-07-19.md)
- [ENT-MKT-003 授权证据实现和静态门禁证据](./evidence/ent-mkt-003-marketing-consent-2026-07-19.md)
- [ENT-MKT-004 禁拨名单实现和静态门禁证据](./evidence/ent-mkt-004-marketing-suppression-2026-07-19.md)
- [ENT-MKT-008 PSTN dispatch 实现和静态门禁证据](./evidence/ent-mkt-008-pstn-dispatch-2026-07-19.md)
- [ENT-MKT-009 Marketing Agent 实现和静态门禁证据](./evidence/ent-mkt-009-marketing-agent-2026-07-20.md)
- [ENT-MKT-010 实时监控实现和静态门禁证据](./evidence/ent-mkt-010-marketing-monitoring-2026-07-20.md)
- [ENT-MKT-011 真实人工接管实现和静态门禁证据](./evidence/ent-mkt-011-marketing-handoff-2026-07-20.md)
- [ENT-MKT-012 Outcome 实现和静态门禁证据](./evidence/ent-mkt-012-marketing-outcome-2026-07-20.md)
- [ENT-MTG-012 屏幕 OCR 翻译实现与静态门禁证据](./evidence/ent-mtg-012-screen-ocr-translation-2026-07-19.md)
- [ENT-MTG-013 日历 Adapter 实现与静态门禁证据](./evidence/ent-mtg-013-calendar-adapter-2026-07-19.md)
- [ENT-CS-001 客服领域实现与静态门禁证据](./evidence/ent-cs-001-support-domain-2026-07-19.md)
- [ENT-CS-002 呼入 Channel Adapter 实现与静态门禁证据](./evidence/ent-cs-002-channel-adapter-2026-07-19.md)
- [ENT-CS-003 Tenant RAG 实现与静态门禁证据](./evidence/ent-cs-003-tenant-rag-2026-07-19.md)
- [ENT-MTG-006 iOS ReplayKit 实现与静态门禁证据](./evidence/ent-mtg-006-ios-replaykit-2026-07-19.md)
- [ENT-MTG-007 Android MediaProjection 实现与静态门禁证据](./evidence/ent-mtg-007-android-media-projection-2026-07-19.md)
- [ENT-MTG-008 Web 系统音频实现与静态门禁证据](./evidence/ent-mtg-008-web-system-audio-2026-07-19.md)
- [ENT-MTG-009 自适应共享布局实现与静态门禁证据](./evidence/ent-mtg-009-adaptive-screen-layout-2026-07-19.md)
- [ENT-REL-002 数据生命周期实现与静态门禁证据](./evidence/ent-rel-002-data-lifecycle-2026-07-20.md)
- [ENT-REL-003 备份和灾备实现与静态门禁证据](./evidence/ent-rel-003-backup-disaster-recovery-2026-07-20.md)
- [ENT-REL-004 灰度和熔断实现与静态门禁证据](./evidence/ent-rel-004-rollout-circuit-breaker-2026-07-20.md)
- [ENT-REL-005 企业发布材料代码候选证据](./evidence/ent-rel-005-enterprise-release-materials-2026-08-31.md)
- [ENT-REL-006 控制面高可用代码候选证据](./evidence/ent-rel-006-control-plane-ha-2026-08-31.md)
- [Enterprise Control Plane HA 值班手册](./runbooks/enterprise-control-plane-ha.md)
- [ENT-REL-007 租户准入代码候选证据](./evidence/ent-rel-007-tenant-admission-2026-08-31.md)
- [Enterprise Tenant Admission 值班手册](./runbooks/enterprise-tenant-admission.md)
- [ENT-REL-008 订阅生命周期代码候选证据](./evidence/ent-rel-008-subscription-lifecycle-2026-08-31.md)
- [Enterprise Subscription Lifecycle 值班手册](./runbooks/enterprise-subscription-lifecycle.md)
- [ENT-UI-011 Flutter 企业人工接管代码候选](./evidence/ent-ui-011-flutter-takeover-2026-08-31.md)
- [ENT-UI-012 Web 访客设备检查代码候选](./evidence/ent-ui-012-guest-device-check-2026-08-31.md)
- [企业发布材料目录](./release/enterprise-service-description.md)
- [Enterprise Release Control 值班手册](./runbooks/enterprise-release-control.md)

## 4. 统一约束

- 运行时只有客户端层和服务器层。Mac 只用于开发、构建和运维。
- Flutter App、Web 企业控制台和 Web 参会页均属于客户端层。
- SaaS 控制面负责租户、套餐、区域、权益、账单和全局配置；区域数据面承载媒体、模型和租户业务数据。
- 每个租户创建时固定 `homeRegion`；业务数据不能因请求路由或 Provider 切换跨区域漂移。
- API 与受限的 Enterprise Repository cell Worker 是直接数据库写入方；普通 Realtime
  Gateway、Translation/Agent/OCR Worker、PSTN Bridge 和模型服务不得持有业务表写凭证。
- 所有企业数据必须绑定 `tenantId`；用户写操作同时校验 `tenantId + userId + resourceId`。
- 所有可重试写操作必须携带 `idempotencyKey`；状态迁移使用版本条件更新。
- AI 不得绕过确定性策略直接拨号、退款、付款、承诺合同或读取未授权数据。
- SQLite WAL 只用于本地开发、自动化和封闭演示；任何真实企业 SaaS 试点和付费租户必须使用 PostgreSQL。
- 全产品只允许一个 Storage Driver 和启动 readiness 真值；可以按 tenant、directory、cell、
  migration/backup 职责使用多个最小权限连接池，但不能保留两套独立切换开关或双写真值。
- 公共通讯聚合必须使用一等 `scopeType + scopeId`；企业路径固定为 tenant scope，不能把
  可空 `ownerId/tenantId` 或可选过滤条件当作租户隔离。
- 主产品 staging、同机复制或控制面压测证据不能自动提升企业任务状态；企业 forced RLS、
  cell、租户账单、多租户容量、跨故障域 HA 和 off-host 恢复必须独立验收。

## 5. 任务编号

| 前缀 | 范围 |
| --- | --- |
| `ENT-CORE` | 租户、权限、审计、知识、计费和 Provider 基础 |
| `ENT-UI` | Web/Flutter 企业壳、页面、状态、响应式和前端门禁 |
| `ENT-MTG` | 企业会议、屏幕共享和会后材料 |
| `ENT-CS` | AI 客服、坐席、工具调用和工单 |
| `ENT-MKT` | 出海外呼营销、活动、线索和合规拨号 |
| `ENT-DATA` | 企业数据、并发、备份和数据库迁移 |
| `ENT-OBS` | 指标、告警、质量报告和成本 |
| `ENT-REL` | 安全、部署、灰度和发布 |

## 6. 推荐交付顺序

1. SaaS 控制面和现有企业公共底座。
2. 统一 Primary Runtime、公共通讯 tenant scope、communication session 和 Worker Dispatch。
3. 租户账单、统一迁移/对账和企业 PostgreSQL 独立验收。
4. 企业会议和屏幕共享。
5. AI 呼入客服与人工接管。
6. 出海 AI 外呼营销受控试点。
7. 多区域、多实例、跨故障域韧性和正式企业发布。

外呼营销最后开放，因为它同时依赖真实 PSTN、国家策略、授权证明、禁拨名单、人工接管和审计闭环。
