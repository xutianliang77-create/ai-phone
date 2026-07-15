# AI Phone 企业版开发方案与计划

版本：v1.0
日期：2026-07-15
状态：SaaS 基线待排期

## 1. 开发原则

- 先公共底座，再会议，再客服，最后营销外呼。
- 每个阶段先完成数据契约和自动化门禁，再开放 UI 和真实 Provider。
- 服务器端和客户端层独立发布；Mac 不进入运行链路。
- 企业版只以平台托管 SaaS 交付，不开发客户侧服务端安装器。
- 不复制个人版 ASR、翻译、TTS、Speaker、LLM 和计费实现。
- SQLite WAL 仅用于本地开发和封闭演示；真实企业 SaaS 试点前完成 PostgreSQL。
- 真实 PSTN、CRM 或日历账号阻塞时，完成 Adapter、contract test、mock harness 和清晰降级，不伪造可用。
- 每项任务只有代码、自动化、真实环境证据和文档同时完成才可结项。

## 2. 里程碑总览

| 阶段 | 目标 | 建议工作量 | 退出条件 |
| --- | --- | ---: | --- |
| E0 | SaaS 控制面和企业公共底座 | 3-4周 | 开通、区域、tenant/RBAC、entitlement、审计和计量通过 |
| E1 | 企业会议 MVP | 3-4周 | Web/iPhone 入会、字幕、屏幕共享和纪要闭环 |
| E2 | AI 客服 MVP | 4-5周 | 呼入、RAG、坐席接管、低风险工具和工单闭环 |
| E3 | 出海外呼受控试点 | 5-7周 | 合法线索、国家策略、PSTN、接管、禁拨和结算闭环 |
| E4 | SaaS 发布硬化 | 3-4周 | 多实例、隔离、安全、灾备、SLA 和发布门禁通过 |

工作量是依赖齐全情况下的工程估算，不包含服务商商务签约和各目标国家的法律审查时间。

## 3. E0 SaaS 控制面和企业公共底座

### 3.1 交付

- enterprise tenant、member、role 和 API credential。
- 租户注册、开通 saga、`homeRegion/cellId`、暂停、导出和注销。
- 套餐、席位、entitlement、试用、账期和用量聚合。
- 控制面 tenant directory 和区域 route document。
- 服务端 tenant context 和 Repository 强制隔离。
- 企业 Web 控制台壳、导航和登录。
- 企业知识源、版本、术语包和发布流程。
- 企业审计、usage ledger、预算和 Provider readiness。
- PostgreSQL migration、备份、inbox/outbox 和幂等。

### 3.2 退出门禁

- 两个租户并发读写不能看到或修改对方资源。
- 角色越权全部被服务端拒绝。
- 重复命令只产生一个聚合状态和一条 ledger/outbox。
- 开通失败保持非 active，重试不重复创建租户或订阅。
- PostgreSQL 和对象存储恢复后租户、知识、ledger 和对象 hash 一致。

## 4. E1 企业会议 MVP

### 4.1 交付顺序

1. meeting/participant/artifact 数据契约。
2. 创建、邀请、join token、开始和结束状态机。
3. 复用个人版 LiveKit 翻译 Worker。
4. Web 企业会议页和移动端会议入口。
5. 屏幕共享租约和 Web `getDisplayMedia`。
6. iOS ReplayKit 和 Android MediaProjection 接口；Android 真机仍按 iOS 产品化后的既定顺序验收。
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

### 5.1 交付顺序

1. support channel、queue、session、case 和 tool execution。
2. PSTN/Web/App 呼入 Adapter 和统一会话创建。
3. tenant-scoped RAG 和引用。
4. Support Agent 状态机和 JSON Schema 输出。
5. 只读工具、可逆写工具和高风险工具三级 Policy。
6. 客服坐席工作台、队列、字幕和接管。
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

- 多实例 Scheduler/Worker 的数据库租约或队列协调。
- SaaS 控制面高可用、区域路由、cell 隔离和受控迁移。
- 租户级限流、配额、预算和异常熔断。
- 数据保留、导出、删除、备份和恢复演练。
- SAST、依赖扫描、渗透测试和密钥轮换。
- 监控、告警、值班手册、容量和成本报告。
- 订阅续费、欠费暂停、超额策略、账单对账和客户状态页。
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

## 11. 每阶段交付物

每个阶段必须同时交付：

- 功能和技术文档更新。
- schema migration 和回滚说明。
- API contract 和 Provider contract test。
- 单元、集成、端到端和故障注入测试。
- 真实 Beelink/服务器和 iPhone/Web 验收记录。
- 指标看板、告警和运行手册。
- `PROGRESS_LOG.md` 会话交接状态。
