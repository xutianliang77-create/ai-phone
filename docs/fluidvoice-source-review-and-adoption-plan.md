# FluidVoice 源码评审与采纳方案

版本：v0.1  
日期：2026-07-08  
源码：`https://github.com/xutianliang77-create/FluidVoice`  
本地缓存：`.cache/external-fluidvoice`

## 1. 结论

FluidVoice 是 macOS 本地优先的语音转文字产品，优点集中在四点：

- ASR Provider 抽象清晰，区分 streaming、final、dictionary training、file transcription 和 model preparation。
- LLM 后处理独立于 ASR，支持本地 Provider、云 Provider、Provider 验证、超时、重试和模型诊断。
- 历史记录保留 raw text、processed text、AI 处理状态、模型和失败原因。
- 词典、custom words、Local API、历史统计和 onboarding 让产品更完整。

由于 FluidVoice 使用 GPLv3，本项目不直接复制源码、UI 资产或实现细节，只吸收产品和架构思想，用当前 Flutter + Node/TypeScript + Python 架构重新实现。

## 2. 可吸收优点

| FluidVoice 做法 | 我们的吸收方式 |
| --- | --- |
| `TranscriptionProvider` 将 ASR 能力抽象为准备、转写、流式、最终、文件和缓存管理 | 在线 ASR / 端侧 ASR Provider 继续保持统一接口，后续为流式和 final 输出增加明确能力标记 |
| LLM post-processing 单独服务化，不把 ASR 原文覆盖掉 | 新增 LLM Provider，用于 ASR final 优化和记录整理 |
| Provider 配置有 baseURL、model、apiKey、本地端点判断和验证状态 | `profiles.*.llm` 增加 provider health、验证、fingerprint 和模型列表 |
| 历史保存 raw/processed、模型、AI 失败原因 | segment 保存 `rawText`、`optimizedText`、`translatedText`、refinement 诊断和失败原因 |
| 自定义词典和 custom words 可导入、合并、去重 | 术语库升级为“术语 + ASR 保护词 + LLM 保护字段”三层 |
| Local API 提供 `/v1/transcribe`、`/v1/postprocess`、词典管理 | 内测阶段增加本地/内网调试 API，便于模型评测和自动化回归 |
| LLM request body 有针对兼容 Provider 的回归测试 | 新增 LLM Provider 合同测试，覆盖 `stream=false`、JSON 输出、空输出、thinking 标签和非 JSON 回退 |
| 历史统计、音频预算、导出 | 我们只采纳“可选录音保存 + 存储预算 + 导出清单”，默认仍不保存原始音频 |

## 3. 我们当前不足

- LLM Provider 还没有成为正式模块，`/sessions/:sessionId/review` 当前仍偏 Summary Provider。
- session segment 仍以 `sourceText/translatedText` 为主，缺 `rawText/optimizedText/refinement`。
- Review 输出只有 summary、highlights、terms，缺 decisions、actionItems、keyFacts、risks、openQuestions 和证据 segment。
- App 历史详情还是摘要、重点、全文、术语四个 Tab，缺纪要、待办、原始识别和智能优化对照。
- 术语库还没有和 ASR 保护词、LLM 保护字段形成一个闭环。
- LLM Provider 缺少 FluidVoice 式的 Provider 验证、local endpoint 免 key、cloud endpoint 必须 key、fingerprint 防配置漂移。

## 4. 采纳 TODO

P0：先补服务端和历史数据结构。

- [ ] 新增 LLM Provider 抽象：OpenAI-compatible chat/completions、JSON schema 校验、超时、重试、空输出回退、thinking 标签剥离。
- [ ] 新增 Provider 验证和 fingerprint：baseURL + apiKey 生成配置指纹；本地端点允许无 key；云端端点必须 key。
- [ ] 扩展 segment：保存 `rawText`、`optimizedText`、`translatedText`、`refinement.provider/model/promptVersion/confidence/error`。
- [ ] LLM ASR refinement：final 文本进 LLM 优化，失败或超时回退 raw，不能阻塞翻译。

P1：补记录整理和 App 展示。

- [ ] 改造 `/sessions/:sessionId/review`：输出 title、summary、decisions、actionItems、keyFacts、risks、openQuestions、terms 和 evidence segment 引用。
- [ ] 历史详情 Tab 改为纪要、重点、待办、全文、术语。
- [ ] 全文 Tab 支持原始识别、智能优化、译文、provider/model 和时间戳对照。
- [ ] Markdown 导出包含纪要、待办、全文三层文本和术语。

P2：补产品化体验。

- [ ] 同传设置增加“智能字幕优化”：关闭、标准、严格、会后高质量。
- [ ] 术语库升级为“翻译术语、ASR 保护词、LLM 保护字段”。
- [ ] 增加可选录音保存、存储预算、删除和导出；默认不保存原始音频。
- [ ] 增加模型评测 Local API，仅限内测或开发模式。

## 5. 不采纳项

- 不采纳 macOS 全局热键、辅助功能输入和菜单栏模式。
- 不采纳 Command Mode 控制电脑能力。
- 不采纳 GPL 源码、UI 资产、图标和私有 Fluid Intelligence 实现。
- 不把 Local API 暴露到公网或生产默认开启。

## 6. 验收标准

- LLM Provider 可以在 qwen-plus、LM Studio、OpenAI-compatible 本地/内网端点之间切换。
- Review JSON 不合法时不覆盖旧 review，并返回中文错误。
- 每个 actionItem 和 keyFact 至少带一个 evidence segment。
- segment 详情能看到 raw、optimized、translated 三层文本。
- LLM refinement 失败不影响字幕、翻译、历史保存和用量结算。
- 删除历史时同步删除 review、可选录音和 LLM 诊断数据。

