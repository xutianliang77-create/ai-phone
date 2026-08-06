# ai phone 两层部署与数据流设计

版本：v1.5
日期：2026-07-13
状态：已确认约束，进入实施

## 1. 架构约束

部署后只存在两个运行节点：

1. 手机端：Flutter App。
2. 服务器端：API、Realtime Gateway、Worker、LiveKit、模型服务和数据存储。

Mac 只用于代码开发、构建和运维，不运行测试或生产链路中的 API、Gateway、LLM、ASR、翻译或 TTS。测试阶段将 Beelink 定义为服务器，不再把它作为独立的第三层模型节点。

## 2. 目标拓扑

```mermaid
flowchart LR
    Phone["iOS / Android App"] -->|HTTPS| Proxy["Server Reverse Proxy"]
    Phone -->|WSS| Proxy
    Phone -->|WebRTC| LiveKit["Server LiveKit"]

    Proxy --> API["API Server"]
    Proxy --> Gateway["Realtime Gateway"]
    Gateway --> ASR["ASR Service<br/>MarbleNet VAD + Qwen3-ASR"]
    Gateway --> Speaker["Streaming Speaker Provider"]
    Gateway --> MT["Hy-MT2"]
    Gateway --> TTS["VoxCPM2 / TTS"]
    Gateway --> LLM["Qwen3.5 LLM"]
    Gateway --> API
    LiveKit --> Worker["Translation Worker"]
    Worker --> ASR
    Worker --> MT
    Worker --> TTS
    Worker --> API

    API --> SQLite["SQLite WAL"]
    API --> Objects["Server Object Directory"]
```

手机只配置一个服务器基地址。API 创建 realtime session 时返回 WSS 和 LiveKit 参数，App 不直接配置 ASR、翻译、TTS、LLM 或 Worker 地址。

## 3. 服务器内部部署

无界 AI 作为一个发布单元、一个应用容器（`wujie-ai`）管理。下面是容器内的逻辑
进程/组件，不得按这些功能拆成应用容器；LiveKit、数据库和模型服务属于外部基础设施：

```text
wujie-ai application container
  api-server
  realtime-gateway
  translation-worker
  optional voice-agent / Air780 gateway / SRT bridge

external infrastructure
  reverse-proxy / LiveKit / PostgreSQL(or SQLite data volume)
  ASR / translation / TTS / speaker / LLM services
```

`MarbleNet VAD` 是 `asr-service` 内部 Speech Frontend，不增加第三个部署节点或公开端口。ONNX、Mel 预处理资产和 Qwen3-ASR 随同一个服务器发布单元管理。

部署规则：

- 外部只开放 HTTPS/WSS 和 LiveKit 所需端口。
- 模型服务和内部 API 只监听 loopback、容器网络或服务器私网。
- 所有组件读取同一份 `server.env` 和同一份模型路由文件。
- 内部调用使用服务名或 `127.0.0.1`，不得使用 Mac IP。
- 手机配置不得包含 `localhost`、Mac 局域网 IP、模型端口或内部密钥。
- Tailscale 只用于开发运维和内测访问，不作为正式产品拓扑的一层。
- Speaker Provider 与 ASR 并行，是可降级旁路；故障不得中断字幕和翻译。
- App 只提交 speaker 策略，不持有说话人模型地址、密钥或内部端口。
- 在线 VAD 由 ASR Service 权威执行；App 静音门控必须偏保守，不能因本地 RMS 较低丢弃待上传语音。
- `/health` 必须返回实际 `vadProvider` 和 `vadThreshold`；发生 `rms_fallback` 时进入诊断告警但不终止会话。

## 4. 暂时数据存储方案

当前无法配置 PostgreSQL/Redis，因此近期采用 SQLite WAL，不继续扩展 JSON Store。

### 4.1 SQLite 所有权

- 只有 API Server 可以直接读写 SQLite。
- Gateway、Worker、PSTN Bridge 和 Agent Worker 通过内部 API 写事件。
- SQLite 文件固定放在服务器持久化目录，例如 `/var/lib/ai-phone/data/ai-phone.db`。
- 启用 WAL、foreign keys、busy timeout 和事务。
- 每个写入命令必须带幂等键。

