# LiveKit 平台化开发任务与实施计划

版本：v1.1
日期：2026-07-19
状态：计划内代码已推进至 P2 可观测性与 Provider HA 集成，动态验收暂缓

## 1. 计划口径

本计划是现有 `OPT-*` 产品任务的架构实施视图，不创建第二套相互竞争的真值。

- `OPT-*`：产品功能和现有验收状态。
- `ARC-*`：跨模块架构改造和 LiveKit 平台化任务。
- 一个 ARC 任务完成时必须回写关联 OPT 任务，不能单独宣称产品完成。
- 已经 accepted 的 OPT 能力不重写，只通过 adapter 接入。

用户线程 `019f2378-979b-7b40-b497-897752639718` 的研究顺序继续保留：LiveKit
SIP 是电话能力的首要产品目标；但它必须先通过最小权限、统一合同和单一副作用
控制三个短前置门禁。

### 1.1 2026-07-19 批次状态

| 范围 | 静态实现 | 执行证据 | 当前判定 |
| --- | --- | --- | --- |
| Compatibility Profile | Server/SIP/Egress/Ingress 版本与 digest 固定门禁、SDK 能力合同 | Server direct/TURN/reconnect 与 10 会话 admission 已有 staging 记录；本批未复跑 | Egress/Ingress 实际 digest、owned-device/SIP 验收待补 |
| Provider Adapter/Contract | Room、PSTN、SIP、Dispatch、Egress、Ingress 与统一 operation DTO | 本批按要求未跑测试 | `ready_for_acceptance` |
| Guest ticket/nonce/上限 | 原子消费、防重放、资源门禁 | 本批按要求未跑测试 | `ready_for_acceptance` |
| SIP outbound/对账 | Worker-ready、单拨号、签名 webhook、乱序对账、零计费失败 | 未连接 trunk | H2-H4 待验收 |
| Agent Dispatch | 显式 dispatch、ticket、预热、容量、drain、lease/recovery | 未连真实 Worker pool | H2-H3 待验收 |
| Egress | room/participant/track、artifact hash/manifest/retention、webhook/recovery | 未连对象存储/Egress | H2-H3 待验收 |
| PostgreSQL | 31 段 migration、primary UoW、command/reliable inbox、全部生产 Repository runtime adapter | 隔离 staging 已完成 migration/import/audit/rollback；本批未复跑 | 静态调用图 `0/0`；生产切流与跨主机 HA/PITR 待独立授权 |
| Agent Assist | 人在环建议、敏感降级、run/step/handoff 数据模型 | 未连真实 LLM/语音 | `ready_for_acceptance` |
| Autonomous Agent | 独立 runtime、AgentSession、披露、AMD/IVR、结构化结果、接管/恢复/结束闭环 | 未连接真实模型、SIP 或真机 | `ready_for_acceptance`；保持关闭 |
| Operator warm transfer | 私密 consult room、独立 SIP leg、move 对账、App 接受/拒绝/恢复 | 未连接 LiveKit/SIP/真机 | `ready_for_acceptance`；默认关闭 |
| Ingress | RTMP/WHIP/HTTPS URL、DNS/IP/redirect SSRF、SRT bridge、容量、webhook/recovery | 未连真实 Ingress | `ready_for_acceptance`；SRT 运行验收未完成 |
| HA/100 并发 | Patroni/etcd、WAL-G、拓扑/容量合同、混合流量/故障编排、OTel、home-region 路由、fencing、启动拒绝 | 缺第二数据库节点、3 个 DCS voter、off-host 对象存储和私有故障控制器 | 代码完成，真实 HA/PITR/25–100 并发待验收 |
| 媒体隔离 | human→Worker、TTS→目标 leg、早期媒体 gate、流式 TTS 直达 LiveKit sink | Server direct/TURN/reconnect 已有 staging 记录；owned-device 未校准 | `ready_for_acceptance` |

当前执行边界：按用户要求先完成代码，测试、构建、部署、真实 SIP、staging 和真机阈值
校准暂缓。既有 staging 记录只说明当时环境，不替代本批回归，也不得据此标记 accepted。

## 2. 工作流与依赖

```text
Foundation/Security
      |
Contracts + Provider Adapters
      |
Data Model + Operations
      |
Dispatch Runtime ----- SIP/PSTN
      |                   |
Translation Runtime   Agent Runtime
      |                   |
Egress / Records / Observability
      |
Ingress / HA / Multi-region
```

