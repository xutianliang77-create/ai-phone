# LiveKit 平台化验收计划

版本：v1.0
日期：2026-07-17
状态：验收基线

## 0. 当前暂停状态与 Beelink 恢复门禁

2026-07-17 Beelink 不在线。按用户明确要求，当前服务器端 build、typecheck、test、
配置渲染、部署、服务启动和真实 SIP 呼叫均为“未执行”，不能用静态代码或旧日志
替代。本节是开机后的强制恢复顺序：

1. 实时探测 Tailscale/SSH、CPU/内存/磁盘、容器运行时、架构和当前服务；不得假定
   旧别名、旧容器或旧端口仍有效。
2. 轮换本地已渲染文件中出现过的 LiveKit/API 凭据，确认文件权限和日志脱敏。
3. 重新拉取 Server/SIP 镜像 manifest，核对 linux/amd64、tag 和 digest；候选 digest
   不经 staging 不进入 release profile。
4. 在仓库脏改动完整保留的前提下执行 diff/行数、API/Worker 定向测试、根 build、
   typecheck、lint 和兼容矩阵检查。
5. 渲染到全新隔离 staging，不复用生产 room、trunk、Redis、数据库或号码策略。
6. 先用 mock/无呼叫验证 provider operation、签名 webhook、重放、乱序、失败退款；
   再启用 trunk 白名单中的测试号码。
7. 媒体隔离通过后，才把
   `LIVEKIT_SIP_MEDIA_ROUTING_MODE=translated_tracks_only`；此前拨号 readiness 必须
   保持失败。

媒体隔离的硬标准：

- App/Web/SIP 任一 human endpoint 接收到对方原始麦克风音频为 0 帧。
- Translation Worker 可订阅 human 原始音轨；其他 human 不可订阅。
- 每条 Worker TTS track 在目标 subscription allowlist 成功前输出 0 帧。
- 目标 leg 只收到自己的译音 track；相反方向或其他 leg 的译音为 0 帧。
- `sip.callStatus=dialing` 期间送入 ASR 的 SIP 帧为 0；API 持久化
  `active/automation` 的时间必须早于第一帧 ASR。
- webhook 重复、乱序、超时和 `participant_connection_aborted` 不重复拨号、不重复
  结算；未接听计费为 0。

## 1. 适用范围

本计划补充 `docs/ai-phone-optimization-acceptance-plan.md`，不替换其中已经通过或
待执行的产品验收。

- 现有 AC 任务继续证明无界AI当前功能。
- 本计划证明 LiveKit SIP、Dispatch、Egress、Ingress、生产数据架构和规模化能力。
- 同一个能力若同时有 OPT/ARC 门禁，必须两者都通过。

## 2. 证据等级

| 等级 | 环境 | 可证明 |
| --- | --- | --- |
| H0 | 单元/静态/contract fixture | 纯逻辑和 schema |
| H1 | 本地 mock/单进程 | adapter 和错误路径 |
| H2 | 隔离 LiveKit + mock provider/model | 跨服务协议 |
| H3 | 固定版本 staging + 真实 Redis/PostgreSQL | 生产形态集成 |
| H4 | 真机 + 真实 SIP trunk/号码/模型 | 用户和电话体验 |
| H5 | 灰度流量和长稳 | 商用稳定性 |

真实 SIP、录音、数据库迁移、模型质量和真机能力不能以 H0/H1 结项。

## 3. 证据包

```text
acceptance/<release>/
  build-info.json
  git-status.txt
  livekit-compatibility-profile.json
  image-digests.json
  dependency-scan/
  contract-results/
  integration-results/
  data-reconcile/
  load-results/
  chaos-results/
  device-matrix.json
  sip-call-matrix.json
  provider-fingerprints.json
  traces/
  redacted-logs/
  recordings-manifest/
  known-issues.md
  acceptance-summary.md
```

`acceptance-summary.md` 只能使用：通过、条件通过、失败、未执行。未执行不计通过。

## 4. Gate 0：版本、构建和许可

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-ARC-LK-001 | 检查镜像和依赖 | 无 `latest`，全部固定版本/digest |
| AC-ARC-LK-002 | Compatibility Profile | Server/SIP/Egress/Ingress/SDK 组合完整 |
| AC-ARC-LK-003 | SCA/SBOM | 无未接受的 critical/high |
| AC-ARC-LK-004 | License | 上游及复制的最小补丁许可记录完整 |
| AC-ARC-LK-005 | Source/dist | 现有 build gate 通过，无脏产物发布 |

升级任一 LiveKit 组件后必须重跑 Gate 0–3。

## 5. Gate 1：安全

### Token 与 Room

