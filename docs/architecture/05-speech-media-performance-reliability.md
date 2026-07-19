# 语音、媒体、高性能与稳定性设计

版本：v1.0
日期：2026-07-17

## 1. 当前判断

现有 MarbleNet VAD、端点策略、playback generation、全双工降级和质量报告是
正确基础。主要性能缺口不在单个阈值，而在：

- Call Link Worker 缺少集群 job 调度和预热。
- ASR/MT/TTS 主要是短 HTTP 请求，不是长期流式 session。
- VoxCPM2 服务虽然模型可流式，但当前合同返回完整 PCM，首包不能真正边生成边播放。
- Hy-MT2 当前同步 `generate`，缺少并发排队、批处理和 GPU admission。
- Gateway WebSocket 和内部队列缺少完整资源上限。

## 2. VAD 与 Turn

### 2.1 翻译场景

翻译优先低延迟和连续输出：

- MarbleNet/Silero 负责 speech start/end。
- 模式化 silence endpoint。
- 最大段长强制 flush。
- speaker boundary 可以结束 turn，但不重置 VAD 音频证据。
- semantic EOT 只作为长停顿保护，不得无限等待。

### 2.2 Agent 场景

Agent 需要判断“用户是否真的说完”：

- VAD 负责快速开始和 barge-in。
- 音频/语义 turn detector 辅助 end-of-turn。
- `minDelay/maxDelay` 限制等待范围。
- backchannel 与真实打断分开。
- 模型不可用时回退 VAD-only。

不要把 Agent 的较长语义等待直接套到实时翻译。

### 2.3 回声与噪声

- App/Web 启用平台 AEC/NS。
- Worker 维护 TTS playback active/tail。
- VAD 在 echo 窗口应用能量和相关性 gate。
- 耳机路由不启用扬声器 echo gate。
- TTS 回声不得进入 pre-roll。
- PSTN 不依赖客户端 AEC，使用独立 leg 路由和播放方向隔离。

## 3. ASR 优化

### 3.1 统一流式合同

```text
createSession(config)
writeAudio(frame)
updateContext(hotwords, language)
events(partial/final/vad/error)
flush(reason)
cancel()
close()
```

HTTP batch 适配器保留为 fallback；LiveKit/通话主链路目标使用 WebSocket、gRPC
或进程内长连接，避免每帧请求开销。

### 3.2 两遍式策略

- 一遍：低延迟 streaming ASR 产生 partial 和候选 final。
- 二遍：只对低置信度、长句、数字/型号/领域词或会后记录运行高准确 ASR。
- UI 先显示一遍结果；二遍通过 revision 更新，但保留 raw。
- 二遍不得阻塞实时译音播放。

### 3.3 语言与术语

- 语言识别按 turn，不按 session 永久锁死。
- 中英混合保留同一 turn，英文品牌/型号不触发错误反向翻译。
- hotwords、corrections 和 domain pack 在 session 首帧冻结版本。
- LLM 纠错只处理受控候选，不补写 ASR 没有证据的内容。

### 3.4 Provider fallback

- Provider 失败后在 session 内切到 fallback，并进入 cooldown；既有会话不切回主路由。
- cooldown 结束后只允许一个新 session 作为 half-open recovery probe，其余新 session 继续走
  fallback，不在每帧来回切换。
- 切换通过结构化 `worker.status` 上报 degraded/restored、stage、provider、model；实际参数
  fingerprint 继续进入同一 call runtime diagnostics。
- flush 和 close 对 primary/fallback 都必须幂等。

## 4. TTS 优化

### 4.1 真流式合同

当前完整 PCM 响应升级为：

```text
tts.start
tts.audio.chunk(sequence, pcm16, sampleRate)
tts.end
tts.cancelled
tts.error
```

Worker 收到第一个 chunk 即发布 LiveKit 音轨，不等待整句完成。

当前实现已经使用 VoxCPM2 `generate_streaming()` 逐 chunk 生成 NDJSON 事件；Worker 通过
默认上限 8 chunk 的有界多订阅流同时驱动目标 sink，LiveKit sink 直接消费，只有不支持
`playStream` 的兼容 sink 才在自身边界缓冲整段。sequence、sample rate、AbortSignal 和
generation 不一致会终止当前流；首段音频已经播放后若 Provider 断流，不从 fallback 重播
整句，避免用户再次听到相同前缀。

### 4.2 播放策略

- 每个 target leg 独立队列。
- generation 单调增加。
- 新 playback 可 supersede 未开始旧 playback。
- barge-in 调用 clear，迟到 chunk 按 generation 丢弃。
- 字幕先于音频发布。
- sink 不支持 clear 时自动半双工。
- 回声指纹在 playback active lifecycle 内保持，`ended` 后只保留 8 秒 tail；
  `interrupted/failed` 立即撤销，避免固定超长窗口屏蔽用户主动复述。

