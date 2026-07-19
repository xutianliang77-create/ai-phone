# 国内版技术设计评审稿合并计划

版本：v1.0  
日期：2026-07-06  
状态：合并计划  
输入：外部技术设计评审稿 `00-architecture-overview.md` 至 `08-platform-services-design.md`

统一架构基线：`docs/architecture/README.md`。后续 LiveKit、SIP、Agent、
统一数据模型、并发和安全改造以该目录为准；本文保留为国内版评审稿的历史合并记录。

## 1. 结论

外部技术设计评审稿覆盖面完整，可以作为国内版生产级目标架构的重要参考，但不能直接覆盖当前仓库已有设计和实现。

当前项目应保持既有架构方向：

- 移动端继续使用 Flutter，一套代码适配 iOS 和 Android。
- API/Gateway/Worker 继续以当前 Node.js/TypeScript 服务为主。
- 模型服务继续以 Python 服务承载。
- Call Link 继续使用自建 LiveKit。
- P0/P1 端侧 ASR 继续保留 iOS CoreML/Nemotron 与 Android 系统 ASR 兜底。
- 在线主链路继续使用 Qwen3-ASR-0.6B original tuned v3、Hy-MT2-1.8B、VoxCPM2；FireRedASR2-AED 保留为可切换 ASR fallback。

外部评审稿中的 sherpa-onnx 双端统一 ASR、Go 微服务、Apollo、Kafka、ClickHouse、SPIFFE/mTLS、完整后台和厂商推送体系，作为 P2/P3 目标架构或专项 PoC，不进入当前 P0/P1 直接重构范围。

## 2. 不能直接覆盖的冲突

| 冲突点 | 外部评审稿口径 | 当前项目口径 | 合并决策 |
| --- | --- | --- | --- |
| 端侧 ASR | sherpa-onnx zipformer-transducer 双端统一，替换 CoreML/Nemotron 和系统 ASR | iOS CoreML/Nemotron 已可用，Android 系统 ASR 兜底已接 | 不替换；sherpa-onnx 列入 Android 发布级 ASR TODO 和跨端统一 PoC |
| 服务端语言 | 后端 Go 微服务 + Python 推理 | Node.js/TypeScript API、Gateway、Worker + Python 模型服务 | 不重构；只吸收协议、状态机、账本和合规控制点 |
| 实时协议 | WSS JSON 控制 + 二进制音频帧，完整 ticket/resume/seq | 当前已有 API session、Realtime Gateway 和 App client | 不立即换协议；把事件顺序、flush、resume、usage tick 作为增量设计 |
| 数据平台 | PostgreSQL、Redis、Kafka、ClickHouse、OSS、KMS | 当前以本地 store、API 内存/文件化能力、门禁和服务骨架为主 | 分阶段吸收；P0/P1 先做可测试 API 和本地持久化，P2 再上完整数据平台 |
| 配置中心 | Apollo + config-service + kill switch | 当前以 env、release config、脚本门禁为主 | 先保留 env；kill switch 和灰度规则进入平台服务 TODO |
| 账号实名 | L0/L1/L2，PSTN/Agent/Call Link 发起需 L2 | 当前仅首启同意门禁，登录和实名未完成 | 吸收为账号开发主线，但分阶段实现 |
| 计费账本 | 复式账本、hold、分钟和 credits 双货币 | 当前已有 usage/billing 骨架和部分幂等 | 吸收为账本目标，不一次性重写 |
| 内容安全 | 自托管审核模型 + 第三方内容安全 + 举报申诉 | 当前合规中心、日志脱敏和 AI Agent 风险骨架 | 吸收 AI 标识、举报入口、摘要审核状态机，审核模型后续接 |

## 3. 分层采纳策略

### 3.1 立即吸收

这些内容与当前架构兼容，应转成当前 Node/Flutter/Python 体系内的开发任务。