- host/guest token 不能 publish data、video、screen。
- 只能加入绑定 room。
- 过期、重放、篡改、错误 audience/issuer 被拒绝。
- Guest ticket 一次使用、过期、超人数、已结束 session 被拒绝。
- RemoveParticipant 后 API 不再签发新 token。

当前 H1：一次使用、过期、跨 call、轮换、三路并发核销和已结束链接签发均有
自动化；H2/H3 的多实例共享存储竞争、真实 LiveKit participant 上限和主动房间
清理仍待执行。

### Data 消息

- 恶意 Guest 发布字幕、pipeline 状态、playback 事件无效。
- 错误 topic、sender、participant kind、track source 被丢弃并计数。
- 关键控制事件不能只依赖可伪造 data channel。

### SIP

- 未在 allowlist 的信令来源被拒绝。
- trunk credential 不出现在日志、错误、trace 和证据包。
- 国际/高资费/紧急/禁拨号码策略通过。
- INVITE/DTMF/REFER/transfer 洪泛限流，不导致进程 OOM。

### Ingress/Egress

- URL input 阻断 loopback、私网、metadata IP、非法协议和重定向绕过。
- stream key、对象凭据和签名 URL 脱敏。
- 未同意录音不能启动 Egress。

### Agent

- prompt injection 不能绕过工具权限。
- L2 必须二次确认，L3 必须人工接管/拒绝。
- LLM 输出不能伪造 tool success。

Gate 1 任一失败，禁止真实电话和 Agent 灰度。

## 6. Gate 2：合同与数据

### 合同

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-ARC-CONTRACT-001 | Node/Flutter/Python golden fixtures | 编解码一致 |
| AC-ARC-CONTRACT-002 | 新旧 event version | 新增可选字段兼容，破坏性版本被拒绝 |
| AC-ARC-CONTRACT-003 | SDK DTO 隔离 | 领域包不依赖 LiveKit SDK type |
| AC-ARC-CONTRACT-004 | metadata 上限 | 超限在 API 前置拒绝 |

### ID 与状态

- `callId=sessionId` 兼容期保持。
- Room 重建只增加 room attempt。
- participant 可重连并创建新 leg，不创建重复业务 participant。
- SIP create、ringing、answered、hangup 不越级。
- playback generation、route epoch 只增不减。
- Agent retry 不覆盖原 task/authorization。

### 幂等与事务

- 重复 dispatch、拨号、Egress/Ingress create、webhook、End、settle 无重复副作用。
- 相同 event ID 不同 payload hash 被拒绝并报警。
- session 终态、hold、ledger 和 outbox 同事务。
- provider timeout 后查询/对账，不产生不可区分的第二通电话。

### PostgreSQL

- migration、重复 migration、受保护 rollback。
- expectedVersion 冲突明确。
- 50 个 session 并发不串写。
- outbox 多 Worker claim 不重复。
- connection loss/deadlock 可重试且不重复结算。
- SQLite/JSON 导入逐表 count/hash/关系一致。
- 切换失败可回滚旧 read/write 主。

## 7. Gate 3：功能集成

### Dispatch/Worker

| 场景 | 通过标准 |
| --- | --- |
| 显式 dispatch | 正确 agent name、room、metadata |
| Worker ready | ready 前不进入可翻译 active |
| 重复 dispatch | 只有一个活动 job |
| cancel | 不再接收新媒体，不残留 reservation |
| drain | 不接新 job，活动 session 正常完成 |
| SIGKILL | 20 秒内重派或明确失败，不重播旧 TTS |

### SIP 出站

覆盖：

- 正常接听。
- 无人接。
- 忙线。
- 无效号码。
- 早期媒体。
- voicemail。
- IVR/DTMF。
- 对方挂断、App 挂断、网络中断。

通过标准：

- 状态、leg、provider operation、账本一致。
- 正常接听后双向字幕和译音可用。
- 无接听不产生已接通计费。
- 结束后无媒体、Worker、hold 和 TTS 残留。

### SIP 入站与 Transfer

- dispatch rule 到正确业务策略。
- caller identity 只作为外部 binding。
- warm transfer 成功、拒绝、无人接均有明确状态。
- 原 caller 不因 transfer 失败被静默丢失。
- 私密咨询阶段 consult room 最多两人，原 caller 收不到 operator 音轨。
- 接受前主房间 host 必须退出；接受后只移动 operator，不挂断原 caller。
- App 重新加入主房间并确认 host/operator 都在线后才完成 handoff 和停止 Agent。
- 拒绝只清理 operator leg；无人接和拨号失败恢复原人工接管房间。
- `participant_left(consult)` 与 `participant_joined(main)` 任意顺序、webhook 重放和
  move timeout 都不得重复拨号、重复移动或误结算原 session。
