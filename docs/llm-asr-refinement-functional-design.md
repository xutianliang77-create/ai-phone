# LLM ASR 文本优化功能设计

版本：v0.1  
日期：2026-07-08  
上级文档：`docs/llm-asr-refinement-and-record-review-functional-design.md`

## 1. 目标

使用 LLM 对 ASR final 结果做轻量优化，让字幕和后续翻译更稳定：

- 通过上下文理解去重。
- 去掉无意义口语填充。
- 修正明显错别字和同音误识别。
- 补充合理标点和断句。
- 保留数字、姓名、地址、金额、日期、订单号、产品型号和术语。

LLM 不是 ASR 真值来源，只是 `rawText` 之后的 `optimizedText`。

## 2. 使用场景

| 场景 | 用户问题 | 优化目标 |
| --- | --- | --- |
| 面对面同传 | ASR 有重复、口头禅、错别字 | 字幕更干净，翻译更准确 |
| Listening Mode | 长句断句差、上下文断裂 | 合并语义，补标点，减少误断 |
| Call Link | 双方语音中有噪声和重复确认 | 保留真实意图，减少噪声文本 |
| PSTN/AI Agent | 电话带宽导致错词 | 利用上下文和术语纠错 |
| 领域沟通 | 模型名、产品名、金额、地址识别错 | 保护术语和关键实体 |

## 3. 用户可见能力

入口：

- 同传设置中的“智能字幕优化”。
- 记录详情中的“优化全文”。
- 模型链路诊断中的 LLM 优化 Provider 状态。

开关：

- 关闭：只显示原始 ASR final 和翻译。
- 标准：实时 final 段进入 LLM 优化，超时自动回退。
- 严格：仅纠正明显重复、标点和保护词，不做语义顺滑。
- 会后高质量：仅记录详情使用，可跨整场会话整理。

展示：

- 实时字幕默认展示优化后文本。
- 点开 segment 详情可查看“原始识别”和“智能优化”。
- 低置信度优化显示“已按原文翻译”或“建议核对”。

## 4. 优化范围

允许：

- 去除 `<sil>`、`[noise]`、重复字、重复半句。
- 去除“嗯、啊、就是、那个、然后然后”等无意义口语填充。
- 修正明显错别字、同音误识别和断句标点。
- 根据前后 3-8 个 segment 修复指代、术语和上下文断裂。
- 将“字幕/字母”“同声传义/同声传译”等已知错词修正。
- 对中英混说保持原语言片段，不强行翻译或归一。

禁止：

- 添加用户没有说过的新事实。
- 修改数字、金额、日期、地址、电话、订单号，除非上下文有强证据。
- 把不确定姓名、公司名、型号名猜成常见词。
- 为了语义通顺删除用户明确表达的否定、条件、时间和责任主体。
- 替代人工法律、医疗、财务判断。

## 5. 输入上下文

LLM 优化请求输入：

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 会话 ID |
| `segmentId` | 当前段 ID |
| `mode` | realtime、call_link、pstn、agent、listening |
| `speakerRole` | host、guest、speaker、agent |
| `sourceLanguage` | ASR 识别语言 |
| `targetLanguage` | 目标翻译语言 |
| `rawText` | 原始 ASR final |
| `previousSegments` | 最近 N 段 raw/optimized/translation |
| `glossary` | 用户术语库和会话候选术语 |
| `protectedTerms` | 不得改写的数字、姓名、型号、地址等 |
| `asrProvider` | ASR provider 和 model |
| `confidence` | ASR 置信度，如有 |

## 6. 输出结构

LLM 必须返回 JSON：

```json
{
  "optimizedText": "今天下午三点我们讨论产品计划，之后我会整理会议记录发给大家。",
  "language": "zh",
  "confidence": 0.86,
  "operations": ["dedupe", "punctuation", "filler_removal"],
  "protectedTermsKept": ["三点"],
  "warnings": []
}
```

失败或低信心：

```json
{
  "optimizedText": "",
  "confidence": 0.32,
  "operations": [],
  "warnings": ["low_confidence_keep_raw"]
}
```

## 7. 实时处理策略

在线链路：

1. ASR 输出 `transcript.final`。
2. 确定性清洗先执行：静音标记、空文本、完全重复段过滤。
3. LLM 优化 final 段。
4. 成功且置信度达标时，用 `optimizedText` 进入翻译。
5. 失败、超时或低置信度时，用 `rawText` 进入翻译。
6. 历史保存 raw、optimized、translation 和 provider 诊断。

延迟策略：

- 面对面同传：LLM 优化预算 800-1200ms，超时回退。
- Listening Mode：预算 1500-2500ms，可接受稍慢但更稳。
- Call Link/PSTN：预算 1200-2000ms，优先不阻塞字幕。
- 会后整理：不走实时预算，可使用高质量模式。

端侧模式：

- 默认不把端侧 ASR 自动上传给云端 LLM。
- 用户登录并开启“云端智能优化”且完成语音敏感信息单独同意后，才允许上传 final 文本。
- 离线端侧只做确定性清洗和术语替换，不做云端 LLM 优化。

## 8. 验收标准

- 不能增加原文没有的事实。
- 数字、金额、地址、日期、型号保持率大于 99%。
- 对 `<sil>`、重复半句、明显口语填充的过滤成功率大于 95%。
- 面对面模式 LLM 优化 p95 不超过 1200ms，超时必须回退 raw。
- 优化失败不影响字幕、翻译和历史保存。

