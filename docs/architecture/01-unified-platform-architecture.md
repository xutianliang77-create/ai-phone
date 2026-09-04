# 统一技术架构

版本：v1.0
日期：2026-07-17

## 1. 设计原则

1. 业务真值与媒体状态分离：LiveKit participant 在线不等于业务 call 已接通。
2. 控制面与媒体面分离：API 不处理实时 PCM，Worker 不直接修改账本。
3. 热路径与会后路径分离：字幕/译音优先，会后摘要、重点和 CRM 写入异步执行。
4. 翻译与 Agent 共用基础设施，不共用一个巨型编排器。
5. 每个模块只拥有一种状态机，跨模块通过版本化命令和事件通信。
6. 失败优先降级字幕，其次半双工，最后结束，不伪造成功。

## 2. 分层架构

### 2.1 客户端层

| 组件 | 职责 |
| --- | --- |
| Flutter App | 面对面、聆听、Call Link、PSTN 主叫、Agent 监听/接管 |
| Web Guest | 免安装入房、权限同意、字幕、目标译音播放 |
| Admin Console | 后续运营、风控、退款、任务和质量审计 |

客户端只持有公开 API、LiveKit 短期连接凭据和当前 session 配置，不持有模型服务
地址、LiveKit API secret、内部 API secret 或 PSTN 凭据。

### 2.2 边缘与媒体层

| 组件 | 职责 |
| --- | --- |
| Public API Gateway | TLS、登录、限流、WAF、请求大小和审计 |
| LiveKit SFU | WebRTC 信令、音频轨、数据通道、网络重连 |
| LiveKit SIP | SIP trunk、PSTN participant、RTP/SRTP、DTMF |
| TURN | 企业网络、VPN 和复杂 NAT 下的媒体中继 |
| Egress | 经用户同意后的录音、合成布局和导出 |

LiveKit 不保存产品账本、Agent 任务、历史正文和业务终态。

### 2.3 控制面

| 服务 | 权威职责 |
| --- | --- |
| API Server | 账号、同意、session、计费、数据查询、风险策略 |
| Call Orchestrator | 创建 room、SIP participant、call leg、终止和转接 |
| Agent Dispatch Adapter | 创建、查询和取消 LiveKit Agent dispatch |
| Provider Registry | 模型、PSTN、存储和能力声明 |
| Policy Service | 号码、频控、敏感工具、接管和录音策略 |

P0 可继续作为 API 内模块；进入多实例前再按负载和权限边界拆服务。

### 2.4 实时运行时

```text
Room / SIP audio
      |
Media Ingress
      |
Speech Frontend
      |
VAD + Turn Coordinator + ASR
      |
SpeechTurn Event
      +-------------------+
      |                   |
Translation Runtime   Agent Runtime
      |                   |
MT + TTS             Policy + LLM + Tools + TTS
      +---------+---------+
                |
Playback Router / Captions / Events
```

运行时拆为：

- `translation-runtime`：忠实翻译、自动语种、术语、字幕、译音和抢话。
- `agent-runtime`：目标、对话记忆、工具调用、确认、接管和任务结果。
- `speech-runtime`：共享音频、VAD、turn、ASR、TTS、播放和观测能力。

Agent Runtime 内部再区分实时前台与持久后台：当前轮直接回复保留低延迟前台；
复杂工具任务只通过有界命令快速受理，由持久后台执行。后台结果必须经过
AnnouncementWindow 和客户端播放回执才能确认交付。该扩展不得阻塞或改写
Translation Runtime，优先级固定为实时翻译高于任何后台播报。详细兼容边界见
`12-qwen-audio-agent-gap-adoption-plan.md`。

### 2.5 模型服务层

