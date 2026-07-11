# 国内版功能设计审核行动计划

版本：v1.2  
日期：2026-07-06  
来源：`design-review-report.md` 审核意见、外部技术设计评审稿  
关联：`docs/domestic-app-detailed-functional-design.md`、`docs/domestic-app-feature-completion-matrix.md`、`docs/domestic-edition-development-plan.md`、`docs/domestic-edition-acceptance-plan.md`、`docs/domestic-account-identity-compliance-design.md`、`docs/domestic-technical-design-merge-plan.md`、`docs/domestic-realtime-billing-data-design.md`

## 1. 总体判断

审核报告的核心结论成立：当前功能详设已经能描述“做什么”，但距离“可商用发布的产品级详细设计”还缺账号身份、合规能力、计费经济模型、实时协议、系统级音频交互和运营支撑。

需要澄清的是：报告中“关联文档不存在”的判断不适用于当前仓库。当前仓库已存在开发计划、验收计划、UI 设计、页面规格、技术设计、模型选型和发布门禁文档。因此部分问题应降级为“需交叉引用或补齐职责边界”，而不是完全缺失。

本行动计划采用三类处理：

- `接受为阻断`：发布前必须补齐，不再按普通 TODO 看待。
- `已部分覆盖`：仓库已有实现或文档，但发布级证据不足。
- `降级或澄清`：报告判断依赖信息不完整，需要在文档中说明边界。

## 1.1 外部技术设计评审稿处理口径

2026-07-06 已评审外部 `00-architecture-overview.md` 至 `08-platform-services-design.md`，处理结论见 `docs/domestic-technical-design-merge-plan.md`。

当前国内版不推翻既有架构：继续保留 Flutter 移动端、Node.js/TypeScript API/Gateway/Worker、Python 模型服务、自建 LiveKit、iOS CoreML/Nemotron、Android 系统 ASR 兜底，以及 Qwen3-ASR-0.6B original tuned v3 + Hy-MT2-1.8B + VoxCPM2 在线主链路；FireRedASR2-AED 保留为 ASR fallback。

外部评审稿中的 sherpa-onnx 双端统一 ASR、Go 微服务、Apollo、Kafka、ClickHouse、SPIFFE/mTLS、完整后台和平台化数据栈列为 P2/P3 目标架构或专项 PoC，不作为当前 P0/P1 直接重构范围。

## 2. 立即接受为阻断的事项

| 编号 | 事项 | 当前判断 | 落地方式 |
| --- | --- | --- | --- |
| BLK-1 | 账号与身份体系 | 接受为阻断 | 手机号验证码开发登录、真实 SMS Provider 边界、验证码重发/次数/失败锁定、账号页、退出、导出、注销请求、游客边界服务端强制和账号发布安全门禁已基础实现；继续补真实短信商户/模板/回执联调、登录态失效联动、实名边界和真机验收 |
| BLK-2 | App 备案与 Web ICP | 接受为阻断 | 文档改为“占位仅开发验收可用，正式提交前必须替换真实备案号”；Call Link Web 页补 ICP 展示要求 |
| BLK-3 | AI 生成语音标识 | 接受为阻断 | TTS/Agent 语音增加显式 AI 提示、隐式标识能力 TODO、算法备案 TODO |
| BLK-4 | 被叫方告知和同意 | 接受为阻断 | PSTN/Agent 接通后必须主动声明 AI 身份、录音转写和实时翻译；被叫拒绝即终止 |
| BLK-5 | PSTN/AI 外呼资质边界 | 接受为阻断 | P2 商用前必须完成持牌服务商路径、禁拨号段、频控、黑名单和退订 |
| BLK-6 | 生成式 AI 合规和内容安全 | 接受为阻断 | 摘要、重点、Agent 话术增加内容安全、投诉举报、日志留存期和处置机制 |
| BLK-7 | 首启隐私同意和敏感信息单独同意 | 接受为阻断 | 首启协议、在线同传/Call Link/AI Agent 云端语音敏感信息单独同意和同意记录审计已基础实现；继续补 SDK 延迟初始化实测和真机验收 |
| BLK-8 | 微信 WebView WebRTC 兼容性 | 接受为阻断 | Web 页能力检测、系统浏览器打开引导、复制链接降级和用户手势音频解锁已基础实现；继续建立微信内浏览器、Safari、Chrome、Android 主流机型矩阵并真机验收 |
| BLK-9 | 面对面自动朗读回声自激 | 接受为阻断 | 同传页已暂禁用系统 TTS 自动朗读以保护连续 ASR；发布级需补暂停识别后播放、耳机模式或平台 AEC |
| BLK-10 | FireRedASR2-AED 实时策略 | 接受为阻断 | 明确 chunk、VAD、partial/final、强制切段、flush 和撤回语义；按真实首字延迟验收 |
| BLK-11 | 单位经济和端侧计费规则 | 接受为阻断 | 明确端侧免费不计实时分钟、在线按秒计；补 GPU/PSTN/IAP 抽成成本模型 |
| BLK-12 | Android 国内端侧 ASR | 接受为阻断 | Android 系统 ASR 只能作兜底；发布级方案需内置或可下载端侧 ASR/翻译/TTS 路线 |

