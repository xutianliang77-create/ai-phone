# ARC-FALLBACK-001 / ARC-VAD-002 静态开发证据

日期：2026-07-19
状态：`ready_for_acceptance`；按用户要求暂不执行测试，不是 accepted。

## 1. Provider fallback

- `StickyProviderFallbackController` 维护 per-call primary/fallback 粘性、全局 cooldown 和单新会话
  half-open probe；外部 AbortSignal 取消及 HTTP 400/401/403 等非重试错误不会打开 circuit。
- ASR、MT、TTS wrapper 在主路由失败时初始化备用 session；ASR close 同时收敛两侧，MT/TTS 使用可选
  create/close 生命周期。
- MT 主流已经产生 partial 后失败时发内部 `restart`，消费端先清空未完成文本和 first-token 时间再接
  fallback。TTS 仅在首个音频 chunk 之前允许 `restart`；首段已经播放后断流会终止当前 playback，并将
  后续请求粘到 fallback，不从头重播整句，避免重复语音前缀。
- LLM refinement Provider 故障后，同一 call 固定走 local rules；cooldown 后只允许一个新 call 探测恢复。
- degraded/restored 使用既有 `worker.status` 合同，包含 stage/provider/model；fallback identity、超时、
  streaming、cooldown 和门槛进入 runtime fingerprint，密钥与 endpoint 不进入 fingerprint。

## 2. Echo/backchannel

- Worker 仅在目标 speaker 存在 active playback 时累计抢话；没有活动播放时不再误取消当前翻译 generation。
- echo start gate 默认要求 `>=480ms` 且 VAD probability `>=0.72`；`<=360ms` 的播放期短应答记录为
  backchannel，不中断语音。
- 只有实际 playback 存在、sink 支持 clear 且全部 clear 成功后，才触发 pipeline cancel 并发布
  `barge_in.detected/confirmed`；unsupported/clear failure 保持失败关闭。
- iOS 既有 `CoreMlNemotronPlaybackEchoState`、FluidAudio/RMS energy gate、350ms tail、耳机/扬声器路由策略
  和 echo pre-roll 丢弃保持为原生门禁；本批未修改或构建生产 App。
- Worker 回声指纹在 playback active lifecycle 内持续有效，`ended` 后转为 8 秒 tail，
  `interrupted/failed` 立即撤销，避免流式长句后半段漏过，也避免固定长窗口屏蔽用户主动复述。

## 3. 真流式 TTS

- VoxCPM2 模型服务调用实际 `generate_streaming()`，逐 chunk 发 NDJSON metadata/audio/final；部署候选要求
  runtime 必须暴露 streaming API，缺失时 health 失败关闭。
- Worker 使用默认 8 chunk 的有界多订阅流，在所有 sink 订阅完成后才拉取 Provider；LiveKit sink 直接写入
  `AudioSource`，兼容 PSTN/HTTP sink 只在自身边界缓冲。
- sequence、sample rate、AbortSignal 和 generation 不一致都会终止并清除当前播放；HTTP timeout 覆盖响应头、
  NDJSON body 和最后一个 chunk，不允许已连接但停止发流的 Provider 永久占用队列。
- call end 先给已发布尾句的 MT 一个默认 1500ms 有界落库窗口，再取消 generation、TTS 和播放；超时后
  `runAbortable` 立即收敛，不等待无响应 Provider，也不会在 `worker-ended` 后继续发布字幕/TTS。

## 4. 配置与回滚

- 所有跨 Provider fallback 仅在备用 endpoint/base URL 显式配置后启用；默认保留单 Provider 行为。
- `PROVIDER_FALLBACK_*`、各阶段 `*_FALLBACK_*` 和 echo/backchannel 参数已进入三个 env example、
  独立 Worker 启动脚本及 Beelink 部署默认值。
- 回滚可清空对应备用 endpoint，或设置 `CALL_ECHO_START_GATE_ENABLED=false`；无需迁移数据模型。

## 5. 尚未执行的验收

- 未运行 unit、typecheck、lint、build、故障注入、staging Provider 切换或真机 echo/barge-in 测试。
- 必须验证：主 Provider 5xx/timeout、备用失败、401 不切换、外部 cancel、流中途失败、cooldown 并发
  half-open、call end 双侧 close、VoxCPM2 chunk 连续性/音质/首包/断流不重复、真实扬声器 echo、耳机绕过、
  短应答与真实长抢话。
- 任何动态证据完成前不得把两项任务标记 accepted。
