# LiveKit 平台化开发任务与实施计划

版本：v1.0
日期：2026-07-17
状态：本地静态实现已推进至 Ingress/HA 门禁，服务器验证暂停

## 1. 计划口径

本计划是现有 `OPT-*` 产品任务的架构实施视图，不创建第二套相互竞争的真值。

- `OPT-*`：产品功能和现有验收状态。
- `ARC-*`：跨模块架构改造和 LiveKit 平台化任务。
- 一个 ARC 任务完成时必须回写关联 OPT 任务，不能单独宣称产品完成。
- 已经 accepted 的 OPT 能力不重写，只通过 adapter 接入。

用户线程 `019f2378-979b-7b40-b497-897752639718` 的研究顺序继续保留：LiveKit
SIP 是电话能力的首要产品目标；但它必须先通过最小权限、统一合同和单一副作用
控制三个短前置门禁。

### 1.1 2026-07-17 批次状态

| 范围 | 静态实现 | 执行证据 | 当前判定 |
| --- | --- | --- | --- |
| Compatibility Profile | Server/SIP 候选版本和 digest；Egress/Ingress 延后实时探测 | 未跑 staging | 发布阻塞 |
| Provider Adapter/Contract | Room、PSTN、SIP、Dispatch、Egress、Ingress 与统一 operation DTO | 当前批未跑测试 | 静态待验证 |
| Guest ticket/nonce/上限 | 原子消费、防重放、资源门禁 | 当前批未跑测试 | 静态待验证 |
| SIP outbound/对账 | Worker-ready、单拨号、签名 webhook、乱序对账、零计费失败 | 未连接 trunk | H2-H4 待验收 |
| Agent Dispatch | 显式 dispatch、ticket、预热、容量、drain、lease/recovery | 未连真实 Worker pool | H2-H3 待验收 |
| Egress | room/participant/track、artifact hash/manifest/retention、webhook/recovery | 未连对象存储/Egress | H2-H3 待验收 |
| PostgreSQL | 23 段 migration、command/reliable inbox、异步 Session/Provider/Usage/Dispatch/Recording/Ingress/Agent/Consult UoW | 未连接 PostgreSQL | 主写聚合静态待验证；统一调用面尚未切换 |
| Agent Assist | 人在环建议、敏感降级、run/step/handoff 数据模型 | 未连 LLM/语音 | 静态待验证 |
| Autonomous Agent | 独立 runtime、AgentSession、披露、AMD/IVR、结构化结果、接管/恢复/结束闭环 | 未连接模型、SIP 或真机 | 静态待验证；保持关闭 |
| Operator warm transfer | 私密 consult room、独立 SIP leg、move 对账、App 接受/拒绝/恢复 | 未连接 LiveKit/SIP/真机 | 静态待验证；默认关闭 |
| Ingress | RTMP/WHIP/HTTPS URL、DNS/IP/redirect SSRF、SRT bridge、容量、webhook/recovery | 未连 Ingress | 静态待验证；SRT 运行验收未完成 |
| HA/100 并发 | 拓扑/容量合同、OTel、home-region 路由、fencing、启动拒绝 | 未做多节点/负载/故障注入 | 运行态未完成 |
| 媒体隔离 | human→Worker、TTS→目标 leg、早期媒体 gate | 未做真媒体 smoke | 发布阻塞 |

暂停边界：Beelink 开机前只允许代码、配置、测试用例和文档开发；服务器端 build、
typecheck、test、render、deploy、service start、真实 SIP 呼叫全部不得执行。

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

当前进度：规范化 schema、23 段 migration、逐事件本地 outbox、PostgreSQL inbox、
shadow projection、离线 import、逐记录 count/hash 对账及原子 evidence 文件已实现；
新增 `SKIP LOCKED` reliable outbox、provider CAS 和 aggregate fencing SQL/Repository。
新增异步 `PostgresPrimaryStore` aggregate unit-of-work：按 aggregate advisory lock
串行化、校验并锁定 fencing lease、projection record CAS、同一 event payload 防重放，
并可在同一事务写 reliable outbox；重复 projection event 不再错误递增 record version，
outbox 重用幂等键但内容不同时明确冲突。现有领域 Repository 仍是同步 snapshot API，
新增 durable primary command inbox，按 command request hash 保存原始结果，解决状态
继续推进后同一命令重试无法靠 projection payload hash 正确去重的问题。新增异步
PostgreSQL Provider Operations Repository：同一 session fence、确定性 operation ID、
唯一键竞争重读、版本/外部 ID/状态转换检查、同事务 normalized projection + command
result + reliable outbox，并在提交前二次校验 fence。该 Repository 尚未接入现有 27 个
非测试调用模块。新增 reliable inbox 采用“先占位、同事务处理、保存结果”语义，
并发重复 webhook 在领域变更前去重，event ID 复用但 payload/session/type 改变时失败
关闭；command/inbox retention 都使用有界 `SKIP LOCKED` 清理。其他领域仍是同步
snapshot API。新增异步 Session Repository，把 CallLeg、segment、playback 与 Session
版本作为同一 fenced aggregate 写入；新增 Usage Accounting Repository，以 Session 或
billing-account fence 约束命令、用户账户行锁串行化跨会话余额，并在同一事务提交
usage account、hold、request-hash ledger、command result 和 outbox。上述新 Repository
尚未接入现有同步调用面。Agent Run/Step/Tool/Handoff/Consult 已新增异步主写 UoW，
业务幂等 request hash、mode-scoped attempt、单活约束以及 Consult/Handoff/Run 原子
状态更新已进入第 22 段 migration；统一 runtime 工厂、精确 schema manifest、完整
primary import 和签名 audit 证据门禁已加入，但调用面迁移和单次 cutover 仍未完成，
因此尚未切成异步 PostgreSQL 单一写主，
因此多节点启动继续明确失败关闭，不能用 foundation 代码冒充 cutover 完成。

