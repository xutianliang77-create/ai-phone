# AI 通讯平台统一架构设计

版本：v1.1
日期：2026-07-17
状态：评审基线

## 1. 结论

本项目不再按“同传、Call Link、PSTN、AI 代打”分别建设四套系统，而是统一为
一个 AI 通讯平台：

```text
Flutter / Web / PSTN
        |
LiveKit Room + SIP Media Plane
        |
Communication Session Runtime
        |
Speech Turn Platform
   | Translation Runtime
   | Voice Agent Runtime
        |
ASR / MT / LLM / TTS / Tools
        |
Unified Session Data + Ledger + Events
```

统一后的核心决策：

1. `communicationSessionId` 是历史、计费、通话、Agent 和审计的唯一聚合 ID。
2. LiveKit 负责实时媒体、房间、SIP participant 和 Agent job dispatch，不负责
   产品业务状态、翻译语义、计费和合规。
3. 翻译和语音 Agent 共用媒体输入、VAD、turn、ASR、TTS、播放控制和观测，
   但保持不同的业务编排器，禁止把 LLM 强行放入每个翻译热路径。
4. 当前 TypeScript Translation Worker 保留；先接入统一 job runtime 和
   Agent Dispatch，再逐步替换 API 进程内 `spawn`。
5. 当前 SQLite WAL 继续支持单机内测；生产多实例写入目标为 PostgreSQL。
   Redis 只承载短期协调、LiveKit 路由和任务租约，不作为业务真值。
6. Beelink 是开发/评测/小规模灰度节点，不作为高并发生产拓扑。
7. ASR、翻译、TTS、LLM 全部通过 Provider Contract 和 Model Profile 路由，
   每个 session 冻结实际 provider/model/version。
8. 所有热路径必须有容量准入、队列上限、超时、取消、降级和幂等。
9. LiveKit token 使用最小权限；客户端不允许发布数据消息，App 必须验证数据
   topic 和可信发送者。
10. 迁移使用兼容字段、双写校验、shadow、canary 和可回滚 feature flag，
    不做大爆炸式重写。

## 2. 文档索引

| 文档 | 内容 |
| --- | --- |
| `01-unified-platform-architecture.md` | 分层架构、组件职责、部署拓扑和 LiveKit 边界 |
| `02-unified-data-and-event-model.md` | 统一 ID、实体、状态机、事件信封和迁移映射 |
| `03-livekit-security-review.md` | LiveKit 源码、依赖、当前接入和部署安全审计 |
| `04-translation-and-agent-runtime.md` | 翻译主线与语音 AI Agent 的统一运行时 |
| `05-speech-media-performance-reliability.md` | ASR/TTS/VAD、媒体、高并发、SLO 和故障降级 |
| `06-implementation-roadmap.md` | 统一架构阶段路线、基础测试和回滚原则 |
| `07-livekit-integration-blueprint.md` | 八个 LiveKit 仓库的采用边界、adapter 和兼容策略 |
| `08-production-data-architecture.md` | 生产关系模型、可靠事件、对象存储和迁移方案 |
| `09-performance-reliability-capacity.md` | 容量准入、背压、故障域、SLO 和规模化设计 |
| `10-development-task-plan.md` | ARC/OPT 映射、开发批次、依赖和完成定义 |
| `11-platform-acceptance-plan.md` | 安全、数据、SIP、Dispatch、Egress/Ingress 和容量验收 |
| `12-qwen-audio-agent-gap-adoption-plan.md` | 借鉴 Qwen Audio Agent 补齐后台工作与可靠播报，不替换现有主线 |
| `13-air780-app-livekit-call-development-plan.md` | App→API→Air780 控制链、LiveKit 媒体链、Gate 0B 与部署任务；Air780 profile 不使用 LiveKit SIP |

## 3. 当前代码依据

本设计基于以下现有实现：

- API session、Call Link、账本和 SQLite：
  `services/api-server/src/modules`、`services/api-server/src/infrastructure/storage`
- Flutter LiveKit 房间：
  `apps/mobile/lib/src/features/call_link/data/livekit_call_room_client.dart`
- Translation Worker：
  `services/translation-worker/src/worker`
- PSTN Bridge：
  `services/pstn-bridge/src`
- ASR、翻译、TTS 和 Speaker 服务：
  `services/model-services`
- 统一协议：
  `packages/contracts/src`

LiveKit 参考范围：

- `livekit/livekit`
- `livekit/sip`
- `livekit/agents`
- `livekit/agents-js`
- `livekit/node-sdks`
- `livekit/client-sdk-flutter`
- `livekit/egress`
- `livekit/ingress`

近期线程 `019f2378-979b-7b40-b497-897752639718` 的 LiveKit、端云模型和隔离
评测研究已纳入 07–11 文档；本仓库仍是无界AI生产代码，独立的“语见AI”目录
不作为本次代码依赖或迁移来源。

## 4. 本阶段不做

- 不重写 Flutter 客户端。
- 不把 Node/TypeScript 服务整体改成 Go。
- 不立即把所有 SQLite JSON payload 一次性改成完全规范化数据库。
- 不在生产 App 中进行模型实验。
- 不在没有真实 SIP trunk、安全门禁和并发验收前开放 PSTN 商用。
- 不因为引入 LiveKit Agents 就删除现有翻译 Worker 和 Provider 适配层。

## 5. 硬性发布门槛

- P0 安全项全部关闭。
- 同一个业务通话只有一个权威 session 和一次用量结算。
- 100 次尾句 flush、重复 End、断网恢复均无漏译和重复扣费。
- 50 并发 session 自动化通过，单 session 故障不污染其他 session。
- Worker 升级支持 drain，进程崩溃可重派或明确结束。
- 真实 iPhone、Android、Web Guest、SIP/PSTN 分别验收。
- 所有发布镜像固定版本或 digest，依赖扫描无未接受的高危/严重项。