## 3. Platform P0：接入安全与兼容底座

### ARC-LK-001 兼容矩阵

交付：

- `LiveKitCompatibilityProfile` 合同。
- Server/SIP/Egress/Ingress 镜像 digest 与 SDK 版本清单。
- staging compatibility smoke。
- 上游 license/SBOM/SCA 记录。

验收：

- 不使用 `latest`。
- 当前 Flutter/Node/rtc-node 组合可建房、入房、发收音轨和重连。
- 升级任一组件时合同测试能发现能力变化。

### ARC-LK-002 Provider Adapter

交付：

- `MediaRoomProvider`
- `TelephonyProvider`
- `JobRuntimeProvider`
- `RecordingProvider`
- `ExternalMediaProvider`
- 统一 provider error/capability/operation DTO

约束：

- 领域层不 import SDK DTO。
- adapter 不直接写多个领域 Repository。
- 所有外部副作用有 operation ID 和 idempotency key。

### ARC-SEC-001 最小权限 Token

交付：

- 使用官方 `AccessToken`。
- host/guest 仅 microphone publish。
- 明确 `canPublishData=false`。
- 120–300 秒首次入房 token。

### ARC-SEC-002 Guest One-time Ticket

交付：

- 一次性 Guest ticket。
- 绑定 session、role、nonce、有效期和使用次数。
- 已结束、超人数、重放和过期拒绝。

### ARC-SEC-003 数据消息可信边界

交付：

- App/Web topic、sender identity/kind/source 校验。
- 关键控制事件迁移到 HTTPS/可靠事件。
- 伪造字幕、状态和 playback 红队测试。

### ARC-SEC-004 公共入口上限

交付：

- API/Gateway body、WebSocket max payload、帧速、连接和 session 上限。
- room token、join、PSTN、Agent start 限流。
- 内存/队列饱和测试。

### ARC-SEC-005 镜像和 Secret 固定

交付：

- Server/SIP/Egress/Ingress 镜像 digest。
- secret manager/只读 mount/0600。
- secret scan、SBOM 和轮换清单。
- 开发认证配置不能进入发布。

### ARC-CONTRACT-001 Communication Contract v1

交付：

- `packages/contracts/src/communication`
- ID、session/leg/turn/segment/playback/provider operation。
- command/event envelope。
- Node/Flutter/Python golden fixtures。

退出条件：

- Platform P0 全部通过后才允许真实 SIP 和 Dispatch 灰度。

## 4. Platform P1-A：LiveKit SIP 首批闭环

### ARC-SIP-001 LiveKit SIP Provider

关联：`OPT-PSTN-001`、`OPT-PSTN-002`

交付：

- outbound trunk 配置和只读 readiness。
- `createSipParticipant` adapter。
- DTMF、hangup、transfer capability。
- SIP participant attributes/status 映射。
- API 创建 session/room/legs。
- Worker ready gate。
- SIP participant 入房。
- source/target leg 翻译和独立 TTS。
- ringing/answered/ended/failed 状态。
- inbound trunk/dispatch rule。
- caller 到业务 session 的安全绑定。
- 早期媒体、voicemail/IVR 状态记录。

Feature flag：`LIVEKIT_SIP_PROVIDER`

当前进度：outbound、状态桥、App UI、webhook/reconciliation、初始和中途 DTMF、
hangup、transfer 已完成静态实现。inbound 采用默认关闭的专用 trunk、单活预约、PIN、
direct dispatch rule、可信 attributes 绑定和终态清理；共享 trunk 不允许启用。
真实 staging/INVITE/REFER/DTMF 尚未执行。P0 语言对当前限制为中英双向，不能把
架构支持语言误报为已验收产品能力。

禁止：

- 同一 session 同时调用旧 PSTN provider 和 LiveKit SIP。
- create participant 返回就标记 answered。

### ARC-SIP-002 网络和安全

交付：

- SBC/provider IP ACL。
- TLS/SRTP 策略。
- RTP 端口和单向音频诊断。
- 号码、国家、频控、并发和最大时长策略。

### ARC-SIP-003 Provider Reconciliation

交付：

- provider operation 和 webhook inbox。
- busy/no-answer/invalid/timeout 对账和退款。
- provider call duration 与业务 billable time 对账。
- 超时后查询，不盲目重复拨号。

退出条件：