### 4.2 数据分类

| 数据 | 当前存储 | 权威方 | 说明 |
| --- | --- | --- | --- |
| 账号、授权、权益 | SQLite | API Server | 必须事务写入 |
| session、segment、review | SQLite | API Server | segment 保留 raw/optimized/translated |
| usage、ledger、退款 | SQLite | API Server | append-only ledger，禁止覆盖余额历史 |
| 术语和行业选择 | SQLite | API Server | 保存版本和用户归属 |
| 实时短期状态 | Gateway 内存 + API session 状态 | Gateway/API | 单服务器阶段不引入 Redis |
| 参考声音和导出文件 | 服务器对象目录 | API Server | SQLite 只保存路径、hash 和归属 |
| App 设置 | 手机本地 | App | 不作为计费和历史真源 |
| 登录 token | Keychain/Keystore | App | 不写普通明文文件 |

### 4.3 最小表

```text
accounts
auth_sessions
consents
translation_sessions
call_legs
session_segments
session_reviews
tts_playbacks
terms
voice_profiles
usage_ledger
idempotency_keys
inbox_events
outbox_events
```

`translation_sessions` 是普通同传、Call Link、PSTN 和 Agent 的唯一会话聚合；Call Link 的 `callId` 等于 `sessionId`。`call_legs` 保存 host/guest/callee/agent 的媒体身份和 provider 映射，禁止另建只存在内存的 Call Link 真值。

`usage_ledger`、`inbox_events` 和 `outbox_events` 使用只追加设计。session 结束、用量结算和 outbox 事件必须在同一事务提交。`tts_playbacks` 按 `target_leg_id + generation` 保证同一目标腿只有一个 active playback，取消后旧 generation 的迟到帧不得恢复播放。

### 4.4 备份和损坏处理

- 每日使用 SQLite backup API 生成一致性快照，不能直接复制正在写入的主文件。
- 每次发布前执行 `PRAGMA quick_check`。
- 保留最近 7 个每日快照和 4 个每周快照。
- 数据库损坏时服务进入 not_ready，不允许静默创建空库覆盖原数据。
- 对象目录和 SQLite 快照使用同一备份批次编号。

### 4.5 后续迁移

Repository 接口不能暴露 SQLite 特有 SQL。未来迁移 PostgreSQL 时：

1. 冻结写入或开启双写窗口。
2. 导出 SQLite 快照。
3. 导入 PostgreSQL 并校验数量、余额和 hash。
4. 切换 Repository adapter。
5. Redis 只在多实例 Gateway 或高可用需求出现后引入。

## 5. 核心数据流

### 5.1 创建和运行 realtime session

```text
App -> API: POST /realtime/sessions
API -> SQLite: 创建 session、usage hold、幂等键
API -> App: sessionId、一次性 realtime token、WSS endpoint
App -> Gateway: WSS 连接和 audio.frame
Gateway -> ASR: 音频窗口/flush
ASR Speech Frontend: 16kHz normalize -> MarbleNet VAD -> endpoint/最大分段
ASR -> Gateway: partial/final、language、confidence
Gateway -> Speaker Provider: 同时间轴音频帧
Speaker Provider -> Gateway: anonymous speaker spans
Gateway SpeechTurnCoordinator: participant/VAD/speaker span -> confirmed boundaryMs
Gateway -> ASR Turn Buffer: commitBoundary(boundaryMs, fromSpeaker, toSpeaker)
ASR Turn Buffer: 切分 PCM，speaker turn 内运行 Qwen3-ASR
Gateway -> Translation/TTS: 带 speaker 的 final 文本
Gateway -> App: transcript、translation、speaker.updated、audio.output
Gateway -> API internal: segment.final 事件
API -> SQLite: segment 幂等落库
```

当前内部协议为 `POST /asr/sessions/:sessionId/boundary`。请求只包含 `boundaryMs`、语言方向和会话热词；speaker 身份由 Gateway 写入返回 transcript，不进入 ASR 模型提示词。

### 5.2 结束和异常断开

