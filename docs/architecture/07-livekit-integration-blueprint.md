# LiveKit 融合集成蓝图

版本：v1.2
日期：2026-07-17
状态：静态实现进行中，staging 未验收

## 1. 目标

把 LiveKit 作为媒体、电话、任务调度、录制和外部媒体接入底座，同时保持无界AI
现有 session、翻译、播放、计费、历史和合规语义不被上游框架替换。

核心原则：

1. 通过官方 SDK/API 集成，不复制上游内部状态机。
2. 每项能力先经过本项目 adapter，再进入领域服务。
3. LiveKit ID 只作为外部绑定，不成为业务主键。
4. Translation Runtime 与 Voice Agent Runtime 在逻辑上独立限容，但随无界 AI
   一起运行在同一个 `wujie-ai` 应用容器内；不得按模块再拆应用容器。
5. 新旧实现并存期间只允许一个权威写路径，禁止双控制器同时执行副作用。

## 2. 上游仓库采用矩阵

| 上游仓库 | 采用内容 | 不采用内容 | 本项目边界 |
| --- | --- | --- | --- |
| `livekit/livekit` | Room、participant、track、reconnect、TURN、分布式路由 | 业务 session、历史、账本、翻译状态 | `MediaRoomProvider` |
| `livekit/sip` | trunk、inbound/outbound、DTMF、transfer、SIP participant | 自建 SIP/RTP 状态机、把 SIP 状态当业务终态 | `TelephonyProvider` |
| `livekit/agents` | job 生命周期、进程隔离、prewarm、load、drain 设计 | 用 AgentSession 替换忠实翻译流水线 | Agent 专用 runtime |
| `livekit/agents-js` | TypeScript worker、显式 dispatch、原始媒体 participant 模式 | 把所有模型调用塞进单一 Agent worker | `JobRuntimeProvider` |
| `livekit/node-sdks` | Room、SIP、Dispatch、Egress、Ingress 管理 API | SDK DTO 直接进入领域层 | API adapter |
| `livekit/client-sdk-flutter` | prepareConnection、Room、track、事件、pre-connect audio | SDK participant/track 对象进入持久层 | 当前 Flutter room client |
| `livekit/egress` | room/participant/track 录制、导出、webhook | 把录制成功当 session 结束条件 | `RecordingProvider` |
| `livekit/ingress` | RTMP/WHIP/URL 外部媒体接入；SRT 经独立桥转换为 RTMP | 作为普通电话替代方案 | `ExternalMediaProvider` |

## 3. 反冲突适配层

```text
Domain Service
  |
  +-- MediaRoomProvider
  +-- TelephonyProvider
  +-- JobRuntimeProvider
  +-- RecordingProvider
  +-- ExternalMediaProvider
  |
LiveKit Adapters
  |
Official SDK / API
```

领域层不得 import LiveKit protobuf、SDK client class、participant object 或
egress/ingress request type。adapter 负责：

- DTO 映射。
- 错误分类。
- timeout、retry 和 cancellation。
- provider request id。
- webhook 验签和去重。
- capability 声明。
- 版本差异兼容。

建议合同：

```ts
interface ProviderCommand<T> {
  operationId: string;
  sessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  deadlineAt: string;
  payload: T;
}

interface ProviderResult<T> {
  accepted: boolean;
  providerOperationId?: string;
  externalResourceId?: string;
  capabilitySnapshot: Record<string, boolean>;
  result?: T;
}
```

## 4. 版本和兼容策略

新增 `LiveKitCompatibilityProfile`，发布时冻结：

| 字段 | 说明 |
| --- | --- |
| `profileVersion` | 本项目兼容配置版本 |
| `serverImageDigest` | LiveKit Server 镜像 digest |
| `sipImageDigest` | SIP 镜像 digest |
| `egressImageDigest` | Egress 镜像 digest |
| `ingressImageDigest` | Ingress 镜像 digest |
| `serverSdkVersion` | `livekit-server-sdk` |
| `rtcNodeVersion` | `@livekit/rtc-node` |
| `flutterSdkVersion` | `livekit_client` |
| `agentsJsVersion` | `@livekit/agents` |
| `testedCapabilities` | SIP/dispatch/egress/ingress/clear/preconnect |
| `verifiedAt` | 最后合同验收时间 |

规则：

1. 不跟随 `latest` 或上游 `main`。
2. 单次发布最多升级一个 LiveKit 能力族。
3. SDK 小版本升级也必须跑合同和媒体 smoke。
4. Server/SIP/Egress/Ingress 镜像组合进入兼容矩阵后才可灰度。
5. 上游源码修复只允许最小、可追踪补丁；必须记录 upstream issue/commit、
   Apache-2.0 许可和删除条件。

