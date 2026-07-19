# 统一架构实施与测试计划

版本：v1.2
日期：2026-07-19

## 1. 迁移原则

- 先冻结合同和安全边界，再替换运行时。
- 先增加新表/新事件，后迁移读写，最后删除旧字段。
- 每一步都有 feature flag、shadow 证据和回滚路径。
- 不同时切换 LiveKit runtime、数据库和模型。
- 生产 App 的模型实验继续使用独立测试 App。

本文件保留阶段级路线。详细 LiveKit 采用边界、数据模型、开发任务和验收门禁见：

- `07-livekit-integration-blueprint.md`
- `08-production-data-architecture.md`
- `09-performance-reliability-capacity.md`
- `10-development-task-plan.md`
- `11-platform-acceptance-plan.md`

任务状态仍以 `docs/ai-phone-optimization-development-tasks.md` 的 `OPT-*` 为产品
真值；`ARC-*` 只提供跨模块实施视图。

## 2. Phase A：安全和合同冻结

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-SEC-001 | LiveKit 最小权限 token | 客户端不能发布 data/video/screen |
| ARC-SEC-002 | Guest one-time ticket | 重放、过期、超人数被拒绝 |
| ARC-SEC-003 | App data sender/topic 校验 | 伪造字幕红队用例失败 |
| ARC-SEC-004 | API/Gateway 限流和 payload 上限 | 大包、碎片和连接洪泛不 OOM |
| ARC-SEC-005 | 镜像/secret 固定 | digest、0600、secret scan 通过 |
| ARC-CONTRACT-001 | communication contracts | Node/Flutter contract tests 通过 |

完成前不开放 SIP 和 Agent 公测。

## 3. Phase B：统一 session 和数据模型

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-DATA-001 | session/participant/leg 表 | 旧 DTO mapper 输出不变 |
| ARC-DATA-002 | turn/transcript/translation 表 | revision、speaker、timing 不回滚 |
| ARC-DATA-003 | agent task/run 分离 | 重试不覆盖原 task |
| ARC-DATA-004 | provider operation/inbox/outbox | webhook 和命令幂等 |
| ARC-DATA-005 | 双写校验 | 旧 snapshot 与新表聚合一致 |
| ARC-DATA-006 | PostgreSQL adapter | 50 并发写和恢复通过 |

当前迁移状态与发布步骤：

1. 31 段 schema、primary UoW、全部生产 Repository adapter 和静态调用图 `0/0` 已完成。
2. 隔离 staging 已完成 migration/import/audit/rollback，compile-time primary authorization 已开启。
3. 每个目标环境仍须使用独立 database identity、verify-full TLS 和签名 cutover evidence。
4. 选择 `API_STORAGE_DRIVER=postgres` 后 PostgreSQL 是唯一写主，不运行长期 dual write。
5. 跨主机 Patroni/etcd、WAL-G off-host PITR、容量与回滚证据通过前保持多节点失败关闭。

## 4. Phase C：LiveKit Job Runtime

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-JOB-001 | Agent Dispatch Adapter | API 可创建/取消/查询 dispatch |
| ARC-JOB-002 | Translation job wrapper | 不再由 API 直接 spawn |
| ARC-JOB-003 | Worker prewarm/load/drain | 冷启动和滚动升级达标 |
| ARC-JOB-004 | crash redispatch | SIGKILL 后 15-20 秒内恢复/结束 |
| ARC-JOB-005 | capacity admission | 过载时拨号前拒绝或排队 |

旧 `CallLinkWorkerSupervisor` 保留为 feature flag fallback，直到 Beelink 和测试环境
连续稳定通过。

## 5. Phase D：语音 Agent

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-AGENT-001 | voice-agent-runtime | 在 LiveKit room 监听/说话 |
| ARC-AGENT-002 | policy/tool registry | L0-L3 权限测试 |
| ARC-AGENT-003 | disclosure workflow | 未披露不得进入任务对话 |
| ARC-AGENT-004 | user takeover | 250-350ms 内停止 Agent TTS |
| ARC-AGENT-005 | DTMF/IVR | 扩展号和菜单流程通过 |
| ARC-AGENT-006 | warm transfer | 成功、拒绝、无人接三条流程 |
| ARC-AGENT-007 | structured result | 结果、证据、未解决项完整 |

本地静态实现已覆盖独立 runtime、披露、AMD/IVR、结构化结果和用户同房接管的
接受/拒绝/超时路径；`ARC-AGENT-006` 已增加独立私密 consult room、外部 operator
SIP leg、接受后的 room move、拒绝/无人接、未知 move 对账和 App 三方确认流程。
该功能默认关闭，未连接真实 LiveKit/模型/SIP/trunk/真机，不得标记 accepted。

先上线 Agent Assist，再灰度 Autonomous Agent。