- 真实号码完成拨号、接听、双向字幕/译音、结束、一次结算。
- 不支持 clear 的线路明确半双工。

## 5. Platform P1-B：Job Runtime

### ARC-JOB-001 显式 Dispatch Adapter

交付：

- create/list/delete dispatch。
- metadata schema 和大小门禁。
- dispatch operation 持久化。
- duplicate create/cancel 幂等。

Feature flag：`LIVEKIT_AGENT_DISPATCH`

### ARC-JOB-002 Translation Job Wrapper

关联：`OPT-DEP-002`、`OPT-CALL-003`

交付：

- `translation-runtime` 命名 job。
- 现有 Translation Worker 作为 room job 启动。
- snapshot ticket。
- ready/heartbeat/ending。
- 旧 `TRANSLATION_WORKER_CALL_ID` fallback。

### ARC-JOB-003 Prewarm、Load 与 Drain

交付：

- VAD/tokenizer/连接池 prewarm。
- 组合 load function。
- capacity threshold。
- SIGTERM drain 和 deadline。
- autoscaler 指标。

### ARC-JOB-004 崩溃恢复

交付：

- Worker SIGKILL detection。
- redispatch 或明确 session failure。
- 旧 playback 收敛为 interrupted。
- 不重复 TTS、不重复结算。

### ARC-JOB-005 容量准入

交付：

- Worker、ASR、MT、TTS、LLM、SIP reservation。
- 拨号/入房前 accept、queue、degrade 或 reject。
- reservation TTL 和释放。
- 过载时不接通后静默无字幕。

退出条件：

- API 不再以手工环境变量作为默认启动方式。
- 滚动升级不打断正常通话。

当前进度：显式 Dispatch adapter、Translation Worker Agent wrapper、预热、节点
限容、ready/heartbeat、drain、lease 和崩溃恢复已完成静态实现；真实 Agent Server、
滚动升级、SIGKILL 和多节点容量证据待 Beelink/staging。

## 6. Platform P1-C：生产数据模型

### ARC-DATA-001 Session、Participant 与 Leg

关联：`OPT-DATA-004`、`OPT-CALL-003`

交付：

- `sessionId` 唯一聚合。
- room、leg、provider binding、operation 映射。
- 兼容 DTO mapper。

### ARC-DATA-002 Turn、Transcript 与 Translation

交付：

- turn/transcript revision/translation。
- playback generation。

当前 SQLite 先补合同和 mapper；不把多实例生产建立在删除后整批重写上。

### ARC-DATA-003 Agent Task 与 Run 分离

交付：

- task authorization 与 run attempt 分离。
- agent step、tool execution 和 handoff。
- retry 不覆盖原 task 和结果。

### ARC-DATA-004 Provider Operations 与 Inbox/Outbox

交付：

- SIP/Dispatch/Egress/Ingress/tool operation 表。
- webhook inbox payload hash 冲突检测。
- timeout 后查询/对账。
- outbox lease/dead-letter。

### ARC-DATA-005 Shadow 校验

交付：

- 旧 snapshot 与新表聚合比对。
- count/hash 和字段级差异报告。
- shadow 只读，不执行第二套外部副作用。

### ARC-DATA-006 PostgreSQL Adapter

关联：`OPT-DATA-003`

交付：

- schema/migrations。
- Repository contract tests。
- expectedVersion CAS。
- `SKIP LOCKED` outbox。
- SQLite/JSON 导入和 count/hash 对账。
- fail-closed startup verify。

切换规则：

- shadow read 可以并行。
- 外部副作用只有单一控制器。
- 切换后只有单一写主。
- 不使用长期 dual write。

当前进度（2026-07-19）：规范化 schema、31 段 migration、PostgreSQL primary UoW、
command/reliable inbox、`SKIP LOCKED` outbox、aggregate fencing、Provider CAS、shadow
projection、离线 import、逐记录 count/hash 对账及签名 evidence 已实现。Session、CallLeg、
playback、Usage/Billing、Provider Operation、Dispatch、Recording/Egress、Ingress、Agent
Run/Step/Tool/Handoff/Consult、账号、支付、Voice、Terms 与 Diagnostics 均已通过统一 runtime
adapter 接入；内存/SQLite/JSON 兼容路径只保留在显式 adapter 边界。

