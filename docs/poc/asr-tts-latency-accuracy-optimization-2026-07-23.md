# ASR/TTS 准确率与首结果延迟优化记录（2026-07-23）

## 结论

- 当前 Qwen3-ASR 真实复测为连续三轮 `26/27`，不是 2026-07-12 总账中的旧 `23/27`；唯一稳定失败为
  `mixed_001` 的英文前缀漏识别。
- `conversation/call_link` 端点静音从 `900ms` 降到 `600ms` 后，连续三轮仍为 `26/27`，没有新增准确率
  回退。代码与部署默认已改为 `600/1400/600/1100ms`，但尚未部署到生产服务。
- 当前 Qwen3-ASR 服务只在端点后返回 final，没有原生 partial/token 流。本轮降低的是
  `speech_end -> first final subtitle` 的固定端点等待，不把它表述为“原生 ASR 首 token”。
- VoxCPM2 的历史真流式首音为 `21–39ms`，但数字、字母、地址重复可靠性仅 `3/12`。本轮没有足够显存安全
  启动真实 TTS，因此没有新的 VoxCPM2 准确率或首音结论。
- TTS 延迟门禁已改为读取 `/tts/stream`，以客户端收到首个非空 PCM chunk 的墙钟时间执行门禁；模型自报
  `firstAudioMs` 单独记录，不能再掩盖 HTTP/代理缓冲。

## 实时环境与回滚点

- 主机：`beelink@100.110.127.117`，RTX 5090 32,607 MiB，驱动 `595.71.05`。
- 启动前 `8002/8003/8021` 均未监听；相关 systemd user units 为 `inactive/disabled`。
- ASR 原 unit checksum：`9992ae298fe42380fd9615f6561c4d758a6b99f640543abfaf154f13cbe5a420`。
- ASR 原 env checksum：`9f05c9115f332fbbd3f3a331a45f632be70f2aee768d668b2b76a6a73db741be`。
- 所有 ASR A/B 都使用临时 unit/env；结束后原 ASR unit 和所有临时 unit 均恢复 `inactive`，原 checksum 不变。
- 无关 Qwen3.5-9B vLLM 占用约 21.8 GiB；主机总显存占用约 26.8 GiB。历史 VoxCPM2 service 峰值约
  11.0 GiB，因此未擅自停止无关负载，也未冒险启动 TTS。

## ASR 三轮 A/B

固定集为 iPhone 14 P0 语料 27 条；同一 Qwen3-ASR-0.6B original tuned v3、MarbleNet VAD、RTX 5090。
表中延迟是现有 HTTP 批次脚本的服务处理墙钟，仅用于同协议 A/B；真实语音还应加端点窗口并另做实时 pacing。

| 配置 | 三轮准确率 | p50（ms） | p95（ms） | max（ms） |
|---|---|---:|---:|---:|
| 900ms baseline r1 | 26/27 | 377 | 695 | 1003 |
| 900ms baseline r2 | 26/27 | 423 | 810 | 814 |
| 900ms baseline r3 | 26/27 | 383 | 778 | 827 |
| 600ms candidate r1 | 26/27 | 367 | 746 | 948 |
| 600ms candidate r2 | 26/27 | 357 | 688 | 751 |
| 600ms candidate r3 | 26/27 | 354 | 718 | 749 |

端点窗口本身从 900ms 降至 600ms，正常句末固定等待减少 300ms。600ms 候选尚未覆盖自然停顿语料、真机
实时 pacing、长会话和生产负载，不能据此宣称已生产验收。

## 准确率边界

- `mixed_001` 三轮均把 `What's your name？你叫什么名字？` 识别为 `你叫什么名字？`。
- 当前仓库已有的窄混读重试在隔离最新源码上启用后仍为三轮 `26/27`；强制 English 路由也只输出中文。
  因为第二次推理没有恢复英文证据，该开关继续默认关闭，未使用字符串拼接伪造准确率。
- 其余 26 条连续三轮通过，包括中文、英文、长句、快语速、噪声、电话带宽、多说话人与专名。

## TTS 门禁验证

- 新门禁继续保留 `/tts/synthesize` 的整句 `wallMs/firstAudioMs`，并新增：
  `streamWallMs`、`streamModelFirstAudioMs`、`streamFirstAudioMs`。
- `--first-audio-p95-max-ms` 现在约束 `streamFirstAudioMs`，即客户端实际收到首个可播放 PCM chunk。
- 本地 mock HTTP/NDJSON 全链验证：整句 p95 `8ms`，模型自报 stream 首音 p95 `1ms`，客户端首块 p95
  `31ms`，门禁通过。该结果只证明测量合同正确，不代表 VoxCPM2 性能。

## 证据位置

- Beelink 隔离实验：
  `/data/models/translation-model-eval/data/unified-multilingual-eval/experiments/asr-service-endpoint600-mixedretry-20260723`
- ASR 900ms 三轮：
  `data/model-eval/asr-model-sweep/qwen3_asr_0_6b_20260723_raw_baseline*`
- ASR 600ms 三轮：
  `data/model-eval/asr-model-sweep/qwen3_asr_0_6b_20260723_endpoint600_r*`
- 隔离最新源码混读复测：
  `data/model-eval/asr-model-sweep/qwen3_asr_0_6b_20260723_current_endpoint600_mixedretry_r*`

## 下一门槛

1. 显存可用或用户明确协调无关负载后，启动隔离 VoxCPM2，使用固定默认 voice preset 对数字、字母、金额、
   地址做至少 `12 cases x 3 repeats` 回读，并同时记录客户端首 PCM p50/p95。
2. 对 ASR 600ms 候选补真实 pacing 的 `speech_end -> first final`、600–900ms 自然停顿语料和真机长会话；
   通过前不部署 8021。
3. 若仍要原生 ASR partial/首 token，需要独立设计增量解码或流式模型 A/B；这超出本轮端点参数优化，不能用
   final 响应冒充 partial。
