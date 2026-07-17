# 高性能、稳定性与容量设计

版本：v1.0
日期：2026-07-17
状态：生产目标与验收基线

## 1. 目标

实时翻译的正确性不只取决于模型。系统必须在并发、抖动、模型降级、Worker
重启和电话异常下保持：

- 不串 session。
- 不重复拨号、播放或结算。
- 不无限积压音频。
- 不用错误成功状态掩盖降级。
- 优先保留字幕，其次半双工，最后明确失败。

## 2. 端到端延迟预算

目标预算按“用户说完到对方听到首个译音”拆分：

| 阶段 | 内测 P95 | 商用目标 P95 |
| --- | ---: | ---: |
| 网络/采集送达 | 120ms | 80ms |
| VAD/endpoint | 900ms | 700ms |
| ASR final | 1000ms | 700ms |
| MT | 500ms | 350ms |
| TTS first chunk | 600ms | 300ms |
| LiveKit/SIP 播放启动 | 250ms | 150ms |

阶段预算不可简单相加为用户体验结论，因为 streaming prefix 可并行。必须同时记录：

- 首 partial。
- 稳定 prefix。
- final。
- 首译文。
- 首音频。
- 完整音频。
- barge-in stop。

现有完整 PCM 路径继续使用当前验收门槛；只有真流式链路完成后才启用更严格的
first-chunk 目标，避免用设计目标伪报当前能力。

## 3. Session 执行模型

每个 session 使用逻辑 actor/串行 mailbox 处理状态命令：

```text
session commands -> bounded mailbox -> state machine -> outbox
media frames     -> per-leg bounded buffer -> speech pipeline
```

约束：

- 业务状态命令同 session 串行，不同 session 并行。
- 音频帧不进入数据库事务。
- 模型调用不占用 session 状态锁。
- playback、provider callback 通过 event + expectedVersion 合并。
- mailbox 超限时拒绝非关键命令，不无限增长。

## 4. Worker 池

拆分：

| Pool | 工作负载 | 扩容指标 |
| --- | --- | --- |
| Translation Runtime | track、VAD、ASR session、MT、TTS routing | active jobs、ASR streams、event loop lag |
| Voice Agent Runtime | LLM、tools、Agent TTS | active runs、token/s、tool wait |
| SIP Service | SIP/RTP bridge | concurrent calls、RTP packet rate |
| Egress | 录制/转码 | active egress、CPU、disk/network |
| Ingress | 转码/外部媒体 | active ingress、CPU、GStreamer queue |
| Model Pools | ASR/MT/TTS/LLM/Speaker | queue、GPU、VRAM、batch |

媒体 SFU、SIP、Egress/Ingress 和 GPU 模型不得部署在同一故障/资源池作为生产默认。

## 5. Dispatch、预热与 drain

采用显式 dispatch：

- API 在 session 创建后按 mode 选择 `translation-runtime` 或
  `voice-agent-runtime`。
- metadata 小于明确上限，只传 snapshot ticket。
- Worker 使用 prewarm 加载 VAD、连接池和轻量 tokenizer。
- 大模型由独立 Model Pool 常驻，不在每个 job 子进程重复加载。
- load function 同时考虑 CPU、内存、job、模型队列和 event loop lag。
- 超过 load threshold 时停止接新 job。
- autoscaler 在更低阈值扩容，避免达到拒绝阈值后才启动实例。
- SIGTERM 先从 dispatch 摘除，再等待活动 session，超过 deadline 执行明确迁移或
  降级。

## 6. 容量准入

创建 Room 或拨号前计算 `CapacityDecision`：

```json
{
  "accepted": true,
  "profile": "translation-standard",
  "expiresAt": "ISO-8601",
  "reservations": {
    "translationJob": 1,
    "asrStreams": 2,
    "ttsStreams": 2,
    "gpuTokens": 1
  }
}
```

准入至少检查：

- Worker 可用槽位。
- ASR 并发 stream。
- MT/TTS/LLM queue wait 预测。
- GPU VRAM 和 utilization。
- SIP/trunk 并发和号码策略。
- 余额/hold。
- Egress 仅在强制录音场景计入。

reservation 有短 TTL；拨号失败、session 结束或 dispatch 失败必须释放。超载时：

1. 降低非关键能力：二遍 ASR、摘要、Agent assist。
2. 降级 TTS 为字幕。
3. 明确排队或拒绝。
4. 不允许接通后静默无翻译。

## 7. 有界队列与背压

| 队列 | 软上限 | 硬上限 | 超限策略 |
| --- | ---: | ---: | --- |
| Client/Gateway audio | 800ms | 2400ms | 丢最旧未处理帧并标记 gap |
| Per-leg ASR ring | 2s | 5s | 强制 flush/降级 |
| Stable partial MT | 2 项 | 8 项 | 合并旧 partial |
| Final MT | 8 项 | 32 项 | admission fail，不能丢 final |
| Per-leg TTS | 1 active | 3 pending | supersede 未开始旧项 |
| Agent tool | 1 sensitive | 4 read-only | 拒绝/排队 |
| Outbox | 告警阈值 | 磁盘/行数阈值 | 停非关键写、死信 |

任何 drop 都生成脱敏计数和时间范围；不能只在日志写一句 warning。

## 8. 模型服务

### 8.1 ASR

- 主链使用长期 streaming session。
- 每 leg 独立状态和 ring buffer。
- partial 可丢，final 不可丢。
- Provider timeout 先 flush/fallback，不重放已确认 audio range。
- 二遍 ASR 使用低优先级队列，不阻塞实时翻译。