Import 会把 legacy Usage map/hold/ledger 转成版本化记录，并为旧 Agent
Run/Step/Tool/Handoff 生成确定性 request hash/idempotency metadata；audit 同时核对所有
primary payload、normalized namespace count、31 段 schema 与 database identity，证据以
cutover ID + 独立 HMAC key 签名。静态调用图现为旧 Repository 导入 `0`、直接 Snapshot
导入 `0`，`postgresPrimaryCutoverAuthorization` 已在隔离 staging 验收后开启。运行时仍强制
完整 migration、数据库 identity、签名 evidence、关闭 shadow dual-write 以及生产
`verify-full` TLS；现有 SQLite staging 未自动切流，多节点和生产切换仍需独立发布授权。

第 23 段 migration 修正 aggregate lease 续租语义：同一未过期 instance owner 续租保持
fencing token，只有过期或跨 owner 接管才生成新 token；同 owner 并发写由 advisory
transaction lock 串行，避免并发请求互相把对方误判为 stale writer。统一调用层只能使用
稳定且至少 8 字符的 `PLATFORM_INSTANCE_ID`，不能按请求随机生成 owner。

Worker Dispatch/Capacity、Recording Consent/Job/Artifact 和 Ingress 已接入统一 runtime
调用面。Dispatch 在同一 session-fenced transaction 内锁定全局 resource pool，并原子写
reservation+dispatch；Ingress 使用独立容量锁串行化全局与单 Session 上限；Recording 只接受
已持久化的权威 consent，Job/Artifact 使用规范化唯一键、primary CAS、command inbox 和
outbox。过期 Worker reservation 不在持有其他 Session fence 时被跨聚合改写，只从实时容量
统计排除并由自身 fence 恢复清理。

第 31 段 migration 将 Agent 被叫录音同意合同、参与者 consent 证据和 Agent Task 录音策略
纳入规范化主表与 projection 回填；Agent/Egress runner 只能使用已持久化的权威同意记录，
不能以运行参数替代同意证据。

## 7. Platform P1-D：Egress 与通话记录

### ARC-EGR-001 Recording Policy

交付：

- consent snapshot。
- recording type/retention。
- 强制/可选录音策略。
- 敏感场景禁录。

### ARC-EGR-002 Egress Adapter

交付：

- participant/track/audio-only room composite。
- start/list/stop。
- webhook 验签。
- operation/idempotency。

### ARC-EGR-003 Artifact Pipeline

交付：

- object key、hash、size、duration、manifest。
- 独立音轨与 session/participant 绑定。
- 删除和 retention job。
- 录音、字幕、译文、摘要和导出关联。

退出条件：

- Egress 失败不影响通话。
- 未同意不启动。
- 对象和 manifest 对账一致。

当前进度：consent snapshot、audio-only room recording、start/list/stop、provider
operation、签名 webhook、artifact 和恢复轮询已完成静态实现；对象流式 SHA-256 校验、
加密 manifest 写入、定时 retention 删除及失败退避也已接入统一 Artifact Worker。
真实 Egress/对象存储的对象、manifest 与删除对账仍待 staging 验收。

## 8. Platform P1-E：Voice Agent

### ARC-AGENT-001 独立 Runtime

关联：`OPT-AGENT-001`

交付：

- `voice-agent-runtime` 命名 dispatch。
- AgentSession/工具/语音。
- 与 Translation Runtime 独立资源池。
- 统一 session snapshot/events。

### ARC-AGENT-002 Policy 与 Tool Registry

交付：

- L0-L3 风险和授权。
- 建议回复、实体卡片、Type-to-Speak。
- 用户点击后才说话。
- structured tool schema 和 Tool Gateway。

### ARC-AGENT-003 Disclosure Workflow

交付：

- 开场披露。
- 未完成披露不得进入任务对话。

### ARC-AGENT-004 User Takeover

交付：

- 停止 Agent 新工具和 TTS。
- clear playback。
- 用户 leg 生效，Agent 转 observer。

### ARC-AGENT-005 DTMF、IVR 与 AMD

交付：

- AMD/voicemail/IVR。
- DTMF 发送/接收。
- 预约/客服/查询首批场景。

### ARC-AGENT-006 Warm Transfer

交付：

- 成功、拒绝、无人接。
- 脱敏摘要和人工接受。
- 独立双人私密 consult room；原 caller 在接受前不能听到外部坐席。
- `sip_consult`、`sip_consult_move`、`sip_consult_end` 三类幂等 operation。
- move 超时按 operator 实际所在 room 对账，禁止盲目重复移动。
- App 断开主房间后加入私密咨询，接受后重新加入主房间并确认完成。
- 不以 SIP REFER 冷转接冒充 warm transfer。

