# 翻译与语音 AI Agent 统一运行时

版本：v1.0
日期：2026-07-17

## 1. 目标

翻译仍是产品主线，语音 Agent 作为同一通讯 session 中可启用的第二编排器。

禁止两种极端：

- 为 Agent 另建一套音频、ASR、TTS、通话和记录系统。
- 把每句翻译都改成 LLM Agent 对话，破坏忠实度、成本和延迟。

## 2. 共享 Speech Runtime

共享能力：

- 音频订阅、重采样、时钟和 jitter buffer。
- AEC/NS/echo gate。
- VAD、turn、speaker、language ID。
- ASR partial/final、flush、cancel。
- TTS streaming、playback generation、clear 和抢话。
- Provider fallback、观测和 session 生命周期。

共享输出是结构化 `SpeechTurn`，不是一段无来源的字符串。

## 3. Translation Runtime

职责：

1. 接收 final 或稳定 prefix。
2. 按来源 participant/leg 决定目标语言。
3. 应用术语、数字、姓名和格式保护。
4. 调用 MT Provider。
5. 发布原文和译文。
6. 可选调用 TTS，并定向到目标 leg。

翻译 runtime 不做：

- 自主改变用户意图。
- 调用外部业务工具。
- 根据文本猜测说话人身份。
- 用摘要替代忠实翻译。

## 4. Agent Runtime

Agent 运行时包含：

| 模块 | 职责 |
| --- | --- |
| Context Builder | 结构化 turn、目标、约束、授权和工具结果 |
| Policy Engine | 风险等级、号码、工具、支付、接管 |
| LLM Planner | 下一步回答或工具计划 |
| Tool Executor | 预约、查询、CRM、日历、DTMF 等 |
| Response Renderer | 面向听者的语言、风格和披露 |
| Handoff Manager | 用户接管、人工转接、warm transfer |
| Result Builder | 结果、摘要、待办和证据 |

## 5. 三种融合模式

### 5.1 Translation

纯翻译。Agent 不生成回复，只做可选的会后摘要。

### 5.2 Agent Assist

人仍在通话，Agent 不自动说话，只提供：

- 建议回复。
- 实时重点和实体卡片。
- 地址、姓名、号码的 Type-to-Speak。
- 对方意图和情绪风险提示。
- 一键生成追问。

用户点击后才把建议转换为目标语言并朗读。

### 5.3 Autonomous Agent

Agent 代表用户通话，但必须：

- 用户明确授权目标、号码和约束。
- 开场披露 AI 身份及录音/转写。
- 高风险动作等待确认或转人工。
- 用户可实时监听、暂停和接管。

## 6. 双语 Agent 策略

Agent 内部不依赖“固定说英语”或“固定说中文”。

流程：

```text
callee audio
  -> ASR(source language)
  -> canonical turn
  -> Agent reasoning
  -> response intent
  -> listener language renderer
  -> optional MT
  -> TTS
```

LLM 输出结构：

```json
{
  "action": "speak|tool|handoff|end",
  "listenerParticipantId": "callee",
  "responseText": "canonical text",
  "responseLanguage": "en",
  "requiresConfirmation": false,
  "reasonCode": "answer_question"
}
```

显示文本、翻译文本和播报文本分离，电话号码、金额、地址和字母串使用 TTS
专用规范化。

## 7. Agent 状态机

```text
draft
 -> authorized
 -> queued
 -> dispatching
 -> dialing
 -> disclosure
 -> active
      -> listening
      -> thinking
      -> tool_pending
      -> speaking
      -> handoff_pending
 -> completed / failed / cancelled
```

`agent_task` 与 `agent_run` 分离。一次 task 可以有多次 run，但每次真实拨号都
创建独立 session 或显式 retry attempt。

## 8. 工具安全

