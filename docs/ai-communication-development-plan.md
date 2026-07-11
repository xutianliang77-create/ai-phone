# AI 通讯翻译开发方案与任务计划

版本：v0.3  
日期：2026-07-03  
依据：`docs/ai-communication-feature-design.md`、`docs/ai-communication-ui-design.md`、`docs/ai-communication-ui-screen-specs.md`、`docs/ai-communication-technical-design.md`

## 1. 开发原则

- 先稳定现有同传，再扩展通话。
- 先做可控 Call Link，再做 PSTN 拨号。
- 先字幕和记录，再做 TTS 和自定义语音。
- 所有用量和 credits 以服务端为准。
- 每个大功能都要有 mock provider，避免被外部服务阻塞。
- iOS/Android 只通过薄平台适配层分叉。

## 2. 阶段总览

| 阶段 | 目标 |
| --- | --- |
| M0 | 稳定现有同传和端侧 ASR |
| M1 | 新导航和页面骨架 |
| M2 | Talk/Listening/Type-to-Speak |
| M3 | 记录、摘要、重点、术语建议 |
| M4 | Call domain、credits、事件协议 |
| M5 | Call Link / WebRTC 通话房间 |
| M6 | 拨打手机号 / PSTN POC |
| M7 | 扫描 OCR 翻译 |
| M8 | AI Calling Agent |
| M9 | 订阅、隐私、发布硬化 |

## 3. M0 稳定现有同传

任务：

- 固化当前 iOS 端侧 ASR 参数。
- 回归自动语言识别、无翻译 flush、自动滚动。
- 建立 30 条中英真机测试语料。
- 领域词本地纠错第一版。

验证：

- iPhone 真机连续 10 分钟同传。
- 中英快速切换不丢第二句。
- 历史记录有原文和译文。
- Flutter test、flutter analyze、check:lines 通过。

## 4. M1 新导航和页面骨架

移动端任务：

- 新增底部 Tab：同传、通话、扫描、记录、我的。
- 保留当前同传页为默认首页。
- 新增通话首页、扫描占位、记录列表入口、我的页。
- 统一中文文案和状态条。

后端任务：

- 暂无新增业务，只补 `/usage/balance` 展示。

验证：

- iOS/Android 页面尺寸适配。
- 所有 Tab 可切换，不丢当前同传状态。
- 中文文案不溢出。

## 5. M2 Talk/Listening/Type-to-Speak

移动端任务：

- 同传页增加分段控制：面对面、听讲、键入朗读。
- Listening Mode 关闭 TTS，启用大字号字幕。
- Type-to-Speak 弹窗支持输入、翻译、播放、插入记录。
- 快捷短语本地缓存。

后端任务：

- 新增 text translation endpoint 或复用本地 provider。
- session segment 支持 `source=typed`。

验证：

- Type-to-Speak 内容进入历史。
- Listening Mode 点击“结束并总结”能保存记录。
- 播放 Type-to-Speak 时不触发重复 ASR。

## 6. M3 记录、摘要、重点、术语建议

移动端任务：

- 历史详情新增 Tab：摘要、重点、全文、术语。
- 字幕长按支持标记重点、纠正术语。
- 导出弹窗支持 Markdown、纯文本，PDF 可后置。

后端任务：

- Summary Service：输入 segments，输出摘要和待办。
- Highlight Service：抽取时间、地点、金额、待办。
- Terms Service：用户确认后写入术语库。

验证：

- 摘要失败不影响打开全文。
- 手动重点能保存并导出。
- 术语确认后后续同传生效。

## 7. M4 Call domain、credits、事件协议

后端任务：

- 新增 call_sessions、call_participants、call_segments、call_usage_ledger。
- 新增 `/call/rooms`、`/call/{id}`、`/call/{id}/end`。
- 新增 Call Event WebSocket。
- 实现 credits reserve/tick/settle/refund。
- 实现 mock call provider。

移动端任务：

- 通话首页接真实 API。
- Call Link 创建页和拨号页接 mock。
- 通话中页面接事件流。

验证：

- mock 通话可创建、连接、结束、保存。
- End 幂等。
- credits 失败时不能进入通话。

## 8. M5 Call Link / WebRTC 通话房间

基础设施任务：

- 选择 LiveKit Cloud 或自托管 LiveKit。
- 配置 room token 签发。
- Web Guest 页面支持麦克风入会。
- Translation Worker 订阅音频轨道。

移动端任务：

- Flutter 接入 LiveKit SDK。
- 通话房间显示双方字幕、状态、credits。
- 分享链接到微信、WhatsApp、短信、邮件。

AI 任务：

- Worker 处理双方音频。
- 输出 transcript/translation 事件。
- TTS 轨道回放或先只显示字幕。

验证：

- App + 浏览器可通话。
- 双方字幕能区分我/对方。
- 结束后历史详情有全文。

## 9. M6 拨打手机号 / PSTN POC

后端任务：

- Twilio outbound call POC。
- Twilio bidirectional Media Streams POC。
- Telnyx media streaming 对比 POC。
- provider webhook 签名校验和 `eventId` 幂等去重。
- provider call id 入库。

