# LLM 会议纪要与通信记录整理功能设计

版本：v0.1  
日期：2026-07-08  
上级文档：`docs/llm-asr-refinement-and-record-review-functional-design.md`

## 1. 目标

使用 LLM 对同传、会议、电话和 AI Agent 记录做结构化整理：

- 生成更准确、合理的一句话摘要。
- 提取会议决定、待办事项、关键事实和未解决问题。
- 整理电话/Call Link 的双方诉求、承诺和后续动作。
- 让通信记录可复制、导出、分享和追溯。

记录整理不替代原始记录，必须保留 raw ASR、optimized ASR 和 translation。

## 2. 使用场景

| 场景 | 输出名称 | 核心价值 |
| --- | --- | --- |
| Listening Mode 会议 | 会议纪要 | 一句话结论、议题、决定、待办 |
| 课堂讲座 | 学习笔记 | 主题、知识点、重点、疑问 |
| Call Link | 通信记录 | 双方诉求、关键承诺、后续动作 |
| PSTN 翻译电话 | 电话记录 | 来电/去电目的、结果、号码/时间/金额 |
| AI Calling Agent | 任务结果 | 是否完成、失败原因、下一步建议 |

## 3. 入口和流程

入口：

- 记录详情右上角“生成纪要”。
- Listening Mode 结束按钮“结束并总结”。
- Call Link/电话结束页“生成通信记录”。
- AI Agent 任务详情自动生成“任务结果摘要”。

流程：

1. 用户结束会话。
2. App 保存本地或云端 session。
3. 用户点击生成，或在允许自动生成的场景由服务端生成。
4. 服务端读取 segment raw/optimized/translation。
5. LLM 生成结构化 review。
6. App 展示并允许重新生成、复制、导出和分享。

## 4. 输出内容

会议纪要：

- 标题。
- 一句话结论。
- 背景和会议目的。
- 讨论主题。
- 已达成决定。
- 待办事项：负责人、动作、截止时间。
- 关键事实：时间、地点、金额、电话、地址、订单号、产品型号。
- 风险和不确定项。
- 原文证据 segment 引用。

通信记录：

- 通信对象和角色。
- 沟通目的。
- 双方主要诉求。
- 已确认事项。
- 未解决问题。
- 对方承诺和我方承诺。
- 后续跟进话术建议。
- 关键事实和证据 segment。

AI Agent 任务结果：

- 任务是否完成。
- 完成证据。
- 未完成原因。
- 对方反馈。
- 需要用户确认的问题。
- 建议下一步。

## 5. 输出结构

```json
{
  "title": "产品计划会议纪要",
  "summary": "会议确认下午三点讨论产品计划，会后整理会议记录并发给参会人。",
  "decisions": ["本周先完成在线同传稳定性测试"],
  "actionItems": [
    {
      "owner": "我",
      "task": "整理会议记录并发给大家",
      "due": "今天下班前",
      "evidenceSegmentIds": ["seg_12"]
    }
  ],
  "keyFacts": [
    {
      "type": "time",
      "value": "今天下午三点",
      "evidenceSegmentIds": ["seg_8"]
    }
  ],
  "risks": ["ASR 对领域词仍不稳定"],
  "openQuestions": ["是否需要为领域词启用术语库强纠错"],
  "terms": [
    {
      "sourceText": "FireRedASR2-AED",
      "translatedText": "FireRedASR2-AED"
    }
  ],
  "confidence": 0.84,
  "provider": "openai_compatible",
  "model": "qwen-plus"
}
```

## 6. UI 设计

记录详情 Tab 调整为：

- 纪要。
- 重点。
- 待办。
- 全文。
- 术语。

全文页展示：

- 原始识别。
- 智能优化。
- 译文。
- 说话方。
- 时间戳。
- provider/model。

纪要页操作：

- 重新生成。
- 复制纪要。
- 导出 Markdown。
- 分享。
- 标记错误。

待办页操作：

- 复制待办。
- 标记已完成。
- 导出为清单。
- 后续可接日历或提醒。

## 7. 数据和审计

必须保存：

- review 版本。
- prompt 版本。
- provider/model。
- 生成时间。
- 输入 segment 范围。
- 输出 JSON。
- 用户是否重新生成。

必须保留：

- raw ASR。
- optimized ASR。
- translation。
- review。

不得保存：

- 原始音频，除非用户明确打开录音保存。
- 不必要的模型中间推理。
- prompt 中的密钥、手机号明文日志。

## 8. Provider 要求

LLM Provider 需满足：

- 走 OpenAI-compatible chat/completions。
- 必须支持 JSON 输出。
- 必须有超时、重试、空输出回退。
- 必须记录 provider/model/promptVersion。
- 不与 Hy-MT2 翻译模型混用职责：Hy-MT2 做翻译，LLM 做优化和整理。

## 9. 验收标准

- 至少生成标题、摘要、重点、待办、关键事实和不确定项。
- 每个待办或关键事实能追溯到 segment。
- 重新生成不会丢原始历史。
- Markdown 导出包含纪要、待办、全文和术语。
- 云端 LLM 处理前必须满足登录和语音敏感信息单独同意。
- 删除历史时同步删除 review。