## 3. 已部分覆盖但仍需发布级补齐

| 事项 | 当前已有证据 | 缺口 |
| --- | --- | --- |
| 关联文档 | `docs/ai-communication-*`、`docs/domestic-edition-*`、`docs/ai-phone-translation-*` 已存在 | 主功能详设需要明确“哪些内容由哪份文档承载” |
| 支付服务端 | `services/api-server/src/modules/billing`、Apple JWS、微信/支付宝 adapter、ledger 测试；系统用量退款已有幂等接口 | 真实商户沙盒、支付退款联调、账单页、风控和运营后台仍未发布级完成 |
| PSTN 幂等结算 | PSTN Bridge、Agent webhook、`consumedSeconds`、`usageSettledAt`、Agent 失败不扣费已有测试 | 真实服务商媒体、被叫告知、禁拨号段、频控和商用资质未完成 |
| 合规中心 | App 内已有隐私政策、用户协议、SDK/模型服务商清单入口；首启同意门禁、云端语音敏感信息单独同意和同意记录审计已接入 App Shell/在线同传/Call Link/AI Agent | 内容举报、等保、真实备案和真机合规链路验收仍缺 |
| TTS 选型 | VoxCPM2 有产品适配报告和服务骨架 | 多语言可朗读矩阵、并发、电话带宽听感、AI 标识和生产 HTTPS 未完成 |
| Web Guest | Call Link Web 页已可入房、收字幕、订阅目标 TTS 音轨；已补微信 WebView 能力检测、系统浏览器打开引导、复制链接降级、用户手势音频解锁、ICP 占位和举报入口 | 真机矩阵、真实 ICP/备案替换和注册转化未补齐 |
| 自动朗读防回声 | Type-to-Speak 和通话链路已有防自拾取意识；同传页已禁用危险系统 TTS 路径 | 面对面自动朗读场景需重新设计为暂停识别后播放、耳机模式或平台 AEC |
| 模型评测 | Beelink 模型报告已有 RTF、首包、质量结论 | 仍缺三模型串联单位经济、并发容量、P95/P99 SLO |

## 4. 需要补写的三份设计文档

### 4.1 账号与身份 + 首启合规

当前状态：已交付补充设计、App 首启同意门禁、云端语音敏感信息单独同意、同意记录审计、手机号验证码开发登录、真实 SMS Provider 边界、验证码 60 秒重发、24 小时次数和失败锁定、账号页、退出登录、个人信息副本导出、注销请求、游客边界服务端强制和账号发布安全门禁；真实短信商户/模板/回执联调、SDK 延迟初始化实测、登录态失效联动和真机验收仍需继续实现。

范围：