### ARC-AGENT-007 Structured Result

交付：

- 结构化结果和证据。
- 未解决项和下一步。

Feature flags：

- `VOICE_AGENT_ENABLED`
- `VOICE_AGENT_AUTONOMOUS_ENABLED`
- `VOICE_AGENT_OPERATOR_CONSULT_ENABLED`

上线顺序：Assist -> 白名单 Autonomous -> 受限场景灰度。

当前进度：Assist 建议接口和 run/step/tool/handoff 持久化已实现，保证建议不会自动
说话或执行工具；新增独立 `voice-agent-runtime`、独立 dispatch/capacity、LiveKit
`AgentSession`、STT/LLM/TTS 模型合同、AMD/voicemail/IVR、固定披露、受控 DTMF、
结构化结果和幂等 SIP 挂断。人工接管使用 Server SDK 定向可靠控制加 heartbeat
兜底，Agent 先 interrupt/clear/关闭输入输出并上报 `takeover_ready`，App 再进入同一
room；支持人工接受、拒绝后恢复 Agent 和无人接受超时安全挂断。任务队列保留原子
claim/lease、唯一 worker、单次拨号和未知 provider 对账。真实模型、SIP、停声延迟、
IVR 和真机接管均未验证，Autonomous 仍默认关闭。外部运营坐席 consult leg 已完成
本地静态实现：独立私密房、operator SIP 身份、签名 webhook、可靠 inbox、幂等
move/end、未知结果恢复、脱敏投影和 App 接受/拒绝/三方确认流程；默认 flag 关闭，
尚未连接真实 LiveKit/SIP/trunk 或真机，不能标记 accepted、可部署或已完成外部转接。

## 9. Platform P1-F：Speech 与模型性能

| 任务 | 交付 | 关联 |
| --- | --- | --- |
| ARC-ASR-001 | streaming ASR session | OPT-RT-003/004 |
| ARC-ASR-002 | 两遍式 ASR shadow | OPT-LLM-001/002 |
| ARC-VAD-001 | translation/agent profiles | OPT-VAD-003 |
| ARC-VAD-002 | echo/backchannel/turn 分类 | OPT-CALL-006/007 |
| ARC-MT-001 | micro-batch/admission/fallback | OPT-TERM-001 |
| ARC-TTS-001 | 真流式 chunk/cancel | OPT-RT-005/CALL-005 |
| ARC-TTS-002 | voice prewarm/cache/8k route | OPT-VOICE-001/002 |
| ARC-MODEL-001 | 固定 Model Profile 和 fingerprint | OPT-OBS-001 |
| ARC-FALLBACK-001 | ASR/MT/TTS/LLM session-sticky fallback | OPT-OBS-001 |

所有模型任务先在隔离 harness A/B，再进入正式 integration flag。

当前进度：`ARC-ASR-001` 已使用每条 leg 的有界 ingest ring buffer 与持久 WebSocket
二进制 ASR session 解耦 RTC 收帧；`ARC-ASR-002` 已把首遍 ASR final、MT 和二遍 LLM
纠错解耦，首遍字幕不再等待纠错，实际变化的二遍结果复用同一 `speechId/revision` 并提升
`pipelineGeneration`，以既有 Abort/generation 门禁取消旧 MT/TTS。服务端在同 revision
的新 generation 到达时清除旧译文，避免新原文与旧译文短暂拼接。相关代码和回归用例
已补。`ARC-MT-001` 已增加模型服务共享的有界 execution admission；流式请求独占配额，
非流式请求按 `max_tokens` 兼容性在短窗口内组成 Hy-MT2 batch，队列、并发、等待时间和
batch size 均有硬上限，容量拒绝/超时/执行中/排队中/平均 batch size 已进入 Prometheus
合同和 dashboard。`ARC-FALLBACK-001` 已增加 ASR/MT/TTS 跨 Provider 会话粘性路由、全局 cooldown、
单 session half-open 恢复、非重试 4xx/外部取消保护、双 Provider 幂等 close，以及 MT/TTS 流式
`restart` 清空门禁；LLM Provider 故障后同一 call 固定使用本地规则。切换使用结构化
`worker.status`，并由 runtime diagnostics fingerprint 覆盖 fallback 参数。`ARC-VAD-002` 已把抢话限制为
目标参与者存在真实 active playback 时才判定，播放期提高 VAD 持续时间/概率门槛，短应答归为
backchannel，只有 sink clear 成功才取消旧 MT/TTS；端侧既有 TTS active/tail、输出路由、能量 gate 和
pre-roll 丢弃继续承担原生 echo start gate。本批按用户要求未执行测试，因此以上只进入
`ready_for_acceptance`，不是 accepted。