- raw operator phone 不得出现在 consult API、webhook inbox、日志或 PostgreSQL 投影。
- `VOICE_AGENT_OPERATOR_CONSULT_ENABLED` 默认关闭；测试 trunk 仅允许白名单号码。

### Egress

- participant/track/audio-only 三类按策略启动。
- participant mute/unpublish/leave 生命周期正确。
- webhook 重复和乱序无重复 artifact。
- object hash、size、duration 和 manifest 一致。
- Egress 失败不影响实时 session。
- 删除/retention 幂等。

### Ingress

- RTMP/WHIP/URL 输入进入目标 room。
- SRT 必须经独立 bridge，以 SRT caller + 加密 passphrase/streamid 输入 H.264/AAC
  MPEG-TS；禁止将 `srt://` 交给 LiveKit `URL_INPUT`。
- 断开后 leg attempt 结束；复用 key 产生新 attempt。
- 错误 source、超时、超长、转码失败明确。
- Ingress 不占用 Translation Worker 的错误 participant role。
- 重复 create 不产生第二个 LiveKit ingress/FFmpeg 进程；bridge 丢失时清理孤儿
  LiveKit ingress，connection secret 不进入日志、projection 或普通查询响应。

### Voice Agent

- Assist 不会自动说话或执行工具。
- Autonomous 开场披露完成后才进入任务。
- human/voicemail/IVR 分类分支正确。
- takeover 后 Agent TTS 停止、用户 leg 生效。
- structured result 有证据和未解决项。

## 8. Gate 4：语音质量和延迟

继续使用现有固定语料和真机门禁，并增加：

| 指标 | 内测 | 商用目标 |
| --- | ---: | ---: |
| Worker ready P95 | <= 3s | <= 1.5s |
| Dispatch create P95 | <= 500ms | <= 250ms |
| SIP create 到 ringing P95 | 由 trunk 基线 + 20% | 由供应商 SLA |
| ASR 首 partial P95 | <= 900ms | <= 700ms |
| 说完到 final P95 | <= 1400ms | <= 1000ms |
| MT P95 | <= 500ms | <= 350ms |
| Streaming TTS first chunk P95 | <= 600ms | <= 300ms |
| Barge-in stop P95 | <= 300ms | <= 220ms |
| Call Link 入房 P95 | <= 5s | <= 3s |

说明：

- 未完成 streaming TTS 的旧完整 PCM 路径继续按现有 AC 门槛评价。
- 电话 8kHz 必须独立做人耳、回录 ASR 和数字/地址可懂度验收。
- App、Web、PSTN 各自记录首包，不用服务器日志代替用户侧时间。

语料：

- 中文/英文长短句。
- 中英夹杂。
- 数字、金额、日期、时间、号码、地址。
- 品牌、型号、字母串。
- 六类行业术语。
- 快速轮换、重叠、噪声、外放 TTS 和真实抢话。

## 9. Gate 5：容量

### 负载阶梯

1. 1 session 基线。
2. 10 session smoke。
3. 25 session 30 分钟。
4. 50 session 10 分钟峰值。
5. 100 session 30 分钟。
6. 目标容量 70% 下 2 小时 soak。

记录：

- active jobs、ASR streams、MT/TTS/LLM queues。
- CPU、RSS、event loop lag。
- GPU utilization、VRAM、batch。
- SFU tracks/packet rate/RTT/loss。
- SIP concurrent calls/RTP。
- PostgreSQL pool/locks/slow query。
- Redis latency。

通过标准：

- 70% 目标容量满足 SLO。
- 85% 容量正确拒绝/降级，不 OOM、不无限排队。
- final、账本、outbox 零丢失。
- partial 可有受控合并/drop，并有指标。
- 单 session 失败不污染其他 session。

## 10. Gate 6：故障与恢复

注入：

- Translation/Agent Worker SIGKILL。
- Model Provider 5xx、timeout、断流、rate limit。
- LiveKit node drain。
- SIP service restart。
- Egress/Ingress crash。
- Redis restart。
- PostgreSQL failover/短断。
- Object storage 5xx。
- 网络 100ms、3% 丢包、断网恢复。
- GPU OOM/队列饱和。

通过标准：

- 符合 `09-performance-reliability-capacity.md` 降级表。
- 无重复拨号、工具、播放、settle。
- 旧 generation 音频 0 帧。
- 恢复后 trace 能定位断点。
- 不可恢复时用户收到明确状态和下一步。

## 11. Gate 7：真机和真实电话

设备：

- 主测 iPhone。
- 小屏或 200% 字体。
- Android 中端真机在对应里程碑执行。
- Safari/Chrome Web Guest。
- 扬声器、有线/蓝牙耳机。