### 4.3 性能

- VoxCPM2 模型常驻，不按 call 加载。
- 个人声音预先计算并缓存 voice representation。
- 常用披露、欢迎语和错误提示可缓存音频。
- GPU 设并发令牌，超额排队或切 fallback。
- PSTN 输出单独做 8k 电话带宽响度、限幅和可懂度处理。

## 5. 翻译与 LLM

- MT Provider 支持有界 micro-batch。
- 单句超时后走第二 Provider，不等待无限重试。
- partial 翻译只发布稳定 prefix，final 才进入历史和计费证据。
- LLM Agent 与 MT 使用不同队列和 GPU 配额，Agent 峰值不得拖慢翻译主线。
- 会后摘要、重点和复盘走低优先级异步队列。

## 6. Worker 与模型容量

LiveKit Agents 的 CPU load 只是参考。我们的准入必须同时考虑：

- active jobs。
- ASR stream 数。
- MT queue depth 和 GPU utilization。
- TTS active generations 和 VRAM。
- LLM token/s 和 KV cache。
- event loop lag、RSS 和网络丢包。

每个 worker 上报：

```json
{
  "available": true,
  "activeJobs": 6,
  "cpu": 0.42,
  "rssMb": 820,
  "gpuMemoryRatio": 0.71,
  "asrStreams": 12,
  "translationQueue": 3,
  "ttsQueue": 2
}
```

准入失败必须在拨号/入房前返回容量不足，不能接通后才无字幕。

## 7. 队列和背压

| 队列 | 上限策略 |
| --- | --- |
| Gateway audio | 目标 <800ms，硬上限 2400ms，丢旧帧并告警 |
| ASR session | 每 leg 独立有界 ring buffer |
| Translation | final 优先，partial 可合并/丢弃 |
| TTS | 每 target leg 一个 active + 少量 pending |
| Agent tools | 每 run 串行敏感工具，读工具可有界并行 |
| Outbox | 指数退避、死信、可恢复 |

## 8. 高可用

- LiveKit 多节点通过 Redis 路由，一个 room 固定在一个 SFU node。
- SFU、SIP、Worker、模型和数据库分开故障域。
- Agent Server drain 后不接新 job。
- job 进程崩溃不影响其他 session。
- Worker 重派后不自动重播旧 TTS，旧 playback 收敛为 interrupted。
- PostgreSQL 主从/托管高可用；Redis 不承载不可恢复账本。
- Egress、摘要和导出失败不影响通话主链路。

## 9. SLO

| 指标 | 内测目标 | 商用目标 |
| --- | ---: | ---: |
| 首个 ASR partial P95 | <= 900ms | <= 700ms |
| 说完到 final P95 | <= 1400ms | <= 1000ms |
| 翻译 P95 | <= 500ms | <= 350ms |
| TTS first audio P95 | <= 600ms | <= 300ms |
| barge-in stop P95 | <= 350ms | <= 250ms |
| Call Link 入房 P95 | <= 5s | <= 3s |
| Worker 意外退出检测/恢复 | <= 20s | <= 15s |
| 30 分钟会话成功率 | >= 99% | >= 99.9% |
| 重复结算 | 0 | 0 |

## 10. 观测

每个 session 建立统一 trace：

```text
media.receive
 -> vad.turn
 -> asr.final
 -> translation.complete
 -> tts.first_chunk
 -> playback.started
 -> playback.ended
```

核心指标：

- stage latency P50/P95/P99。
- queue wait、drop、cancel 和 timeout。
- provider fallback 和恢复。
- VAD false start、endpoint reason、empty final。
- ASR revision、翻译覆盖率和术语命中。
- TTS first chunk、clear latency、stale chunk drop。
- Agent tool success、确认、接管和错误动作。
- SFU packet loss、jitter、RTT、TURN ratio。
- SIP answer rate、one-way audio、DTMF 和 disconnect reason。

## 11. 容量测试矩阵

1. 1/10/25/50/100 并发 session 阶梯压测。
2. 30 分钟和 2 小时 soak。
3. 中英交替、快语速、噪声、双向同时讲话。
4. ASR/MT/TTS/LLM 单个 Provider 注入 5xx、超时和断流。
5. Worker SIGKILL、SFU drain、Redis 重启、数据库 failover。
6. SIP 无人接、忙线、早期媒体、单向音频、transfer。
7. 余额耗尽、重复 webhook、重复 End、迟到事件。
8. 录音/摘要/Egress 故障不影响实时通话。

## 12. 官方参考

- https://docs.livekit.io/agents/logic/turns/
- https://docs.livekit.io/agents/logic/turns/turn-detector/
- https://docs.livekit.io/agents/logic/turns/tuning/
- https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/
- https://docs.livekit.io/deploy/custom/deployments/
