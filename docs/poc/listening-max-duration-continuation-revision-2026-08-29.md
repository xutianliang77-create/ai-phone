# 聆听模式 max-duration continuation revision 设计

日期：2026-08-29
状态：实现基线
范围：无界AI在线聆听模式；不改变对话、通话、端侧 ASR 或模型权重

## 问题

真机 session `ff530e5c-e2d7-44dc-9100-e2d283b4450f` 使用 9.72 秒连续中文时，
Qwen ASR 在 `ASR_QWEN3_LISTENING_MAX_AUDIO_MS=6000` 处输出：

- `今天下午三点，我们会讨论产品计划。会议结束以后，我会整。`
- `整理会议纪要，并在下班前发给大家确认。`

Gateway 的 continuation buffer 默认为 5000ms，第二段 final 约 5600ms 后才到，
因此第一段已先翻译和持久化。结束/finalize 没有修订，最终形成
`我会整。整理会议纪要`。

## 决策

采用“立即 provisional + 后续同 ID revision”，不通过延迟第一段翻译等待下一段来解决。

1. 聆听模式收到 `max_duration` final 后立即发送 `transcript.final` 和
   `translation.final`，保持当前低延迟体验。
2. Gateway 在有界 revision window 内保留该 final 的只读快照。
3. 下一段满足全部安全条件时：
   - 先向客户端发送第二段 ID 的空 `transcript.final` tombstone，删除其 partial；
   - 使用第一段 `segmentId` 生成更高 revision 的合并 `transcript.final`；
   - 对合并原文重新翻译，并以相同高 revision 发送 `translation.final`；
   - API 使用现有同 ID revision merge 覆盖原文并清空旧译文，随后保存新译文。
4. 未满足安全条件时保留两个独立 final，不猜测合并。
5. flush 时已经发送的 provisional 直接保留；没有未发送尾段。

## 安全合并门

只有同时满足以下条件才允许 continuation revision：

- 前段 `endpointReason=max_duration`；
- 两段均有且具有相同 `turnId`；
- 两段均有且具有相同、非 unknown 的 `speakerId`；
- 两段语言一致；
- 两段均非 overlap，且 active speaker 不多于一个；
- 两段都有 timing；后一段 start 与前一段 end 的差值在 -500ms 到 +750ms；
- 后一段在配置的 revision window 内到达。

不同 speaker、不同 turn、overlap、异常 speaker、缺 timing、缺 speaker、缺 turn、
时间不连续或超时一律不合并。

## 受约束中文一字去重

现有两字及以上重叠规则保持不变。仅在上述安全门已通过且前段为硬续接时，允许一个
汉字的 suffix/prefix 重叠，例如：

- `我会整。` + `整理会议纪要` → `我会整理会议纪要`

以下单字符不得被新规则删除：

- ASCII/拉丁字母；
- 阿拉伯数字；
- 中文数字及金额字符：零、〇、一、二、三、四、五、六、七、八、九、十、百、千、
  万、亿、两、点、元、角、分及大写数字。

因此 `A` + `ASR`、`3` + `31.5`、`三` + `三十一` 保持原输入，不由新规则猜测去重。

## 客户端 revision 行为

- 更高原文 revision 到达时立即清空旧译文和旧译文 provider 元数据，避免新原文短暂
  搭配旧英文；
- 新 `translation.final` 到达后填入新译文；
- 空 `transcript.final` 仅删除被 continuation 吸收的第二段草稿；
- 旧 revision 的迟到翻译不得覆盖新 revision。

## 回归门

必须覆盖：

1. `整/整理` 真问题：第一段立即输出，第二段安全到达后第一段升 revision，第二段删除；
2. 第二段到达晚于 window：保持两个 segment；
3. 不同 speaker、不同 turn、overlap、时间 gap、缺证据：保持两个 segment；
4. 多个连续 max-duration：同一逻辑 segment 连续升 revision；
5. 中文数字、金额和拉丁实体单字符：不得被新规则删除；
6. 普通非 max-duration 零错短句：行为不变；
7. flush：provisional 不丢失、不重复；
8. API：新 revision 清旧译文，迟到旧译文不能回滚；
9. Flutter：新原文 revision 清旧译文，tombstone 删除第二段 partial；
10. 真机同一 9.72 秒样本：最终一个逻辑 segment，无`整。整理`或`整整理`；
11. 短门通过后才运行 AliMeeting；overlap 仍只做诊断，不并入普通准确率硬判。

## 回滚

- 服务器保留部署前 container/image/config/PID 快照；失败时恢复原 image 和 env；
- iOS 保留 build `2026082806`；新 build 使用同 bundle 覆盖安装，可回退 2806；
- 不修改 Qwen ASR、Hy-MT2、VoxCPM2、Sortformer 模型或权重。