- 手机号验证码登录。
- 游客试用边界。
- 触发通信、云端、支付前强制登录。
- 实名边界和主体责任。
- 账号注销、删除权、个人信息副本导出。
- 首启隐私政策和用户协议。
- 在线同传、Call Link、PSTN、Agent 的语音敏感信息单独同意。
- SDK 和模型服务商延迟初始化。

交付物：

- `docs/domestic-account-identity-compliance-design.md` 已新增。
- App 页面规格和状态矩阵。
- API 需求清单。

### 4.2 实时协议 + 计费与数据架构

范围：

- Realtime Gateway 上行音频帧协议。
- partial/final/translation/tts.ready/error 事件顺序和幂等。
- VAD、端点检测、强制切段、flush 和撤回。
- Call Link/PSTN 的计费权威源。
- 余额预留、低水位预警、归零优雅结束。
- 断线重连和 session resume。
- 历史数据本地/云端边界、加密、软删和硬删。

交付物：

- `docs/domestic-realtime-billing-data-design.md` 已新增。
- 合同测试清单。
- 发布门禁新增项。

### 4.3 国内版合规能力矩阵

范围：

- App 备案、ICP备案、算法备案。
- AI 生成内容和 TTS 标识。
- 被叫告知和拒绝处理。
- 内容安全审核和投诉举报。
- 第三方 SDK 清单和数据流向。
- 未成年人保护。
- 等保定级计划。
- PSTN/AI Agent 商用准入。

交付物：

- `docs/domestic-compliance-capability-matrix.md`
- 发布材料字段补充。
- 合规中心页面补充项。

## 5. 立即启动的技术 PoC

| 优先级 | PoC | 验收口径 |
| --- | --- | --- |
| P0 | 面对面自动朗读 AEC | iPhone 真机连续同传不因系统 TTS 中断；重新开放朗读前需验证 10 句无自激且不吞后续说话 |
| P0 | FireRedASR2-AED 实时策略 | 中文短句、长句、中英切换的首字延迟、final 延迟、漏译率和撤回行为有数据 |
| P1 | 微信 WebView WebRTC | 微信内置浏览器、Safari、Chrome、Android 主流机型分别验证麦克风、播放、入房、字幕、TTS |
| P1 | 三模型串联单位经济 | FireRedASR2 + Hy-MT2 + VoxCPM2 的并发、RTF、GPU 成本、P95 延迟和毛利测算 |

## 6. 对当前功能详设的修订建议

1. 将 `京ICP备00000000号-1A` 改为“开发验收占位，正式提交前必须替换真实备案号”。
2. 在产品定位中增加“端侧免费不扣分钟，在线/通话按秒或 credits 计费”的初步原则。
3. 在同传模块重新设计“暂停识别后播放/耳机模式/AEC”后再开放自动朗读。
4. 在 Call Link 模块增加“微信 WebView 不支持时引导系统浏览器打开”。
5. 在 PSTN/Agent 模块增加“被叫方 AI 身份声明和录音转写同意”。
6. 在模型链路中区分 MT 模型与 LLM 模型，摘要/重点/Agent 话术不能只写 Hy-MT2。
7. 在验收清单中加入设备、网络、分位、质量指标和长时稳定性。
8. 在非目标和边界中追加“未完成持牌/合规评审前，PSTN/Agent 不进入商用发布”。

## 7. 更新后的发布节奏

P0 端侧内测可继续推进，但需补：

- 云端语音单独同意真机验收和审计记录复核。
- 端侧模式计费口径。
- 面对面自动朗读防回声。
- Android 国内端侧 ASR 真实兜底路线。

P1 Call Link 和支付灰度前必须补：

- 登录 token 已接入 Call Link、在线同传、支付和 AI Agent，并由服务端强制游客边界；继续验收登录成功回跳、资源归属和账号失效恢复。
- 微信 WebView WebRTC 真机矩阵验收。
- 计费权威源和账单。
- 真实备案材料、隐私和 SDK 清单。

P2 PSTN/AI Agent 商用前必须补：

- 被叫告知和拒绝流程。
- 持牌服务商路径。
- 禁拨号段、频控、退订和黑名单。
- 内容安全审核、投诉举报和人工接管。