Import 会把 legacy Usage map/hold/ledger 转成版本化记录，并为旧 Agent
Run/Step/Tool/Handoff 生成确定性 request hash/idempotency metadata；audit 同时核对所有
primary payload、normalized namespace count、23 段 schema 与 database identity，证据以
cutover ID + 独立 HMAC key 签名。静态调用图当前仍有 81 处旧 Repository 导入和 25 处
直接 Snapshot 导入，因此 compile-time authorization 保持 false；这些计数归零并补齐
尚未建模的账号、支付、Voice、Terms、Diagnostics 持久化之前不得切
`API_STORAGE_DRIVER=postgres`。

第 23 段 migration 修正 aggregate lease 续租语义：同一未过期 instance owner 续租保持
fencing token，只有过期或跨 owner 接管才生成新 token；同 owner 并发写由 advisory
transaction lock 串行，避免并发请求互相把对方误判为 stale writer。统一调用层只能使用
稳定且至少 8 字符的 `PLATFORM_INSTANCE_ID`，不能按请求随机生成 owner。

后续本地静态批次已新增 Worker Dispatch/Capacity、Recording Consent/Job/Artifact 和
Ingress 异步主写 Repository。Dispatch 在同一 session-fenced transaction 内锁定全局
resource pool，并原子写 reservation+dispatch；Ingress 使用独立容量锁串行化全局与
单 Session 上限；Recording snapshot 只接受已持久化的权威 consent，Job/Artifact 使用
规范化唯一键、primary CAS、command inbox 和 outbox。过期 Worker reservation 不在持有
其他 Session fence 时被跨聚合改写，只从实时容量统计排除并由自身 fence 恢复清理。
这些 Repository 同样尚未接入调用面；统一 driver cutover 仍未完成。

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
operation、签名 webhook、artifact 和恢复轮询已完成静态实现；retention 删除任务、
对象 hash/manifest 和真实 Egress/对象存储仍待实现或验收。

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

所有模型任务先在隔离 harness A/B，再进入正式 integration flag。

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

当前进度：新增两地域/独立池/托管 PostgreSQL 与 Redis 的拓扑合同、多节点启动
失效关闭、容量结果校验器、OTLP trace、provider operation trace 关联、home-region/
cell 粘滞路由和 aggregate fencing token。它们不等于实现了 PostgreSQL 写主、
TURN/SFU 多节点、100 并发或 2 小时长稳；现有会话禁止跨区漂移，故障转移只接新会话。

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

当前仍是本地代码级验收：API gauges 是各进程 bounded window 的重算值，不替代持久化质量报告；
模型服务签名描述启动参数，不是模型权重 checksum；Collector 只完成静态合同校验，尚未实际启动。
RTT/jitter/loss、重连/TURN、drop/backpressure 的生产阈值仍为空，必须在隔离 staging、真机与
10/25/50/100 并发实测后校准，不得用单元测试或本地分位数替代真实负载验收。

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

2026-07-17 Platform P0 Batch 0A/0B：

| 任务 | 状态 | 剩余门禁 |
| --- | --- | --- |
| ARC-LK-001 | in_progress | Server digest、staging media smoke |
| ARC-LK-002 | in_progress | LiveKit room + legacy PSTN adapter 已接入；SIP/Dispatch/Egress/Ingress 待实现 |
| ARC-SEC-001 | ready_for_acceptance | staging/真机 token 和媒体复验 |
| ARC-SEC-002 | ready_for_acceptance | staging、多节点 SQLite/PostgreSQL 并发核销复验 |
| ARC-SEC-003 | ready_for_acceptance | staging App/Web 伪造消息复验 |
| ARC-SEC-004 | in_progress | Call Room 上限完成；CORS/Gateway/分布式公网限流待补 |
| ARC-SEC-005 | in_progress | 私有部署配置迁移和镜像 digest |
| ARC-CONTRACT-001 | in_progress | Flutter/Python golden fixtures |

`ready_for_acceptance` 不等于 accepted；没有部署和真实环境证据前不得结项。