| 外部文档 | 可立即吸收内容 | 当前落地点 |
| --- | --- | --- |
| `02-calllink-rtc-design.md` | Guest 入房前同意、微信 WebView 外开、仅字幕降级、TTS 译音轨按角色定向、Worker 恢复中状态 | API Call Link routes、Web Guest assets、Flutter Call Link 页面、translation-worker |
| `03-telephony-agent-design.md` | 被叫 AI 身份和录音转写告知、告知期拒绝即终止、24h 禁拨、禁拨号段、频控、Agent 高风险接管 | PSTN Bridge、Agent Call Worker、API agent-calls |
| `04-account-identity-compliance.md` | L0/L1/L2 能力边界、手机号验证码登录、voice_cloud/call_record/agent_authorize 单独同意、注销和个人信息导出 | 新增 auth/user/consent API，Flutter 合规中心和云端功能拦截 |
| `05-billing-ledger-design.md` | 端侧免费、在线/Call Link/PSTN 按服务端时长、<6s 免计费、hold、幂等结算、minutes + credits | API billing/usage 模块、release readiness、钱包页 |
| `07-llm-content-safety-design.md` | AI 生成内容显式标识、摘要结构化 schema、举报申诉、Agent 话术风险拦截 | History review、AI Agent、合规中心、Web Guest 页脚 |

### 3.2 作为目标架构 TODO

这些内容方向正确，但需要专项评测或平台预算，不应阻塞当前 P0/P1。

| 项目 | 采用条件 | 前置验证 |
| --- | --- | --- |
| sherpa-onnx 双端统一 ASR | 端侧模型大小、延迟、准确率优于现有 iOS Nemotron/Android 系统 ASR | iPhone + Android 真机中英快语速、噪声、混说、功耗评测 |
| 两遍式 ASR | 流式一遍模型与 FireRedASR2 二遍组合端到端延迟可控 | 首字延迟、final 延迟、漏译率、GPU 成本 |
| PostgreSQL 复式账本 | 支付沙盒和真实用量计费进入灰度 | 账实一致、重复扣费、退款回收、余额耗尽演练 |
| Kafka/ClickHouse/OTel | 日活和会话量进入需要平台化观测阶段 | 事件量、查询需求、告警 SLO |
| Apollo/config-service | 需要多渠道灰度、kill switch 和后台配置 | 配置变更审计和客户端缓存策略 |
| 管理后台 RBAC | PSTN/Agent/客服/退款开始灰度 | 工单、补偿、审计、敏感操作双人复核 |

### 3.3 暂不采纳

- 不把 Go 微服务作为当前重构目标。
- 不把 sherpa-onnx 写成已定替换方案。
- 不在 P0/P1 强制引入完整 Apollo、Kafka、ClickHouse、SPIFFE/mTLS。
- 不在没有真实服务商和法务结论前开放 PSTN/Agent 商用。
- 不把外部评审稿中的价格、套餐、额度作为最终商业定价，只作为占位输入。

## 4. 文档合并映射

| 外部评审稿 | 仓库内承接文档 | 处理方式 |
| --- | --- | --- |
| `00-architecture-overview.md` | `docs/domestic-app-detailed-functional-design.md`、`docs/domestic-edition-development-plan.md` | 只吸收架构原则和边界；不吸收直接替换端侧 ASR 与 Go 微服务的定稿措辞 |
| `01-realtime-translation-pipeline.md` | `docs/domestic-realtime-billing-data-design.md` | 吸收 VAD、flush、partial/final、usage tick、回声门控、resume 语义 |
| `02-calllink-rtc-design.md` | `docs/domestic-edition-development-plan.md`、Call Link runbook | 吸收 Guest 合规、WebView 降级、TTS 轨定向、Worker 恢复 |
| `03-telephony-agent-design.md` | `docs/domestic-edition-development-plan.md`、`docs/domestic-edition-acceptance-plan.md` | 吸收 PSTN/Agent 合规硬控制点和退款状态机 |
| `04-account-identity-compliance.md` | `docs/domestic-account-identity-compliance-design.md` | 合并 L0/L1/L2、同意类型、注销导出、SDK 延迟初始化 |
| `05-billing-ledger-design.md` | `docs/domestic-realtime-billing-data-design.md` | 合并双货币、hold、免计费、幂等结算和账单接口 |
| `06-data-architecture-design.md` | `docs/domestic-realtime-billing-data-design.md` 或后续数据专项文档 | 吸收本地/云端边界、软删硬删、记录搜索、数据生命周期 |
| `07-llm-content-safety-design.md` | 待新增 `docs/domestic-compliance-capability-matrix.md` | 吸收 AI 标识、举报申诉、摘要 schema、内容安全状态机 |
| `08-platform-services-design.md` | 平台服务 TODO | 作为后续后台、推送、灰度、客服、埋点目标，不阻塞当前开发 |
| `09-observability-capacity-security.md` | 缺失 | 需要补回；否则容量、SLO、安全和等保不能闭环 |