`ARC-TTS-001` 已把 VoxCPM2 `generate_streaming()` 接到模型服务 NDJSON 合同，Worker 使用
有界多订阅音频流把首个 PCM chunk 直接送入 LiveKit sink；不支持流式播放的 PSTN/HTTP sink
才在自身边界缓冲整段。sequence/sample-rate/generation/cancel 均失败关闭，主 Provider 已输出
音频后发生断流时不会从头播放 fallback，避免重复前缀。播放期间回声指纹按 lifecycle 保持，
结束后只保留 8 秒 tail；真实音质、chunk 边界、首包和取消仍需 staging/真机验收。

## 10. Platform P2：Ingress、HA 和规模化

### ARC-ING-001 Ingress Adapter

- RTMP/WHIP/URL/SRT。
- SSRF、stream key、source 和时长限制。
- external media leg。

当前进度：RTMP、WHIP、HTTPS URL、hostname allowlist、DNS 全地址公有性复核、
IPv4/IPv6 私网与保留网段阻断、逐跳 redirect 校验、固定解析地址 preflight、stream
key 一次返回、容量、provider operation、webhook 和恢复轮询已完成静态实现；URL
输入在 LiveKit pull 网络策略未声明时失败关闭。SRT 已新增独立
`services/srt-ingress-bridge`：随机 passphrase/streamid、固定 UDP 端口池、直接 spawn
FFmpeg、无 shell、RTMP 目标精确 allowlist、幂等查重、容量/最长时长、TERM/KILL
drain、独立镜像/profile、`external_bridge_id` projection 以及 bridge+LiveKit 双状态
恢复清理。LiveKit 原生 adapter 会先按确定性 participant 查询，避免不确定重试重复
创建 ingress。以上仅为本地静态实现；真实 H.264/AAC MPEG-TS、UDP 防火墙、断流、
镜像和负载验收未完成。

### ARC-HA-001 SFU、SIP 与 Worker Pools

- Redis cluster/HA。
- SFU node pool。
- drain 和 region-aware node selector。
- TURN pool。
- SIP、Worker、Egress、Ingress 独立扩容、health、metrics 和故障域。

### ARC-HA-002 PostgreSQL HA

- 主从/托管高可用。
- failover、连接恢复和一次结算。
- backup/restore/PITR。

### ARC-OBS-001 OTel

- session trace。
- SLO dashboard。
- provider/capacity/queue/circuit 告警。

### ARC-LOAD-001 容量

- 25/50/100 并发。
- 2 小时 soak。
- 网络和依赖故障注入。

当前进度：除两地域/独立池拓扑合同、多节点启动失效关闭、容量结果校验器、OTLP trace、
provider operation trace、home-region/cell 粘滞路由和 aggregate fencing 外，已经实现
PostgreSQL primary runtime、Patroni/etcd Provider、旧主 fencing/重建步骤、WAL-G off-host
base backup/WAL/restore Provider，以及覆盖 API、LiveKit、SIP、ASR、MT、TTS、Agent、Egress
的真实混合流量与故障注入编排器。上述是可部署的 Provider 集成，不等于真实跨主机 HA、
PITR、TURN/SFU 多节点、25/50/100 并发或 2 小时长稳已经通过；现有会话禁止跨区漂移，
故障转移只接新会话。真实验收仍缺第二数据库节点、3 个 DCS voter、off-host 对象存储、
私有故障控制器、Prometheus 凭证和 owned auto-answer 白名单号码。

P2-A1 已补充逐轮 MT 首 token 与 TTS 首音频实际到达 Worker 的时间点，并从持久化
`speechId/turnId/pipelineTiming` 生成 ASR、处理队列、turn buffer、MT、TTS、字幕端到端、
音频 ready 和 playback start 的 p50/p95 分布；本地阈值标记为 ASR final 1400ms、MT final
500ms、TTS first audio 600ms。流式 TTS 记录首 chunk 实际到达时间，整块 TTS 只能记录完整
响应可用时间。该结果是代码级质量门禁。