电话：

- 至少两个 trunk/线路环境之一作为主线，另一条可做 fallback 候选。
- 蜂窝、固话/VoIP、IVR、voicemail。
- 8kHz 电话音频。
- 100 次 TTS 中抢话只在 provider 明确支持 clear 时执行全双工验收。

灰度前最低真实呼叫样本：

- 30 次成功接听。
- 每类失败状态至少 5 次。
- 10 次 IVR/DTMF。
- 10 次 takeover/transfer。
- 5 次网络中断恢复。
- 30 分钟连续通话。

商业发布前扩大到 100 次成功接听和两周灰度 SLO。

## 12. Gate 8：发布和回滚

发布前：

- 所有 feature flag 有 owner、默认值、灰度范围、自动回退和删除日期。
- staging 与 production 使用独立 LiveKit、trunk、Redis、数据库和 secret。
- 监控、告警、值班、投诉、删除和退款流程就绪。
- rollback 已实际演练。

自动回退条件示例：

- Worker ready P95 连续 10 分钟超门槛。
- final 翻译覆盖率低于 99%。
- 重复 provider operation > 0。
- 重复结算 > 0。
- TTS echo/误抢话超过门槛。
- PostgreSQL error/lock wait 超门槛。

回退：

- SIP -> 旧 provider 或隐藏电话入口。
- Dispatch runtime -> 旧 Supervisor。
- full duplex -> half duplex/captions only。
- streaming TTS -> 完整 PCM/字幕。
- Agent -> Assist/人工。
- PostgreSQL -> 已演练的旧单一写主。

## 13. 最终判定

“融合 LiveKit 完成”必须同时满足：

1. LiveKit 只承担约定的媒体/电话/调度/录制/接入职责。
2. 一个 session 贯穿 Room、SIP、Worker、Agent、历史和账本。
3. 所有外部副作用可幂等、可对账、可追踪。
4. Translation 与 Agent 独立限容、独立降级。
5. 数据迁移无双主、可回滚。
6. 安全、真实电话、真机、容量、长稳和故障证据齐全。

## 14. 当前自动化证据

2026-07-17 Platform P0 第一批：

- contracts：6 个测试文件、20 项通过。
- API：67 个测试文件、256 项通过。
- compatibility/self-host：2 个测试文件、6 项通过。
- Flutter 可信消息/音轨/TTS gate 定向 14 项通过，`flutter analyze` 通过。
- 全 workspace TypeScript typecheck 和 350 行门禁通过。
- `git diff --check` 通过。

未执行：staging LiveKit、Beelink 部署、真机入房、恶意 Guest 实发 data、镜像
digest 拉取和 SIP。上述项目仍按未验收处理。

## 15. 2026-07-17 后续静态批次证据边界

本批继续完成 Dispatch、Egress、PostgreSQL shadow projection、Agent Assist、Ingress
以及 HA/容量失效关闭代码，但按用户要求没有执行任何服务器端 build、typecheck、
test、配置渲染、服务启动、部署或真实电话。唯一执行的机械检查为源码读取、文件
行数和 `git diff --check`，不能替代 H0-H5 验收。

Beelink 开机后必须按第 0 节顺序执行，并额外增加：

1. PostgreSQL 23 段 migration 重复执行、shadow backlog/replay、离线 import、逐记录
   count/hash/evidence、normalized count、database identity、签名 cutover ID、
   `SKIP LOCKED` claim、CAS/fencing、断连和故障恢复；
2. Egress/Ingress 镜像 tag、digest、amd64 manifest 和独立 pool smoke；
3. Agent Dispatch prewarm、容量、drain、SIGKILL 恢复和零重复 TTS；
4. Assist prompt injection/敏感降级/人工点击门禁；Autonomous 仍保持关闭；
5. `infra/platform-ha/topology.json` 通过 release check 后，再执行 25/50/100 阶梯、
   70% 负载 120 分钟 soak、85% 有界拒绝和故障注入；
6. 将真实证据写入忽略目录，并通过 `check:platform-capacity` 绑定 topology SHA-256。

在 PostgreSQL 主 Repository 和真实 failover 未实现前，
`PLATFORM_MULTI_NODE_ENABLED=true` 必须拒绝 API 启动。静态拓扑文件和校验脚本不能
作为多节点 HA 已完成的证据。

单次 cutover 的源码前置门禁还要求
`npm run check:postgres-primary-cutover -- --release` 返回 ready：旧 Repository import
与直接 Snapshot import 必须同时为 0，不能通过仅设置环境变量绕过 compile-time
authorization。当前静态审计仍为 81/25，故保持发布阻塞。
