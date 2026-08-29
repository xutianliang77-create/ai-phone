# 聆听模式 speaker boundary rollback/reassignment 设计

日期：2026-08-29
状态：实现基线

## 现场问题

AliMeeting session `c7829e07-d2d7-4080-947d-6327db53fade` 的第一条确认边界为
`1787970350282ms`，但前一 speaker segment 结束于 `1787970350741ms`，多出
459ms。参考中 speaker B 开头的`我觉得咱们这个这个目标人群`，有
`我觉得咱这个这个`被写进 speaker A。

Sortformer 数量和 A→B→A 顺序正确；问题是边界在 ASR endpoint 已输出后才确认：

- boundary confirmation latency：960ms；
- ASR endpoint 越界：459ms；
- `commitMissCount=2`，`commitHitCount=0`。

## 决策

不降低 Sortformer 阈值，不按字符或固定毫秒盲删文本。采用同一 Qwen ASR 的有界
边界重解码，作为 post-confirmation revision：

1. Gateway 为启用 diarization 的 session 保留最近 8 秒原始 PCM 帧。
2. 记录最近已发 final transcript；只在 commit miss 且前一 transcript timing 确实
   跨过确认边界时建立 correction candidate。
3. 边界后达到1.8秒时先冻结前置800ms、后置1.8秒PCM；等待后一 speaker 正式 final，
   并且当前处理帧没有新的speaker boundary，才视为Qwen活动buffer已清空。冻结音频使用
   同一 Qwen session、每个 boundary 唯一的高位sequence合并成一个内部PCM frame重放并
   立即flush；若一直没有安全点，则最迟在session flush后执行。这样避免把后一边界保留的
   新音频与replay拼接，也避免逐小帧VAD裁掉前缀。8021 的
   `MAX_ACTIVE_SESSIONS=1`不允许临时子会话；本方案
   不创建第二 session，不改模型服务，也不是新模型或独立证人。
4. 只有同时获得以下三方证据才修订：
   - 前一 speaker 已发 transcript；
   - 边界后重解码 witness；
   - 后一 speaker 的正式 final transcript。
5. 对前段 suffix 与 witness prefix 做受约束近似对齐；对 witness suffix 与后段 prefix
   做重叠对齐。两端都通过才原子地产生两个更高 revision：
   - 前段删除被声学 witness 证明属于后 speaker 的 suffix，timing end 回退到 boundary；
   - 后段以前述 witness 开头并与正式 final 去重，timing start 回退到 boundary。
6. 两个 revision 继续走现有原文/翻译/API revision 管线，旧译文被清空并重新翻译。

## 安全门

任一条件不满足就保持现有文本，不做猜测：

- commit outcome 必须为 miss，不能覆盖成功 commit；
- 前段、后段必须分别绑定 previous/next confirmed speaker 和 turn；
- 前段 timing 必须跨 boundary，越界范围限定为 80–1400ms；
- 声学witness固定只允许800ms pre-roll，证据起点不得早于boundary−840ms，总窗口不得超过2.6秒；
- 无 overlap、无 unknown、多 active speaker 时禁用；
- witness 音频必须覆盖 boundary 后至少 1800ms，最多 2400ms；
- correction 每条 boundary 最多运行一次，只能在后一正式 final 的 endpoint 内执行；
- 同一帧出现新speaker boundary时必须延后；不得覆盖该boundary commit保留的后续音频；
- replay sequence使用隔离高位命名空间且每个boundary唯一，不能与当前或未来客户端sequence冲突；
- Qwen请求不得并发；后一final在有界replay完成后发布，期间WebSocket仍可接收入队；必须测
  revision附加延迟及`droppedFrameCount=0`；
- 结束时尚未形成三方证据的候选直接关闭，不在flush后启动replay；
- 前段 suffix/witness prefix 最少 4 个有效字符，相似度至少 0.75；
- 可移动suffix最多12个有效字符；更长候选直接拒绝，不从前说话人扩张；
- witness/后段必须有至少 2 个精确连续字符重叠；
- 对齐区域出现拉丁字母、阿拉伯数字、中文数字、金额符号时，必须精确匹配，禁止模糊删除；
- 任一 revision 结果为空、文本增长异常或时间不连续时拒绝。

## 状态与可观测性

新增 session-scoped 诊断：

- `boundaryRevisionAttemptCount`
- `boundaryRevisionSuccessCount`
- `boundaryRevisionFailureCount`
- `boundaryReassignedCharacterCount`

不记录音频内容或私有文本到健康接口；正式证据仍由受控 session/history 保存。

## 回归门

1. 复现前段多出`我觉得咱这个这个`，同 Qwen witness 将其移动到后段；
2. commit hit 不启动重解码；
3. 不同 speaker/turn、overlap、unknown、时间 gap、无 witness、低相似度均不修订；
4. 数字和拉丁实体不允许模糊删改；
5. 同一 ASR session 以隔离sequence按序重放并flush，失败只尝试一次且必须清空replay buffer；
6. 故意延迟replay请求时，底层最大并发必须为1，后一final等待replay但新音频仍可入队；
7. 下一final与新boundary同帧时不replay；到后续普通final或session flush才执行；
8. 8021日志不得出现第二active session或HTTP 429，replay后未来客户端sequence仍可识别；
9. 两个 segment 使用原 ID 升 revision，API 和 iOS 清旧译文并重新翻译；
10. continuation 7500ms与中文一字去重测试保持不变；
11. 同一 AliMeeting 真机重跑：speaker run仍为 A→B→A，cross-speaker suffix=0，
   end/finalize/outbox通过。

## 边界

- 不修改 Qwen、Sortformer、Hy-MT2 模型或阈值；
- 不修改 8021 服务代码或重启模型；
- 不用 MOSS/LLM 决定 speaker；
- 不把 AliMeeting 研究音频放入发布资产；
- 继续使用隔离 3520/3521 candidate，并保留 3420 回滚。