## 5. 开发任务拆分

### 5.1 P0/P1 近期任务

1. 账号登录和云端功能门禁
   - 新增手机号验证码登录 API 和 Flutter 登录页。
   - 在线同传、Call Link 发起、PSTN、AI Agent、支付、云同步前强制登录。
   - 未登录仍允许端侧同传、本地 Type-to-Speak、本地历史。

2. 单独同意
   - 增加 `voice_cloud`、`call_record`、`agent_authorize` 三类同意。
   - Flutter 在首次在线同传、Call Link、PSTN、AI Agent 前弹出单独同意。
   - API 在创建在线 session、Call Link、PSTN、Agent 时校验同意版本。

3. Call Link Guest 合规和降级
   - Web Guest 入房前强制同意。
   - 微信内置浏览器优先引导外开。
   - 不支持麦克风时进入仅字幕模式。
   - 页脚展示隐私、备案占位和举报入口。

4. 面对面自动朗读防回声
   - TTS 播放前 flush 当前段。
   - 播放期间暂停上行或丢弃采集帧。
   - 播放结束后延迟恢复。
   - 真机 10 句无自激作为验收。

5. 计费幂等和账单口径
   - 端侧会话继续不计费。
   - 在线/Call Link/PSTN 以服务端时长为权威。
   - 重复 end、重复 webhook 不重复扣费。
   - 逐步补 <6s 免计费、hold 和低余额预警。

6. PSTN/Agent 合规硬控制点
   - 拨打前未配置服务商或策略未通过时不得入队。
   - 接通后必须先播放 AI 身份和录音转写告知。
   - 告知期挂断不计费，并记录 24h 禁拨。
   - 禁拨号段、频控、黑名单进入发布门禁。

### 5.2 P2/P3 目标任务

1. sherpa-onnx 端侧 ASR PoC。
2. PostgreSQL 账本和记录云同步。
3. 后台 RBAC、工单、补偿、审计。
4. 自托管内容安全服务和举报申诉闭环。
5. Apollo 或等价配置中心与 kill switch。
6. OTel、ClickHouse、容量压测和等保控制项。

## 6. 发布口径

当前国内版发布口径保持不变：

- P0 内测：端侧同传、在线 Provider 诊断、历史、扫描、Type-to-Speak。
- P1 灰度：Call Link、支付沙盒、摘要重点术语、合规中心。
- P2 商业：PSTN 翻译电话、AI Calling Agent、双向 TTS、分钟和 credits 计费。

外部评审稿中的目标架构只有在完成 PoC、真实验收和迁移计划后，才能升级为定稿。

## 7. 下一步

1. 把 `04-account-identity-compliance.md` 的 L0/L1/L2、同意类型、注销导出合并进当前账号合规文档。
2. 按 `docs/domestic-realtime-billing-data-design.md` 落地 usage settlement、低余额 graceful end、segment 诊断字段和幂等计费测试。
3. 更新 Call Link Web Guest，实现微信外开、仅字幕模式、入房同意和举报入口。
4. 更新 PSTN/Agent 验收计划，增加开场告知、24h 禁拨、禁拨号段、频控和红队用例。
5. 补回缺失的 `09-observability-capacity-security.md` 或在仓库内新增对应容量与安全设计。