| 能力 | 当前主路由 | 统一接口目标 |
| --- | --- | --- |
| ASR | 服务器 Qwen3/FireRed，iOS Nemotron | session stream、partial/final、flush、cancel |
| VAD | MarbleNet，端侧 FluidAudio/Silero | probability、start/end、fingerprint、fallback |
| MT | Hy-MT2 | translate、batch、health、usage、cancel |
| TTS | VoxCPM2 | 流式 audio chunk、clear、voice cache、usage |
| LLM | Qwen-compatible | structured output、tools、policy、fallback |
| Speaker | Sortformer / participant track | span、overlap、confidence、revision |

### 2.6 数据与运维层

- PostgreSQL：生产业务真值、账本、事务、outbox。
- SQLite WAL：单机开发、内测和离线管理，不承担多节点并发写。
- Redis：LiveKit、dispatch 协调、短期租约、限流和缓存。
- Object Storage：经授权的录音、声音参考、导出和诊断证据。
- OpenTelemetry：trace、metrics、logs，正文默认不进入日志。

## 3. 模式统一

| mode | 媒体入口 | 编排器 | 默认输出 |
| --- | --- | --- | --- |
| `conversation` | 本机麦克风 | translation | 双语字幕 + 可选 TTS |
| `listening` | 本机麦克风 | translation | 大字幕，无默认 TTS |
| `call_link` | LiveKit 双 participant | translation | 双向字幕 + 定向译音 |
| `pstn_translation` | LiveKit + SIP participant | translation | App/PSTN 双向译音 |
| `agent_call` | SIP participant + agent | agent | Agent 语音、字幕、结果 |
| `agent_assist` | 任意实时 session | translation + agent | 翻译 + 建议回复/重点 |
| `meeting` | 多 participant / 单麦克风 | translation | 多说话人字幕和纪要 |

## 4. LiveKit 采用边界

直接采用：

- Room、participant、track、reconnect、TURN。
- SIP inbound/outbound participant。
- Agent Dispatch、worker availability、drain 和 job isolation。
- Egress 录音/导出。

保留自研：

- Session 聚合、计费、合规和历史。
- 自动语种和翻译方向。
- Segment/turn/revision 语义。
- 定向 TTS playback、generation 和抢话。
- 领域术语、LLM 保守纠错和质量报告。
- Agent 工具权限和业务策略。

## 5. 部署拓扑

### 5.1 当前开发/内测

```text
iPhone / Web
   |
Beelink
  - API + Gateway
  - LiveKit + Redis
  - Translation Worker
  - ASR / MT / TTS / Speaker / LLM
  - SQLite
```

该拓扑适合功能验收，不适合高可用和高并发。

### 5.2 生产目标

```text
Global/L4 LB
   |
LiveKit SFU Pool -------- TURN Pool
   |                         |
LiveKit SIP Pool -------- SIP Providers
   |
Agent/Translation Worker Pool
   |
Model Gateway
   +-- ASR CPU/GPU Pool
   +-- MT GPU Pool
   +-- TTS GPU Pool
   +-- LLM GPU/API Pool

API Pool -- PostgreSQL -- Redis -- Object Storage
              |
          OTel / Alerting
```

媒体节点与 GPU 节点分开扩容，避免模型 OOM 影响 SFU。

## 6. 内部合同

所有内部命令至少包含：

```json
{
  "commandId": "uuid",
  "sessionId": "uuid",
  "expectedVersion": 12,
  "idempotencyKey": "string",
  "issuedAt": "ISO-8601",
  "actor": {
    "type": "service",
    "id": "translation-worker"
  },
  "payload": {}
}
```

所有实时事件使用 `02-unified-data-and-event-model.md` 的事件信封。模型接口不得
直接复用面向客户端的 DTO。

## 7. 代码组织约束

- 新增 `packages/contracts/src/communication` 作为统一领域合同。
- API 模块按 `sessions`、`participants`、`agent-runs`、`playbacks`、
  `billing` 和 `events` 分开。
- Worker 只依赖接口，不读取 API 数据库文件。
- 单个 TypeScript/Dart/Python 文件继续遵守 350 行门禁。
- 状态机、解析、IO adapter、业务服务和路由必须分文件。
- 新架构先以 adapter 接现有模块，迁移完成后才删除兼容代码。