P2-A2 已完成代码级实现：Translation Worker 从 `@livekit/rtc-node` 的真实
`Room.getRtcStats()` 周期采集 RTT、jitter 和累计收包/丢包；每条音频 leg 在结束时上报
ring buffer 容量、received/dequeued/processed/failed、overflow/shutdown drop、sequence gap、
high-watermark 和 backpressure。单 runtime 最多保留 120 个 RTC 样本并显式记录被丢弃的
旧样本；API 校验计数不变量、限制 128 KiB 请求、以 `runtimeId` 幂等合并最多 16 个 runtime，
且允许 call ended 后的晚到诊断完成落库。质量报告跨节点重算 RTC p50/p95、最新累计包损率、
ingest 总量和模型 fingerprint 分布，并标记 sequence gap、backpressure、RTC 不可用和混合
模型版本。fingerprint 仅包含 Worker 实际生效的非敏感路由/管线参数，不包含密钥、endpoint、
文本、音频或 voice identity。

P2-A3 已完成代码级实现：ASR、MT、TTS 在服务启动后对实际生效的非敏感参数生成 canonical
JSON SHA-256 签名，并通过 health 和 bearer-protected Prometheus `/metrics` 暴露；签名排除密钥、
URL、模型路径、请求内容与 voice identity，ASR context 只包含内容哈希。API 将 P2-A2 的 bounded
诊断窗口转换为低基数 Prometheus gauges，重试上报按 `runtimeId` 替换而不重复累加，最多保留
4096 个 runtime。OTel Collector 配置覆盖 API/ASR/MT/TTS 四个 scrape job，经 memory limiter、
resource 和 batch processor 输出 OTLP/HTTP；Grafana dashboard 覆盖模型版本/签名、RTC 分位数、
包损、ingest drop/backpressure 和样本可用性。metrics token 未配置时所有新增端点 fail closed。

当前 staging 已启动 Collector/sink，并完成 direct、强制 TURN、full reconnect 及 10 会话 admission
smoke；API gauges 仍是各进程 bounded window 的重算值，不替代持久化质量报告，模型服务签名描述
启动参数而非模型权重 checksum。owned-device 样本、25/50/100 并发和长稳 soak 尚未完成，
RTT/jitter/loss、drop/backpressure 的正式阈值继续为空；不得用混合聚合窗口、单元测试或本地分位数
替代分场景真实负载验收。

## 11. 建议批次

### Batch 0：2–4 天

- ARC-LK-001/002
- ARC-SEC-001/002/003/004/005
- ARC-CONTRACT-001

结果：无功能切换，关闭接入风险。

### Batch 1：4–7 天

- ARC-SIP-001/002/003
- ARC-JOB-001
- provider operation 基础

结果：隔离环境完成 LiveKit SIP 出站翻译电话。

### Batch 2：5–8 天

- ARC-JOB-002/003/004/005
- ARC-DATA-001/004

结果：Translation Worker 自动 dispatch、限容和 drain。

### Batch 3：5–8 天

- ARC-EGR-001/002/003
- ARC-OBS-001 第一阶段

结果：录音/记录/导出闭环。

### Batch 4：7–12 天

- ARC-AGENT-001/002
- ARC-ASR/TTS/MT 性能任务

结果：Agent Assist 灰度。

### Batch 5：按真实 Provider 和基础设施排期

- Autonomous Agent
- PostgreSQL 切换
- Ingress/HA/100 并发

工期为开发估算，不是验收承诺；真实 SIP trunk、设备和基础设施等待时间单独记录。

## 12. 每个任务的完成定义

- 设计合同和迁移说明已审阅。
- 代码改动保持现有模块边界和 350 行门禁。
- 单元、合同、集成和错误路径通过。
- feature flag 默认安全。
- operation、trace、metrics 和脱敏日志完整。
- rollback 实际演练。
- 需要真机、真实 SIP、真实模型或真实数据库的任务有对应证据。
- 文档和 `PROGRESS_LOG.md` 更新。
- 关联 OPT/AC 状态同步，未执行不得标 accepted。

## 13. 当前开发状态

2026-07-19 静态开发收尾：

