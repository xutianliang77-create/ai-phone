# 无界AI企业版设计文档索引

版本：v1.26
日期：2026-07-19
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
连接的本地自动化，当前 manifest 为公共31段、enterprise 24段；`ENT-DATA-008` 和
`ENT-CORE-013/014/015` 已完成公共通讯 tenant scope、企业业务会话绑定、签名 Worker dispatch fence
及设备/声音/录制策略快照的代码/本地自动化，但不能继承主产品 staging 验收。`ENT-DATA-009` 已增加
31+16 migration manifest 的历史本地证据、全表主键分页 count/hash、WAL 水位、writer fence、签名
cutover/restore 证据和 production startup 绑定门禁；当前 `0017..0024` 必须按31+24重新生成切换证据。
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
未配置加密对象存储时明确 not_ready，物理对象清理仍由 `ENT-REL-002` 验收。本轮同样只完成静态门禁，
不能据此宣称 PostgreSQL、对象存储、H2/H3 或生产门禁通过。
`ENT-UI-009` 已增加持久化 system/light/dark 主题、320/600/960/1280 响应式规则、动态字号、跳至主内容、
路由焦点、可聚焦横向表格与明确 ARIA 语义；本轮只形成静态代码候选，未完成浏览器、200% 缩放、键盘、
axe、视觉回归或真机验收，不能据此宣称 WCAG AA 或生产门禁通过。
`ENT-UI-010` 已定义三引擎 Playwright 角色/路由/响应式/主题/键盘/axe/视觉门禁、固定 release matrix、
bundle 敏感信息与 clean commit 扫描，以及签名租户上下文中的脱敏客户端错误/性能事件。测试和视觉基线本轮
未执行，任务保持 `in_progress`，不能据此宣称 AC-UI 或 Web release gate 已通过。
`ENT-UI-011` 已增加与个人主导航隔离的 Flutter 企业入口，重新校验账号、active membership、签名 route、
region/cell/scope 和 Provider document，并按 scope 发现工作台、会议、接管、告警、我的；会议页现读取 tenant-scoped
Meeting API、换取短期 RTC grant 并使用独立企业 LiveKit 音频客户端，接管仍在 API 未闭合时明确 not_ready。
当前只通过 Flutter 静态分析，测试、构建和真机门禁未执行。
`ENT-UI-012` 已增加独立于成员 AuthProvider/AppShell 的 Web 访客参会壳，fragment guest token 清除后只驻留内存，
query/非法凭据/清除失败均拒绝；访客可显式用加密邀请换取仅允许麦克风发布和订阅的短期 RTC grant，
字幕与共享仍保持 not_ready。测试与浏览器设备门禁未执行。
`ENT-MTG-001` 已增加 Meeting/Participant/Artifact 领域状态机、`0021` schema 约束、tenant-scoped PostgreSQL
Repository/runtime 和包含 communication binding 的恢复聚合读取。`ENT-MTG-002` 已形成创建/邀请/成员与访客入会、
加密邀请、短期 LiveKit grant、Web/Flutter 入口代码候选。`ENT-MTG-003` 新增 `0023`、tenant-aware Worker
snapshot/heartbeat/refresh/finalize、每 participant track 独立 ASR/翻译、append-only target event、LiveKit 服务端
定向字幕和 Web/Flutter 可信消费；定向 TTS 明确 not_ready。`ENT-MTG-004` 新增 `0024`、屏幕共享租约/命令账本、
最小权限代际 grant、cell 到期回收和 LiveKit 撤销 outbox。`ENT-MTG-005` 已增加 Web 用户手势采集、实际
display surface 识别、独立发布房间、track SID 续租、代际订阅过滤及开始/暂停/恢复/停止界面。当前按要求未执行
测试、migration、RLS、RBAC/ticket 攻击、并发共享、Worker/Provider、四人媒体、浏览器、真机与重启恢复，
因此五项任务均保持 `in_progress`。

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