```text
App/Gateway -> API: end(sessionId, idempotencyKey)
API transaction:
  flush 后的最后 segments
  session ended
  usage ledger entry
  release unused hold
  outbox review_requested
API -> App: ended、consumedSeconds、remainingSeconds
```

WebSocket close、App 被杀和网络中断使用相同 end/finalize 事务，不能形成另一套结算路径。

### 5.3 会后 review

```text
Review Worker -> API: claim review event
API -> SQLite: 读取 raw/optimized/translated segments
Review Worker -> LLM: 结构化 review 请求
Review Worker -> API: review result + evidence segment ids
API -> SQLite: 保存 review 和 provider fingerprint
App -> API: 查询历史详情
```

### 5.4 Call Link/PSTN 全双工与抢话

```text
App/Web/PSTN source leg -> LiveKit/Bridge -> Worker source-leg queue
Worker -> AEC(exact playback reference sent to this capture leg) -> MarbleNet VAD -> ASR
Worker -> conservative correction -> ordered translation
Worker transaction command -> API: playback.queued(playbackId, targetLegId, generation)
Worker -> TTS stream -> target-leg playback sink
target leg 新语音 -> InterruptionController
InterruptionController -> cancel TTS + clear sink + playback.interrupted
pre-roll -> 原 source-leg ASR，继续产生新 turn
```

约束：

- source leg 的 ASR/翻译队列与 target leg 的播放队列分离；不同方向可以并行。
- LiveKit participant track 是 Call Link 的身份真值；不对独立轨道叠加 diarization。
- PCM、AEC reference、pre-roll 和逐帧 VAD 仅驻留 Worker 环形缓冲，不写 SQLite 或日志。
- playback 状态、取消原因、generation、segment 关联和延迟指标写 SQLite；重复事件由 inbox 幂等键拒绝。
- API/Worker 重启后，未确认完成的 playback 收敛为 interrupted，禁止自动重播；session、segment、usage 和历史从 SQLite 恢复。
- PSTN Provider 未声明 `clearPlayback` 时，服务器不得开启全双工抢话，只能使用半双工或纯字幕降级。
- 全双工开关由服务器发布环境统一控制并进入 Call Room token；手机和 Web 不持有模型地址或独立开关真值。
- MarbleNet 帧级结论通过 ASR 内部 HTTP 响应头送回 Worker，不新增公开 VAD 服务或第三层部署。
- App/Web 的 WebRTC AEC 是采集侧第一道回声控制；Worker 的 MarbleNet 连续语音门禁、target-leg generation fence 和近期播放取消是服务器侧第二道控制。

## 6. 手机端边界

- 端侧模式可在无服务器时完成 ASR/翻译基础流程。
- 在线模式只连接统一服务器地址。
- App 不负责最终余额、结算和云端历史真值。
- 网络失败时本地只保存待同步命令和幂等键，不伪造服务端成功状态。
- App 启动不得同步加载模型、网络、账号和历史；首帧先展示 UI，再异步恢复状态。

## 7. 发布和测试门禁

- Release/Profile App 中不得包含 Mac 地址、`localhost` 或模型服务端口。
- 客户端切换统一服务器前，目标 `/health` 必须可用，且 account、session、usage ledger、terms、voice profile 的迁移数量和 hash 必须校验通过。
- 迁移验收前不得提前将 App 的 `API_BASE_URL` 指向空服务器，否则客户端会表现为登录、余额和历史“被清空”。
- 服务器健康页必须证明 API、Gateway、模型和 SQLite 都在同一服务器发布单元。
- 停止 Mac 上全部服务后，手机在线同传仍应正常。
- 停止服务器后，手机必须明确显示在线不可用，端侧模式仍可进入。
- 单服务器重启后，已结束历史和 ledger 不丢失；进行中的 session 可安全 finalize 或标记 interrupted。
- API 重启后既有 Call Link 仍可查询和加入；不得因进程内 Map 丢失。
- Worker 重启后旧 playback 不重播，迟到音频帧不跨 generation 播放。
- 50 个并发 session 的 segment、settle、inbox/outbox 写入按 session 隔离；同一 session 使用事务和版本检查，不同 session 可并行。