## 8. 下一步执行顺序

1. 依据 `docs/domestic-technical-design-merge-plan.md`，把外部 `04-account-identity-compliance.md` 中的 L0/L1/L2、同意类型、注销导出合并进当前账号合规文档。
2. 按 `docs/domestic-realtime-billing-data-design.md` 继续落地 segment 诊断字段、云端数据生命周期、PostgreSQL 账本和运营退款后台。
3. Web Guest 页已补能力检测、微信外开、复制链接降级、仅字幕降级、入房同意、备案占位和举报入口；下一步用微信/Safari/Chrome/Android 主流机型做真机矩阵。
4. 修 App 面对面自动朗读回声门控，并加入真机验收项。
5. 更新 PSTN/Agent 验收计划，增加开场告知、24h 禁拨、禁拨号段、频控和红队用例。
6. 真实运行模型链路，采集单位经济和 SLO 数据。

## 9. 2026-07-11 深度代码 Review 新增 TODO

以下 TODO 来源于 2026-07-11 对 API Server、Realtime Gateway、TTS Service、移动端 realtime client 和 JSON store 的代码审查。它们不推翻当前架构，但需要纳入发布前加固清单。

### 9.1 P1 发布前必须修复

| 编号 | TODO | 涉及模块 | 验收口径 |
| --- | --- | --- | --- |
| REVIEW-P1-1 | 语音克隆 referenceAudioId 归属校验：公开创建 voice profile 时不得接受客户端任意 `referenceAudioId` 并直接置为 ready；只能由服务端上传 reference audio 成功、校验用户归属并同步 TTS 后置为 ready | `services/api-server/src/modules/voice-profiles`、`services/model-services/tts-service` | 新增接口测试：伪造或复用他人 `referenceAudioId` 不会创建 ready profile；上传成功路径仍可试听和在线朗读 |
| REVIEW-P1-2 | WebSocket 异常断开也要 finalize session：非用户点击 End 的 close/error 路径需要 best-effort flush、记录 `session.ended`、调用内部结算并保存历史 | `services/realtime-gateway/src/connection`、`services/realtime-gateway/src/sessions`、`services/api-server/src/modules/realtime` | 新增测试：App 断网/进程退出/WS close 后 API session 不停留在 `created`，用量只结算一次，历史详情可打开 |
| REVIEW-P1-3 | 源码与 `dist` 构建产物一致性门禁：避免 TypeScript 源码已修但 `dist` 仍跑旧逻辑 | `services/api-server/dist`、`services/realtime-gateway/dist`、发布脚本 | `npm run build` 后发布；CI 或 release readiness 能发现未构建的脏 `dist`；生产启动脚本只使用已验证产物 |

### 9.2 P2 产品化加固

| 编号 | TODO | 涉及模块 | 验收口径 |
| --- | --- | --- | --- |
| REVIEW-P2-1 | 在线 TTS 按 session/segment 顺序排队：不能让短句后返回的音频抢先播放；session 结束时取消未完成 TTS | `services/realtime-gateway/src/tts`、`apps/mobile/lib/src/features/realtime` | 连续 10 句长短混合翻译时字幕和朗读顺序一致；结束后不再播放残留音频 |
| REVIEW-P2-2 | Realtime token 不再放 URL query：改用 WebSocket subprotocol、Header 能力或一次性连接 token，减少代理和日志泄露 | `apps/mobile/lib/src/features/realtime/data/gateway`、`services/realtime-gateway/src/connection` | 服务端日志和代理访问日志不出现原始 realtime token；旧 query 模式可灰度兼容并计划移除 |
| REVIEW-P2-3 | JSON store 迁移或加锁：当前整文件写入只适合开发测试，生产需 SQLite/PostgreSQL 或带锁的 append/event log；解析失败不得静默回空库 | `services/api-server/src/infrastructure/storage`、sessions、usage、account、voice profiles | 并发结束会话、退款、voice profile 上传不丢数据；损坏 JSON 被隔离并触发健康检查失败 |