## 5. Room 与客户端

当前 Flutter `prepareConnection + connect(autoSubscribe:false)` 保留。后续优化：

- 页面进入或号码确认后尽早 `prepareConnection`。
- 需要 Agent 的场景评测 `withPreConnectAudio`，缓解连接和 dispatch 期间首段丢音。
- host/guest 只发布 microphone。
- App 按 participant identity、track source 和命名规则订阅目标译音。
- data channel 只用于可丢的 UI 信息；关键控制事件走 API 可靠事件。
- reconnect 后重新拉取 session snapshot，不从 Room presence 推导业务状态。

## 6. Translation Job Runtime

现有 Translation Worker 继续承载核心同传，迁移路径：

1. 保留 `TRANSLATION_WORKER_CALL_ID` 作为回退入口。
2. 新建命名 `translation-runtime` 的显式 dispatch。
3. metadata 只携带 `sessionId`、snapshot version 和短期 snapshot ticket。
4. Worker 入房后通过 API 获取最小 session snapshot。
5. Worker 使用现有 `LiveKitCallAudioSource`、Provider Contract 和 playback
   generation。
6. Worker 上报 ready 后 session 才允许进入可翻译 active。
7. drain 时停止接新 job，活动 session 正常结束或按 deadline 明确降级。

Translation Worker 可以借用 Agents JS 的 job server 和原始媒体 participant 能力，
但不创建通用 LLM `AgentSession`，避免改变翻译的 turn、延迟和忠实度。

## 7. Voice Agent Runtime

新增独立 `voice-agent-runtime`：

- 使用命名 dispatch。
- 可采用 Agents/Agents JS 的 AgentSession、tool、handoff、AMD 和 telephony
  示例。
- 复用统一 Speech Runtime、Provider Registry、Agent Policy 和数据合同。
- 不读取 Translation Worker 内存。
- 不直接更新计费、session 终态或用户授权。
- 工具执行必须回到 API Policy/Tool Gateway。

Agent Assist 和 Autonomous Agent 使用不同 agent name、权限、限流和 feature
flag，避免误把辅助模式升级为自动代打。

## 8. SIP/PSTN

### 8.1 出站流程

```text
App -> API create session
API -> Dispatch translation/agent job
Worker -> ready
API -> LiveKit SIP create participant
SIP participant -> room
SIP events/webhooks -> provider operation inbox
API -> session/call leg state transition
```

顺序约束：

- Worker 未 ready 时不拨号，除非产品明确选择先拨号后字幕降级。
- `CreateSIPParticipant` 成功只表示请求被接受，不表示真人已接听。
- ringing、active、hangup、transfer 分别映射到 leg 状态。
- session `answeredAt` 只由可信 SIP 状态或媒体证据推进。
- Provider timeout 后先查询/对账，不能盲目重复拨号。

### 8.2 入站流程

SIP dispatch rule 只负责把 caller 路由进指定 room/前缀；API 必须在收到可信
事件后创建或绑定业务 session，并应用号码、租户、语言、录音和 Agent 策略。

### 8.3 当前 PSTN Bridge

现有 HTTP/Fonoster/mock adapter 保留为兼容 provider。新增 LiveKit SIP adapter
后：

- `PSTN_PROVIDER=livekit_sip` 独立灰度。
- 旧 provider 与 LiveKit SIP 不能对同一 session 同时拨号。
- capability 由 adapter 真实声明，禁止把 Room `clearQueue` 等同于任意电话
  provider 的 clear。
- 真实 SIP participant 进入 Room 后，译音走 LiveKit 目标 track，不再经旧
  HTTP media writer 重复回灌。

## 9. Egress

录音不是实时主链依赖。推荐：

| 场景 | Egress 类型 |
| --- | --- |
| 通话双方独立音轨 | participant 或 track egress |
| 混合音频归档 | audio-only room composite |
| 实时转写旁路 | audio track WebSocket egress，仅在明确需要时 |
| 客服/会议可视布局 | room composite |

API 先创建 `recording_job`，检查 consent 和 retention，再调用 Egress。所有
`egress_started/updated/ended` webhook 进入 inbox；对象写入成功、manifest
校验和 hash 完成后才生成 `recording_artifact`。

Egress 失败不得中断字幕、翻译、Agent 或通话结算。

## 10. Ingress

Ingress 用于企业直播、外部会议流、媒体文件和 WHIP 设备，不进入首批电话主链。

约束：

- 一个 ingress 绑定一个 `external_media_source` 和目标 room。
- RTMP/WHIP stream key 属于密钥，不能写日志。
- LiveKit 原生 Ingress 不接收 SRT；`srt://` 不得伪装成 `URL_INPUT`。SRT 由隔离
  bridge 监听加密 MPEG-TS，校验 RTMP 目标 allowlist 后以 H.264/AAC copy 输出。