移动端任务：

- 拨打手机号页。
- 费用预估和确认弹窗。
- 拨号状态页：拨号、响铃、接通、未接、忙线。

AI 任务：

- App 音频 -> 翻译 -> TTS -> PSTN。
- PSTN 音频 -> 翻译 -> TTS/字幕 -> App。

验证：

- 美国/加拿大手机号真实拨通。
- 对方不装 App 可听到翻译语音。
- 10 分钟通话不断线。
- 未接听退款。

## 10. M7 扫描 OCR 翻译

移动端任务：

- 扫描页接相机、相册、截图导入。
- 结果页支持原文、译文、对照。
- 保存到记录。

后端/Provider 任务：

- iOS Vision / Android ML Kit 本地 OCR POC。
- 云 OCR provider 兜底。
- OCR 记录模型。

验证：

- 菜单、路牌、表格各 10 张测试。
- 中英双向翻译。
- OCR 失败有可理解提示。

## 11. M8 AI Calling Agent

后端任务：

- Agent Planner：任务转通话计划。
- Agent Worker：电话中根据对方回答生成回复。
- App/API 任务草稿、用户授权、接管记录、确认前取消、执行队列、Worker 状态回写、内部队列拉取和 HTTP PSTN Bridge 调度已完成。
- PSTN Bridge 签名 completed/failed webhook、`eventId` 幂等、终态 `consumedSeconds` 扣费结算和本地 smoke 已完成。
- Agent Worker 真实媒体执行、真实 PSTN 拨号和通话中生成回复待完成。
- 高风险信息拦截已完成规则骨架，真实通话时仍需二次拦截。

移动端任务：

- AI Agent 任务页和话术预览已接入 App。
- 授权按钮、开始执行按钮、刷新状态按钮、人工接管按钮和取消任务按钮已接入 App。
- App 已展示 `queued/in_progress/completed/failed`、call id、结果摘要、失败原因和下一步。
- 通话中实时监控页待真实 PSTN/VoIP 执行链路完成后接入。

验证：

- 预约/查询/客服三个 mock 场景通过。
- 未确认不拨号。
- 确认前取消后不能再授权。
- 执行服务未配置时不进队列，返回 503 和 readiness 原因。
- Worker 内部状态回写后 App 可刷新看到结果。
- Agent Call Worker 可拉取 queued 任务，提交给 HTTP PSTN Bridge，Bridge 失败时回写 failed，Bridge 完成时通过签名 webhook 回写 completed；终态带 `consumedSeconds` 时 API 只写一次 `agent_call_usage` 用量账。
- `npm run check:agent-call-worker -- --json` 可在本地隔离验证 API 入队、mock Bridge 收单、真实 Worker 状态回写和签名完成回调。
- 涉及付款或身份验证必须接管。

## 12. M9 订阅、隐私、发布硬化

任务：

- Apple IAP 和 Google Play Billing。
- Credits 商品和服务端交易校验。
- 隐私页：端侧状态、音频保存策略、删除记录。
- Crashlytics/Sentry。
- App Store/Google Play 上架材料。

验证：

- 沙盒支付成功。
- 退款/取消订阅状态同步。
- 删除记录后服务端不可恢复查看。
- 发布前真机回归。

## 13. 测试矩阵

| 类型 | 覆盖 |
| --- | --- |
| 单元测试 | 状态机、credits、摘要、术语、号码校验 |
| Widget 测试 | Tab、字幕列表、Type-to-Speak、通话状态 |
| 集成测试 | API + Gateway + mock provider |
| 真机测试 | iPhone、Android、浏览器 Guest |
| 外部服务测试 | Twilio、Telnyx、LiveKit |
| 长稳测试 | 30 分钟同传、10 分钟电话 |

## 14. 近期执行顺序

1. 先做 M1：底部导航和通话/扫描/我的页面骨架。
2. 做 M2：Listening Mode 和 Type-to-Speak。
3. 做 M3：历史详情摘要/重点 Tab。
4. 做 M4：Call domain mock API。
5. 做 M5：LiveKit Call Link POC。
6. 做 M6：接真实 PSTN Bridge，先用 Agent Call Worker 调度队列和签名 webhook 闭环，再做 Twilio/Telnyx 或国内服务商 POC。

这个顺序能持续保持 App 可运行，同时逐步接近 AI Phone/AI Call 的完整能力。

## 15. 区域化补充

当前开发主线改为国内版优先。M1 同步加入 `REGION_EDITION` 配置：

- `international`：默认启用国际 Provider、国际分享渠道和国际支付入口。
- `domestic`：默认启用国内 Provider、国内分享渠道和国内支付入口。

后续开发以 `domestic` 验收为准，国际版保留配置和 adapter 预留，不作为当前主验收线。

详细拆分见 `docs/regional-edition-product-design.md` 和 `docs/regional-edition-technical-design.md`。

国内版详细计划见 `docs/domestic-edition-development-plan.md` 和 `docs/domestic-edition-acceptance-plan.md`。