| 风险级别 | 示例 | 策略 |
| --- | --- | --- |
| L0 只读 | 营业时间、库存、订单状态 | 可自动执行 |
| L1 可撤销 | 预约、取消预约、创建工单 | 目标授权后可执行并记录 |
| L2 敏感 | 修改地址、账户信息、身份验证 | 通话中二次确认 |
| L3 高风险 | 支付、合同、医疗/法律决定 | 禁止自动执行，必须接管 |

工具调用必须保存 tool schema 版本、参数 hash、授权、结果和失败原因。LLM
不能直接持有 provider credential。

## 9. LiveKit Agents 的采用方式

第一阶段采用其运行时模式，而不是替换业务代码：

- Agent Dispatch 负责 job 分发。
- Agent Server 上报 load 和 availability。
- 每个 job 独立进程，单个崩溃不影响其他通话。
- 预热 idle process，降低首次加入延迟。
- 部署时 drain，不再接受新 job，等待现有通话结束。
- 意外退出由 LiveKit 检测并重新 dispatch。

实施建议：

1. Translation Worker 先包装为命名 `translation-runtime` 的 room job。
2. 新建独立 `voice-agent-runtime`，复用现有 Provider Contract。
3. 两者均消费统一 session snapshot 和 event contract。
4. 不在 API 进程中直接运行 LLM 或媒体循环。

Node Agents 适配当前 TypeScript 合同更直接，但必须先锁定通过依赖安全扫描的
版本。Python 仅在确有 Node 缺失能力时作为独立 Provider/worker，不让同一
业务逻辑维护两套实现。

## 10. 人工接管与转接

接管流程：

1. 用户点击接管或 Policy Engine 请求接管。
2. Agent 停止新工具和新 TTS。
3. clear 当前 playback。
4. 用户 leg 解除静音并成为主动说话者。
5. Agent 进入 observer，不再自动回复。
6. 保存接管原因和时间。

warm transfer：

- Agent 先呼叫人工目标。
- 提供脱敏摘要和目标。
- 人工接受后桥接原 caller。
- 失败则 Agent 回到原通话说明结果。

## 11. 功能增强

优先补充：

- 通话前 AI 计划预览和费用预估。
- 通话中建议回复、实体卡片和一键朗读。
- IVR/DTMF 导航。
- voicemail/人工/IVR 识别。
- warm transfer 和用户接管。
- 预约、客服、订单、日历等受控工具。
- 通话结果结构化：成功条件、证据、未解决项、下一步。
- Agent 质量回放：误听、误答、错误工具、接管原因。
- 企业词库、知识库和工作流 webhook。

## 12. 官方参考

- https://docs.livekit.io/agents/server/lifecycle/
- https://docs.livekit.io/agents/logic/fallback-strategies/
- https://docs.livekit.io/telephony/making-calls/outbound-calls/
- https://docs.livekit.io/telephony/features/transfers/warm/

## 13. 实时前台与持久后台

无界AI保留现有 Translation Runtime 和 Voice Agent AgentSession，只在 Agent
内部增加两条执行通道：

- 实时前台：翻译、字幕、当前轮直接回复、打断和接管。
- 持久后台：耗时工具、查询、委托任务和可延迟结果。

实时前台只暴露 create/cancel/status/time/memory/permission 等有界工具；复杂业务
工具由后台 Agent 和 Tool Gateway 按现有 L0-L3 权限执行。后台 Work 完成后不得
直接插播，必须通过 AnnouncementWindow：

1. 用户没有说话。
2. 当前回复和翻译 TTS 没有生成、排队或播放。
3. 目标 leg 在线且 generation 有效。
4. session 没有接管、转接或结束。

优先级固定为实时翻译高于当前 Agent 回复，当前 Agent 回复高于后台结果。结果生成
和交付分开记录，只有目标客户端真实播放结束回执才确认播报交付。不得以此重定义
现有服务端 playback 生命周期。

完整 ID、状态机、采用/拒绝清单和实施门见
`12-qwen-audio-agent-gap-adoption-plan.md`。
