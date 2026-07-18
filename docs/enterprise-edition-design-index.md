# 无界AI企业版设计文档索引

版本：v1.12
日期：2026-07-18
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

当前 `ENT-DATA-002/004` 已具备单一 Enterprise Repository runtime、独立 PostgreSQL
cell Worker 和 JSON/SQLite 演示数据 count/hash 对账代码，状态为等待真实 PostgreSQL
验收；这不等于 `ENT-DATA-001`、PITR、容量、安全或企业生产门禁已经通过。

无界AI主产品公共 PostgreSQL migration、Primary Runtime、可靠 Inbox/Outbox、
fencing、Billing/Product Records、verify-full 和韧性代码已形成稳定提交 `fe1c3c2`，并由
`ENT-DATA-007` 合入企业分支。企业版已经完成单 driver、双 manifest、同库身份和分权
连接的本地自动化，当前 manifest 为公共31段、enterprise 16段；`ENT-DATA-008` 和
`ENT-CORE-013/014/015` 已完成公共通讯 tenant scope、企业业务会话绑定、签名 Worker dispatch fence
及设备/声音/录制策略快照的代码/本地自动化，但不能继承主产品 staging 验收。`ENT-DATA-009`、
`ENT-CORE-007/010/012` 已增加 tenant usage budget、幂等 hold/settle、tenant billing account、
不可变 plan/subscription/entitlement 版本、原始 usage event、append-only adjustment、账期
count/hash 聚合和 dispatch 服务端限额。真实设备/Provider、支付账务环境、关账、A1/H2/H3 仍待完成。

## 3. 继承文档

本设计不替换现有个人版和实时媒体设计，以下文档继续作为底层约束：

- [两层部署与数据流设计](./ai-phone-two-tier-deployment-data-flow-design.md)
- [翻译电话技术方案](./ai-phone-translation-technical-design.md)
- [模型 Provider 接入层](./model-provider-access-layer.md)
- [LLM Provider 接入层](./llm-provider-access-layer-design.md)
- [说话人归属设计](./ai-phone-speaker-attribution-design.md)
- [实时翻译协议设计](./ai-phone-translation-protocol-design.md)

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