| 任务 | 状态 | 剩余门禁 |
| --- | --- | --- |
| ARC-LK-001 | ready_for_acceptance | 版本/digest 固定门禁、compatibility gate 和 direct/TURN/reconnect staging 记录已具备；Egress/Ingress 实际 digest、owned-device、真实 SIP 与本批回归待执行 |
| ARC-LK-002 | ready_for_acceptance | Room/PSTN/SIP/Dispatch/Egress/Ingress adapter 与统一 operation DTO 已实现；合同和 staging 未执行 |
| ARC-SEC-001 | ready_for_acceptance | staging/真机 token 和媒体复验 |
| ARC-SEC-002 | ready_for_acceptance | staging、多节点 SQLite/PostgreSQL 并发核销复验 |
| ARC-SEC-003 | ready_for_acceptance | staging App/Web 伪造消息复验 |
| ARC-SEC-004 | ready_for_acceptance | API/Gateway/队列上限与分布式限流代码完成；自动化和 staging 洪泛门禁未执行 |
| ARC-SEC-005 | ready_for_acceptance | 权限、secret scan、SBOM、轮换合同完成；Egress/Ingress 实际 digest/SBOM 待 staging |
| ARC-CONTRACT-001 | ready_for_acceptance | Node/Flutter/Python 共用 golden fixtures 已完成；三端测试未执行 |
| ARC-SIP-001..003 | ready_for_acceptance | outbound/inbound、单次拨号门禁、状态桥、签名 webhook、退款和 reconciliation 完成；真实 trunk/白名单号码待执行 |
| ARC-FALLBACK-001 | ready_for_acceptance | 跨 Provider、cooldown、恢复和流式 restart 代码完成；故障注入/staging 未执行 |
| ARC-VAD-001/002 | ready_for_acceptance | translation endpoint profiles、Agent turn profile、Worker backchannel/active-playback gate 与既有端侧 echo gate 已闭合；真机回声/抢话门禁未执行 |
| ARC-ASR-001/002 | ready_for_acceptance | 每 leg 有界 ingest、持久流、两遍纠错与 generation 取消完成；本批未回归，真实语料/漏句门禁待执行 |
| ARC-MT-001 | ready_for_acceptance | 稳定前缀、上下文/术语、admission、batch/stream 和 fallback 完成；真实中英混合、数字与术语门禁待执行 |
| ARC-TTS-001/002 | ready_for_acceptance | VoxCPM2 真流式生成、bounded broadcast、LiveKit 直出、prewarm/voice/8k route 完成；真实首包、音质、断流/取消待执行 |
| ARC-MODEL-001 | ready_for_acceptance | Worker 与 ASR/MT/TTS 实际启动参数 fingerprint、Prometheus/OTel/dashboard 完成；权重 checksum 与真实部署对账待执行 |
| ARC-DATA-001..006 | ready_for_acceptance | 31 段 migration、全部 runtime adapter、签名 audit 与静态 `0/0` 完成；生产切流和跨主机故障验收待执行 |
| ARC-JOB-001..005 | ready_for_acceptance | dispatch/prewarm/load/drain/lease/fence/recovery 完成；真实 Worker pool 故障验收待执行 |
| ARC-EGR-001..003 | ready_for_acceptance | 同意、operation、runner、artifact/manifest/retention/recovery 完成；真实 Egress 与对象存储待执行 |
| ARC-AGENT-001..007 | ready_for_acceptance | Assist、受控 autonomous runtime/tool gateway/接管/consult/录音合同完成，默认关闭；真实模型/SIP/真机待执行 |
| ARC-ING-001 | ready_for_acceptance | 原生 Ingress 与 SRT bridge、SSRF/capacity/recovery 完成；真实媒体、镜像和 UDP 网络待执行 |
| ARC-HA-001/002 | ready_for_acceptance | Patroni/etcd、WAL-G、拓扑、fencing、服务发现/旧主重建合同完成；缺外部节点/DCS/对象存储，不可标 accepted |
| ARC-OBS-001 | ready_for_acceptance | speech/turn/RTC/ingest/fingerprint、Prometheus/OTel/Collector/dashboard 完成；正式 RTC 阈值仍为 `calibration_required` |
| ARC-LOAD-001 | ready_for_acceptance | 真实混合流量、admission 和故障编排器完成；25/50/100、120 分钟 soak 与真实 Provider 证据待执行 |

`ready_for_acceptance` 不等于 accepted；没有部署和真实环境证据前不得结项。