- URL input 必须防 SSRF，限制协议、域名、重定向、私网 IP、大小和时长。
- Ingress participant 只能发布预期 source。
- 重复使用 stream key 时创建新的 leg attempt，不覆盖旧 attempt。
- Ingress 转码容量与实时语音 Worker 分池。
- SRT bridge 作为 `wujie-ai` 容器内的可选进程运行，不使用独立镜像或独立应用容器；
  仍使用固定 UDP 端口池、任务数和最长时长。connection URL 只在首次 create 响应返回，
  数据库只保存 `external_bridge_id`。

## 11. 最小权限

| 身份 | publish | subscribe | data | 管理权限 |
| --- | --- | --- | --- | --- |
| App host/guest | microphone | 目标音轨 | false | 无 |
| Translation Worker | TTS audio | source audio | 受控 | 无 |
| Voice Agent | Agent audio | caller audio | 受控 | 无 |
| Recorder | 由 Egress 管理 | 指定 tracks | false | roomRecord |
| API adapter | 无媒体 | 无媒体 | 无 | room/SIP/dispatch/egress/ingress admin |

API 管理凭据与媒体 participant token 分离，按 audience 和用途使用不同 key。

## 12. 官方参考

- https://docs.livekit.io/transport/self-hosting/distributed/
- https://docs.livekit.io/telephony/making-calls/outbound-calls/
- https://docs.livekit.io/reference/telephony/sip-api/
- https://docs.livekit.io/agents/server/agent-dispatch/
- https://docs.livekit.io/agents/server/lifecycle/
- https://docs.livekit.io/agents/server/options/
- https://docs.livekit.io/transport/media/ingress-egress/egress/
- https://docs.livekit.io/transport/media/ingress-egress/ingress/
- https://docs.livekit.io/reference/client-sdk-flutter/livekit_client/Room/prepareConnection.html
- https://docs.livekit.io/reference/client-sdk-flutter/livekit_client/RoomPreConnect/withPreConnectAudio.html
- https://github.com/livekit/sip
- https://github.com/livekit/agents-js

## 13. 当前实现状态

- `infra/livekit-compatibility-profile.json` 已记录 Node/Flutter SDK 以及候选镜像。
  LiveKit Server v1.13.3 与 SIP v1.7.0 的 linux/amd64 digest 仅是只读 registry
  候选，尚未在 Beelink/staging 验证，不能称为已冻结兼容组合。
- `packages/contracts/src/communication` 已提供 command/event、统一 ID、统一
  adapter result、Provider Operation 和五类 Provider Adapter port。
- Guest one-time ticket、nonce 摘要持久化、原子核销、防重放、Host 轮换及
  Call Room 资源上限已落代码；本批服务器测试按用户要求延后。
- `provider_operations` 已实现 session 级单次拨号门禁、request hash 重放判定、
  expectedVersion、外部 ID 冲突和终态不回退；当前 SQLite snapshot 只作为
  单机/过渡实现，PostgreSQL CAS 尚未实施。
- LiveKit SIP outbound adapter、App 拨号入口、签名 webhook inbox、乱序完成
  对账和按接听时长结算已完成静态实现；未接听的乱序事件保留 30 秒窗口，窗口后
  recovery 以 0 秒结算，避免 operation 长期停在 unknown。真实 trunk、真实号码和
  退款仍未执行。
- `participant_joined` 不再自动等同 answered。Translation Worker 监听
  `sip.callStatus`，内部接口先持久化 `active/automation`，成功后才把 SIP 早期
  媒体送入 ASR；持久化失败时门禁保持关闭。
- Worker ready 顺序已改为先完成 LiveKit RTC connect，再初始化 ASR/发布
  `worker-started`；两者完成前所有已订阅帧都等待 pipeline gate，避免“已 ready
  但尚未入房”的拨号竞态。
- 媒体隔离已加入三层静态保护：App/Web 关闭自动订阅、human microphone 仅授权
  Translation Worker、Worker TTS track 在写入首帧前由 API 对目标 leg 做精确
  subscription allowlist。任何 TTS track 授权失败都禁止输出音频。
- `LIVEKIT_SIP_MEDIA_ROUTING_MODE` 默认仍为
  `blocked_pending_media_isolation`。只有隔离 staging 证明电话端听不到原始人声、
  非目标译音为 0 帧后，才允许改为 `translated_tracks_only`。
- Dispatch、Egress、Ingress 尚未进入实现批次。
- 2026-07-17 Beelink 不在线；用户明确要求开机前不做任何服务器端构建、测试、
  部署或真实呼叫。因此以上均为未执行验收的静态实现，不构成产品通过。