## 6. Phase E：ASR/TTS/VAD 和翻译性能

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-ASR-001 | persistent streaming ASR | 首 partial/final SLO |
| ARC-ASR-002 | 两遍式 ASR shadow | 数字/术语提升且不阻塞实时 |
| ARC-VAD-001 | translation/agent turn profiles | 误断和等待率达标 |
| ARC-VAD-002 | echo/backchannel 分类 | TTS 不自激，真实抢话保留 |
| ARC-TTS-001 | VoxCPM2 真流式 contract | first audio P95 <=600ms 内测 |
| ARC-TTS-002 | voice prewarm/cache | 首次个人声音延迟达标 |
| ARC-MT-001 | MT micro-batch/admission | 50 并发 P95 和错误率达标 |
| ARC-FALLBACK-001 | STT/MT/TTS/LLM fallback | 故障注入自动降级和恢复 |

## 7. Phase F：SIP/PSTN 和生产高可用

| 任务 | 交付 | 验收 |
| --- | --- | --- |
| ARC-SIP-001 | LiveKit SIP provider | 真实 outbound/inbound |
| ARC-SIP-002 | SBC/firewall/SRTP | 安全门禁和单向音频测试 |
| ARC-SIP-003 | provider reconciliation | webhook、时长和账单对账 |
| ARC-HA-001 | SFU/SIP/Worker pools | 节点 drain 和故障恢复 |
| ARC-HA-002 | PostgreSQL HA | failover 无重复结算 |
| ARC-OBS-001 | OTel/SLO dashboards | session trace 可定位每阶段 |
| ARC-LOAD-001 | 100 并发 + soak | 达到商用容量门槛 |

## 8. 测试分层

### 8.1 单元测试

- 所有状态机合法/非法迁移。
- event schema、revision、idempotency。
- token grants、ticket、签名和脱敏。
- VAD、turn、playback、Agent policy。

### 8.2 合同测试

- Flutter/Node 共享事件样例。
- API/Worker/Model Provider 请求和错误。
- LiveKit data topic、track naming 和 participant attributes。
- PSTN/SIP status 与媒体事件。

### 8.3 集成测试

- API + LiveKit + Worker + mock models。
- Call Link 双端、Agent、PSTN internal media loop。
- 数据库重启、outbox 恢复、重复事件。

### 8.4 安全测试

- token 越权、重放、伪造 data、跨 room。
- Guest link 枚举、限流、人数和过期。
- SIP 扫描、恶意 INVITE、DTMF、transfer。
- Agent prompt injection、工具越权和 PII 泄漏。
- SCA、SBOM、镜像和 secret scan。

### 8.5 性能和故障

- 阶梯并发、长稳、网络损伤。
- Worker/模型/SFU/Redis/数据库故障注入。
- GPU OOM、队列饱和、provider rate limit。

### 8.6 真机

- iPhone、Android、Web Guest、蓝牙、扬声器、前后台。
- Call Link、PSTN、Agent 监听和接管。
- 端侧模型测试继续使用独立测试 App。

## 9. Feature Flags

至少保留：

```text
COMMUNICATION_DATA_MODEL_V2
LIVEKIT_MINIMAL_GRANTS
LIVEKIT_AGENT_DISPATCH
TRANSLATION_JOB_RUNTIME_V2
VOICE_AGENT_ENABLED
VOICE_AGENT_AUTONOMOUS_ENABLED
STREAMING_TTS_V2
TWO_PASS_ASR
CALL_FULL_DUPLEX_ENABLED
POSTGRES_PRIMARY_STORE
```

每个 flag 都要有 owner、默认值、灰度范围、观测指标、自动回退条件和删除日期。

## 10. 回滚

- 数据迁移期旧读路径保留一个版本。
- 新 runtime 失败可回退旧 Supervisor。
- 新模型只通过 routing profile 切换。
- Agent 失败回退 translation-only 或人工接管。
- TTS streaming 失败回退完整 PCM/字幕。
- PSTN clear 不可用自动回退半双工。

## 11. 完成定义

统一架构完成不是“代码接上 LiveKit”，而是：

1. 一个 session 贯穿房间、PSTN、Agent、历史和账本。
2. 翻译和 Agent 共用 speech runtime，但可独立升级和降级。
3. Worker 可调度、预热、限容、drain 和崩溃恢复。
4. ASR/MT/TTS/LLM 有可观测 fallback 和容量策略。
5. 安全、并发、长稳、真机和账本门禁全部有证据包。

## 12. 当前后续验收顺序

1. 恢复本批 unit/typecheck/lint/build 与合同回归，先消除静态候选的不确定性。
2. 在隔离 staging 复验 ASR/MT/TTS fallback、真流式 TTS、尾句有界 drain 和 Agent prewarm。
3. 以 owned-device 完成 direct/TURN/reconnect、echo/barge-in 和 RTC 阈值校准。
4. 接私有 trunk/白名单号码，依次验证 SIP、Agent、Egress、Ingress，保持所有高风险 flag 默认关闭。
5. 补第二数据库节点、3 个 DCS voter 和 off-host 对象存储，执行真实 HA/PITR。
6. 最后执行 25/50/100 并发、故障注入和 120 分钟 soak，再决定生产切流和灰度。