### 8.2 MT

- 只对短窗口使用 micro-batch，设置最大等待时间。
- final 优先于 partial、会后摘要。
- 数字、型号、姓名和术语在调用前后有结构化保护。
- Provider fallback 在 session 内粘滞，避免每句抖动切换。

### 8.3 TTS

- 真流式 chunk，首 chunk 到达即发布。
- 每个 target leg 独立 generation。
- cancel 后旧 chunk 在 provider、worker 和 sink 三层拒绝。
- 常用披露语可缓存，但缓存 key 包含语言、声音、文本规范化版本和模型 fingerprint。
- 电话输出独立 8kHz/mulaw 路线，不能把高保真听感结果直接当电话验收。

### 8.4 LLM/Agent

- 与 MT 使用独立资源池和优先级。
- structured output 校验失败不执行工具。
- tool timeout 不占用实时音频线程。
- 会后 summary 使用异步低优先级队列。

## 9. 故障域和降级

| 故障 | 产品行为 |
| --- | --- |
| Translation Worker 崩溃 | 尝试重派；字幕显示恢复中；旧 TTS 不重播 |
| ASR 不可用 | 切端侧/备用 ASR；否则明确无法识别 |
| MT 不可用 | 保留原文字幕，停止译音 |
| TTS 不可用 | 继续双语字幕 |
| LLM 不可用 | 翻译不受影响；Agent assist 隐藏或人工接管 |
| Redis 重启 | 重建租约/presence，不改变账本 |
| PostgreSQL failover | 暂停新副作用，恢复后按 inbox/outbox 对账 |
| Egress/Ingress 失败 | 不影响已有实时通话；单独重试/结束 |
| SIP early media/忙线 | 更新 leg，不创建已接听计费 |
| clear 不支持 | 自动半双工 |

## 10. Retry、timeout 和 circuit breaker

不同类型不能共用统一重试：

| 操作 | 重试策略 |
| --- | --- |
| 查询/health | 短指数退避，可重试 |
| Dispatch create | 固定 idempotency key，查询后重试 |
| SIP 拨号 | 超时先对账，禁止盲目第二次拨号 |
| Egress/Ingress create | provider operation + 查询/list 对账 |
| ASR/MT/TTS frame/chunk | 由 session 合同决定，不通用 HTTP retry |
| Tool write | 业务 idempotency key，失败状态可审计 |

Circuit breaker 按 `provider + capability + model profile` 隔离。恢复使用后台 probe，
不能让每个 session 作为探针。

## 11. LiveKit 与网络

- 分布式 LiveKit 使用 Redis 共享 room data 和消息总线。
- 一个 room 仍固定在一个 SFU node，容量规划必须按单 room 峰值。
- 节点下线先 drain，不能直接杀有活动 room 的实例。
- 多地域使用信令入口的地域/延迟路由和 region-aware node selector。
- TURN ratio、RTT、jitter、packet loss 和 reconnect 必须进入 session 质量报告。
- SIP 服务需要独立公网 IP、SBC/ACL 和 RTP 端口容量。

## 12. 数据库性能

- Session 列表只查询摘要列，不 join 全量 transcript。
- Transcript/translation 按 session 分页。
- 热写使用行级增量，不删除后整批重建。
- Outbox claim 使用有界 batch、lease 和 `SKIP LOCKED`。
- 恢复扫描按 status/updated_at 索引和 batch cursor。
- provider payload 和 trace 大对象不进核心索引。
- 慢查询、锁等待、deadlock、连接池饱和进入告警。

## 13. 可观测性

统一 trace：

```text
session.create
 -> capacity.reserve
 -> room.create
 -> job.dispatch
 -> worker.ready
 -> sip.create_participant
 -> media.receive
 -> vad.endpoint
 -> asr.final
 -> mt.complete
 -> tts.first_chunk
 -> playback.started
 -> playback.ended
 -> session.finalize
```

每个 span 包含 `sessionId`、leg/turn/segment/playback/operation ID 和 model
fingerprint，不包含手机号、正文、token 或音频。

关键 SLI：

- 建房、dispatch、Worker ready、SIP answer。
- ASR/MT/TTS stage latency P50/P95/P99。
- queue wait、drop、cancel、timeout。
- fallback、circuit open、恢复。
- barge-in stop、echo false trigger。
- 30 分钟/2 小时 session success。
- outbox lag、重复 webhook、重复结算。

## 14. 测试规模

### 开发门禁

- 单 session 合同和故障注入。
- 10 并发 smoke。

### 内测门禁

- 25 并发 30 分钟。
- 50 并发 10 分钟峰值。
- Worker/SIP/模型单点故障。

### 商用门禁

- 100 并发阶梯压测。
- 2 小时 soak。
- 真实通话业务分布回放。
- PostgreSQL/Redis/SFU/Worker 滚动升级和 failover。
- 容量达到 70% 时仍满足 SLO，达到 85% 时正确拒绝/降级。

Beelink 只承担功能、模型和小规模灰度证据，不承担 100 并发生产容量结论。

## 15. 性能回归纪律

- 模型、VAD、ASR/TTS 参数测试继续使用隔离 harness。
- 固定语料、固定音频、固定模型 fingerprint。
- 每次优化同时报告质量、延迟、CPU/GPU、内存、耗电和错误率。
- 不因单条真机听感好就替换全局路由。
- 不用放宽验收阈值掩盖性能回退。
- 新 LiveKit/SDK/模型版本只改一个变量并保留回滚 profile。
