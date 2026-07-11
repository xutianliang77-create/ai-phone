# ai phone 说话人归属技术设计

版本：v1.0  
日期：2026-07-11

## 1. 目标与边界

说话人能力拆成三层，不能混为一个功能：

1. **角色归属**：利用 Call Link、PSTN 或独立音轨直接得到 `host/guest/agent`。
2. **说话人分离**：单麦克风音频输出稳定的匿名标签，例如 `speaker_1/speaker_2`。
3. **身份识别**：用户明确授权并录入声纹后，把匿名标签映射为姓名。

说话人分离只回答“谁在什么时候说话”，不能证明现实身份。未授权、低置信度或多人重叠时必须显示匿名标签或“未知说话人”，不得由 LLM 根据文本猜测姓名。

## 2. 当前缺口

- 普通 realtime 的 `TranscriptEvent`、`SessionSegmentDto`、App `SubtitleSegment` 和历史记录没有说话人字段。
- Qwen3-ASR 当前返回文本、语言和置信度，不返回 speaker label 或时间区间。
- SegmentAssembler 只按语言和语义边界合并，尚未把“说话人变化”作为强制断句条件。
- Call Link 已有 `speakerRole`，但没有复用到普通同传数据契约。

## 3. 统一数据契约

新增可选 `speaker` 对象：

```ts
interface SpeakerAttribution {
  speakerId: string;
  role: "self" | "peer" | "host" | "guest" | "agent" | "speaker" | "unknown";
  label?: string;
  source: "participant_track" | "diarization" | "voiceprint" | "language_role" | "manual";
  confidence?: number;
}
```

`TranscriptEvent`、`SessionSegmentDto`、App 字幕、历史记录、导出和会后 review 均透传该对象。声纹模板 ID 不返回 App，也不写入普通 session 导出。

## 4. 数据流

```text
Call Link/PSTN 独立音轨
  -> participant metadata
  -> participant_track attribution
  -> ASR -> translation -> subtitle/history

面对面单麦克风
  -> PCM 16 kHz fan-out
  -> VAD + Streaming Diarization Provider
  -> speaker time spans
  -> ASR text time spans
  -> SpeakerSegmentAligner
  -> SegmentAssembler (speaker change forces split)
  -> translation -> subtitle/history

可选实名
  -> consented voice enrollment
  -> voiceprint match
  -> confidence gate
  -> named label or anonymous fallback
```

## 5. Provider 设计

新增 `SpeakerAttributionProvider`，与 ASR Provider 并列，不能写死在 Qwen3-ASR 实现中：

- `off`：不识别，兼容现有链路。
- `participant_track`：Call Link/PSTN 默认，准确性最高。
- `streaming_sortformer`：Beelink 服务端单麦克风流式分离候选。
- `voiceprint`：后续授权身份识别，不作为默认能力。

首选评测 `nvidia/diar_streaming_sortformer_4spk-v2.1`。官方模型支持在线说话人分离、Arrival-Order Speaker Cache 和最多 4 个说话人；正式接入前必须在独立 harness 测延迟、DER、显存、长会话标签漂移和中英混说。

## 6. App 交互

- 字幕顶部显示说话人标签和稳定颜色，同一 speaker 在会话内颜色不变。
- 默认显示“我/对方”仅限独立音轨或明确手动映射；单麦克风默认“说话人 1/2”。
- 用户可在会话中或历史详情中把匿名标签重命名，但只修改本次会话展示。
- VoiceOver/TalkBack 按“说话人、原文、译文、状态”顺序朗读。
- 重叠说话显示主要 speaker，并在诊断字段记录 overlap；不得合并两个 speaker 的文本。

## 7. 隐私与合规

- 说话人分离无需保存声纹，默认只保存匿名 label。
- 身份识别必须单独告知、单独同意、可撤回和可删除。
- 声纹模板加密存储，不能进入日志、导出、LLM prompt 或普通备份。
- 低置信度匹配必须回退匿名，禁止为了界面完整强制给出姓名。

## 8. 分阶段开发

1. `OPT-SPK-001`：统一 speaker 数据契约，Call Link 独立音轨先贯通字幕、历史和 review。
2. `OPT-SPK-002`：独立 harness 部署 Streaming Sortformer，完成双人和多人固定语料评测。
3. `OPT-SPK-003`：接入普通 realtime，增加时间对齐、speaker 强制断句和 App 标签。
4. `OPT-SPK-004`：可选声纹实名、授权、撤回、删除和误识别门禁。

## 9. 验收门槛

- Call Link/PSTN 独立音轨角色归属准确率 100%。
- 双人安静场景 DER 不高于 15%，噪声场景不高于 25%。
- speaker 切换 P95 不高于 1.2 秒，同一人 30 分钟标签不无故漂移。
- speaker 变化处不得被 SegmentAssembler 合并成同一字幕。
- 身份识别低于阈值显示匿名；未授权场景不生成或持久化声纹。
