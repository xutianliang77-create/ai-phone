# LLM ASR 文本优化与记录整理功能设计

版本：v0.2  
日期：2026-07-08  
关联文档：`docs/domestic-app-detailed-functional-design.md`、`docs/domestic-realtime-billing-data-design.md`、`docs/model-provider-access-layer.md`
技术设计：`docs/llm-provider-access-layer-design.md`

## 1. 功能定位

本设计新增两类 LLM 文本智能能力：

1. ASR 结果优化：结合上下文、术语和语言方向，对 final 字幕做去重、去口语填充、错别字纠正和语义顺滑。
2. 记录整理：对会议纪要、通信记录、电话记录和 AI Agent 任务结果做结构化整理。

详细设计拆分为：

- `docs/llm-asr-refinement-functional-design.md`
- `docs/llm-record-review-functional-design.md`

参考吸收：`docs/fluidvoice-source-review-and-adoption-plan.md`

## 2. 核心原则

- 原始 ASR 永远保留，不被 LLM 覆盖。
- LLM 输出必须可追溯到原 segment。
- 实时同传优先低延迟和不漏译；LLM 超时或低置信度时回退原 ASR 文本。
- 会议纪要和通信记录优先准确、结构化和可复查，不追求文学化改写。
- 数字、姓名、地址、金额、日期、订单号、产品型号和术语是保护字段。
- 端侧模式默认不上传 ASR 文本；只有登录、开启云端智能优化并完成语音敏感信息单独同意后才可上传 final 文本。

## 3. 用户价值

| 能力 | 解决的问题 | 用户结果 |
| --- | --- | --- |
| ASR 智能优化 | 重复、口头禅、错别字、断句差 | 字幕更干净，翻译更准确 |
| 会议纪要 | 长会话难回看 | 自动得到摘要、决定、待办和重点 |
| 通信记录 | 电话和 Call Link 信息分散 | 自动得到沟通目的、承诺、关键事实和后续动作 |
| Agent 任务结果 | AI 打电话后结果不够清楚 | 明确是否完成、证据、失败原因和下一步 |

## 4. 产品入口

ASR 优化入口：

- 同传设置中的“智能字幕优化”。
- 记录详情中的“优化全文”。
- 模型链路诊断中的 LLM 优化 Provider 状态。

记录整理入口：

- 记录详情右上角“生成纪要”。
- Listening Mode 结束按钮“结束并总结”。
- Call Link/电话结束页“生成通信记录”。
- AI Agent 任务详情自动生成“任务结果摘要”。

## 5. 数据模型总览

同传 segment 需要保留三层文本：

```json
{
  "segmentId": "seg_12",
  "rawText": "今天下午三点我们在会议史讨论产品计划之后我会整理会议记录发给大家",
  "optimizedText": "今天下午三点，我们在会议室讨论产品计划。之后我会整理会议记录发给大家。",
  "translatedText": "At three o'clock this afternoon, we will discuss the product plan in the meeting room. After that, I will organize the meeting notes and send them to everyone.",
  "refinement": {
    "provider": "openai_compatible",
    "model": "qwen-plus",
    "promptVersion": "asr_refine_v1",
    "confidence": 0.86
  }
}
```

记录 review 需要保存：

- review 版本。
- prompt 版本。
- provider/model。
- 生成时间。
- 输入 segment 范围。
- 输出 JSON。
- 用户是否重新生成。

## 6. Provider 定位

新增 LLM Provider 类别，不与现有模型职责混用：

| Provider | 职责 |
| --- | --- |
| ASR Provider | 语音转文字 |
| MT Provider | 翻译，例如 Hy-MT2 |
| TTS Provider | 语音合成，例如 VoxCPM2 |
| LLM Provider | ASR 文本优化、会议纪要、通信记录、Agent 结果整理 |

LLM Provider 默认走 OpenAI-compatible `/v1/chat/completions`，候选模型包括 qwen-plus、Qwen3、DeepSeek、GLM 和 LM Studio 本地 Qwen。

## 7. 分阶段计划

| 阶段 | 范围 | 原因 |
| --- | --- | --- |
| Phase 1 | 会后整理和通信记录 | 不影响实时同传链路，最容易产品化 |
| Phase 2 | 在线 ASR final 优化 | 改善翻译输入质量，但必须有超时回退 |
| Phase 3 | 端侧授权后的云端优化和术语闭环 | 兼顾隐私、领域词和长期质量 |

## 8. 实现 TODO

- [ ] LLM Provider 抽象：新增统一 LLM Provider 接口，支持 OpenAI-compatible `/v1/chat/completions`、JSON schema 校验、超时、重试、空输出回退和 provider/model/promptVersion 诊断。
- [ ] LLM Provider 验证：参考 FluidVoice 的 Provider gate 思路，增加 baseURL、model、apiKey、本地端点、云端端点和 fingerprint 校验。
- [ ] Segment 三层文本：同传和通话历史 segment 同时保存 `rawText`、`optimizedText`、`translatedText`，并保存 refinement provider/model/promptVersion/confidence。
- [ ] 结构化 review 输出：改造 `/sessions/:sessionId/review`，输出 title、summary、decisions、actionItems、keyFacts、risks、openQuestions、terms 和 evidence segment 引用。
- [ ] App 历史详情展示：历史详情增加纪要、待办、全文原始识别、智能优化、译文、术语和 Markdown 导出展示。
- [ ] 术语闭环升级：把翻译术语、ASR 保护词和 LLM 保护字段合并成统一术语/保护词体系。

## 9. 验收总则

- LLM 不能增加原文没有的事实。
- 优化失败不能影响字幕、翻译和历史保存。
- 每个待办或关键事实能追溯到 segment。
- Markdown 导出包含纪要、待办、全文和术语。
- 用户可以删除 review；删除历史时同步删除 review。
- 日志脱敏，不记录完整手机号、API Key、token。
