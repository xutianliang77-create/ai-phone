# Air780 VUART v1 Command Payload Schema

状态：`FROZEN_H1_SERIAL_FIXTURE_PASS / NODE_LUA_GOLDEN_PASS / PROD_RUNTIME_HOST_PASS / REAL_TTY_PENDING`
日期：2026-08-04

本文冻结 VUART v1 的 `HELLO`、`HEARTBEAT`、`DIAL`、`HANGUP`、`DTMF`、
`ACK` 和 `ERROR` payload。外层 envelope、`CALL_STATE` 与 audio payload 继续遵循
`air780-vuart-v1-session-payload-schema-20260804.md`。诊断 007 的 `WJAI/1`
文本头、JSON 和未版本化私有 payload 均不属于生产协议。

## 1. 方向与通用约束

| frame type | 值 | 方向 | 作用 |
| --- | ---: | --- | --- |
| `HELLO` | 1 | Air780 → Gateway | 声明本次 boot 和已验证能力 |
| `HEARTBEAT` | 2 | Air780 → Gateway | boot 内存活、设备状态和活动绑定对账 |
| `DIAL` | 3 | Gateway → Air780 | 在已绑定 lease/generation 上发起一次拨号 |
| `HANGUP` | 4 | Gateway → Air780 | 结束同一运营商电话 |
| `DTMF` | 5 | Gateway → Air780 | 仅在已连接电话上发送受控按键 |
| `ACK` | 32 | Air780 → Gateway | 返回已执行并缓存的确定性结果 |
| `ERROR` | 33 | Air780 → Gateway | 返回可关联、无副作用的拒绝结果 |

- 所有整数均为 unsigned little-endian；payload 必须完整消费。
- payload version 固定为 `1`，frame flags 固定为 `0`。
- identifier 使用 ASCII `[A-Za-z0-9][A-Za-z0-9._:-]*`；长度为字节数。
- `frame.sequence` 仍是每个发送端连接内的传输序号，不替代 command、heartbeat、
  carrier 或 media sequence。
- `bootId` 每次 Lua/CORE 启动必须变化。Gateway 发现新 bootId 时进入 quarantine，
  先 reconcile carrier/lease，禁止自动重发不确定结果的 DIAL。
- 冻结 golden HELLO 仍以 `0x03` 保存旧 call-control/downlink 证据。V2048 Gate 0B
  已证明 8/16 kHz `cc.input` 数字 stream，production candidate `001.002.000` 因此以
  `0x07` 进入独立板端自检；在新 bundle 的 Lua golden/runtime 和真实 VUART 未通过前，
  该 bit 只能写候选能力，不能写产品发布已验证。DTMF 未实测前仍不得声明 DTMF。

## 2. HELLO

| 字段 | 编码 | 约束 |
| --- | --- | --- |
| `payloadVersion` | `uint8` | `1` |
| `deviceId` | `uint8 length + ASCII` | `1..128` |
| `bootId` | `uint8 length + ASCII` | `1..128`，每次 boot 唯一 |
| `firmwareVersion` | `uint8 length + ASCII` | `1..64` |
| `protocolVersion` | `uint8` | `1` |
| `capabilityFlags` | `uint16` | 仅允许下表 bit，未知 bit 拒绝 |
| `maxPayloadBytes` | `uint16` | `6461..65535` |

capability bit：`0x01=CALL_CONTROL`、`0x02=AUDIO_DOWNLINK_16K`、
`0x04=AUDIO_UPLINK_16K`、`0x08=DTMF`。能力是运行态证据声明，不是编译期开关；
未通过对应 Gate 时必须清零。

`maxPayloadBytes >= 6461` 保证接收端能处理一个冻结的 6,400-byte PCM audio
payload；它不是修改板端 200 ms 缓冲的许可。该值只是通用 v1 解码下限，不能覆盖
最长合法 session binding。无界 AI 当前产品 profile 进一步固定要求 capability `0x07`
且 `maxPayloadBytes >= 8192`；Gateway 在 HELLO admission 层拒绝未知 bit、缺失任一
control/downlink/uplink 能力或容量不足的设备，并保持 quarantine。

## 3. HEARTBEAT

| 字段 | 编码 | 约束 |
| --- | --- | --- |
| `payloadVersion` | `uint8` | `1` |
| `deviceId` | `uint8 length + ASCII` | `1..128` |
| `bootId` | `uint8 length + ASCII` | `1..128` |
| `heartbeatSequence` | `uint32` | boot 内独立递增，首值允许 `0` |
| `uptimeMs` | `uint64` | boot 后单调毫秒 |
| `deviceState` | `uint8` | `1=ready,2=in_call,3=quarantined,4=fault` |
| `activeBindingPresent` | `uint8` | `0` 或 `1` |
| `activeBinding` | session binding prefix | present=1 时存在 |

`ready` 必须没有 active binding；`in_call` 必须携带 active binding；
`quarantined/fault` 可携带绑定用于对账。HEARTBEAT 不是 carrier 状态，不能把
`in_call` 或 LiveKit joined 提升为 carrier connected。

## 4. 命令上下文

`DIAL/HANGUP/DTMF` 首先携带冻结的 session binding prefix：

`payloadVersion + callGeneration + fencingToken + communicationSessionId +`
`providerCallId + deviceId + leaseId`

随后追加：

| 字段 | 编码 | 约束 |
| --- | --- | --- |
| `providerOperationId` | `uint8 length + ASCII` | `1..200` |
| `commandId` | `uint8 length + ASCII` | `1..128`，重试不可改变 |
| `idempotencyKey` | `uint8 length + ASCII` | `1..200`，业务副作用身份 |

`providerCallId` 必须在发送 DIAL 前由 API/Gateway 预分配，设备不得在 ACK 中生成
第二个业务电话标识。Gateway 只在解析、长度、leaseId、fence、generation、device、
session 和 providerCallId 全部匹配后才允许进入副作用执行器。

### 4.1 DIAL tail

`dialTargetE164 = uint8 length + ASCII`，必须匹配 `^\+[1-9][0-9]{7,14}$`。
业务层的 `phoneNumberReference` 必须在 Gateway 内受控解析为该瞬时字段；E.164 不得
写入日志、golden 之外的持久化 payload、指标 label 或异常消息。

### 4.2 HANGUP tail

无额外字段。它只作用于 command context 精确绑定的同一运营商电话；人工接管不得
通过 HANGUP 后重拨实现。

### 4.3 DTMF tail

`digits = uint8 length + ASCII`，长度 `1..64`，字符仅允许 `0-9 * # A-D`。
设备仍必须在 carrier connected 且上层已授权当前 IVR 步骤时执行。

## 5. ACK 与 ERROR

ACK/ERROR 都复用完整命令上下文，随后追加：

| 字段 | 编码 | 约束 |
| --- | --- | --- |
| `requestFrameSequence` | `uint32` | 首次执行的原始命令 frame sequence |
| `commandType` | `uint8` | 仅 `3/4/5` |
| `result/errorCode` | `uint8` | 见下表 |

ACK 仅定义 `1=applied`。它表示命令副作用已执行一次并且 ACK 已缓存，不代表电话
connected；DIAL 的连接状态只由后续 CALL_STATE 决定。

ERROR：`1=unsupported_command`、`2=stale_fence`、`3=binding_mismatch`、
`4=stale_generation`、`5=idempotency_conflict`、`6=invalid_state`、
`7=invalid_argument`、`8=internal_error`。

如果 frame/payload 损坏到无法安全解析完整命令上下文，设备只丢弃并计数，不得伪造
可关联 ERROR。只有完整上下文已解码且未产生副作用时才发送 ERROR。

## 6. 恰好一次与冲突语义

设备处理顺序固定为：

1. 验证 envelope、CRC、payload 和全部字段；
2. 精确验证活动 session/device/lease/fence/generation/providerCallId；
3. 查询 commandId 和 idempotencyKey ledger；
4. 首次命令执行一次副作用，并原子缓存原始 payload hash 与 ACK payload；
5. 相同 commandId、相同 idempotencyKey、相同 payload 的重放返回字节完全相同的
   缓存 ACK，不再次拨号、挂断或发送 DTMF；ACK 仍携带首次 requestFrameSequence；
6. 相同 commandId 不同 payload，或相同 idempotencyKey 对应不同 commandId/payload，
   返回 `idempotency_conflict`，副作用次数保持不变；
7. 旧 lease/fence/generation 即使命中旧 ledger 也先拒绝，禁止旧 ACK 恢复权限。

ledger 在同一 boot 的 lease 生命周期与 reconnect quarantine 期间不得清空。新 bootId
意味着板端易失 ledger 不再可信；Gateway 必须 reconcile，provider timeout 后禁止
生成第二个 DIAL commandId 或直接再次拨号。

## 7. Golden vectors 与当前边界

- Node JSON：`services/air-device-gateway/fixtures/vuart-v1/command-golden-vectors.json`
- Lua table：`firmware/air780-livekit-bridge/vuart_v1_cmd_vec.lua`
- Node codec：`services/air-device-gateway/src/device/vuart-v1-command-payload.ts`
- Gateway ingress：`services/air-device-gateway/src/device/vuart-v1-command-ingress.ts`
- H0 replay guard：`services/air-device-gateway/src/device/vuart-v1-command-replay-guard.ts`
- boot admission：`services/air-device-gateway/src/device/air-device-boot-admission.ts`
- serial command exchange：
  `services/air-device-gateway/src/device/vuart-v1-serial-command-exchange.ts`
- mock exchange transport：
  `services/air-device-gateway/src/device/vuart-v1-command-transport-fixture.ts`
- Lua codec：`firmware/air780-livekit-bridge/vuart_v1_cmd_codec.lua`
- Lua self-test：`firmware/air780-livekit-bridge/vuart_v1_cmd_test.lua`
- Lua stream decoder：`firmware/air780-livekit-bridge/vuart_v1_stream.lua`
- Lua replay ledger：`firmware/air780-livekit-bridge/vuart_v1_ledger.lua`
- Lua control runtime：`firmware/air780-livekit-bridge/vuart_v1_runtime.lua`
- 主机执行的 Lua behavior suite：
  `firmware/air780-livekit-bridge/vuart_v1_prod_test.lua`
- 生产 core manifest：`firmware/air780-livekit-bridge/PROD_MANIFEST.sha256`

七组 vector 保存 HELLO、活动 HEARTBEAT、DIAL、HANGUP、DTMF、ACK 和冲突 ERROR 的
完整 payload/frame hex。V2046-113 隔离 self-test 已输出 session/command/FINAL PASS，
证据 `outputs/air780-gate0/windows-ui-helpers/r4-soc-log.txt` 的 SHA-256 为
`1241f914c2408a7f5e1d1d24d3c423bf0696e7c4d60084c5706c8e0f851407b2`；取证后诊断 007
已恢复。因此 codec/vector 状态为 `NODE_LUA_GOLDEN_PASS`，但仍不得宣称真实拨号、
DTMF 或 Gate 0B 已通过。

生产 Lua core 通过 Wasmoon 的 Lua 5.4 VM 在主机实际执行，不是字符串扫描。behavior
suite 覆盖 frame 分片/粘包/CRC、输入 buffer 硬上限、HELLO/HEARTBEAT、byte-identical
ACK replay、commandId/idempotencyKey 冲突、旧 fence/generation 全拒绝、same-generation
redial、重复唯一 HANGUP、ledger capacity、同 boot reconnect 和新 boot ledger 边界。
mock carrier 与 behavior suite 不在 `PROD_MANIFEST.sha256`；历史默认 capability 为 `0x03`，
测试中启用 DTMF capability 只证明软件分支，不是目标板 DTMF 证据。

Gateway H1 已通过 `FixtureSerialTransport` 的真实 envelope/CRC 字节流验证：分片、粘包、
乱序 ACK/ERROR 可按完整 command context 精确关联；伪造、损坏、迟到 response 被隔离；
timeout、disconnect、admission revoke 和 pending memory 均有界。HELLO/HEARTBEAT admission
会拒绝旧 boot、sequence/uptime 回退、心跳超时、错误 binding、缺失 capability、旧 lease/fence/
generation；USB disconnect 或新 boot 会撤销 admission、取消在途 exchange，并在每次重试
前重新门禁，禁止 quarantine 期间再次写 DIAL。

replay ledger 同样有硬上限；已应用记录不为腾空间而驱逐，满载的新命令返回无副作用的
`internal_error`。Gateway 重启 fixture 只在重建完全相同的冻结 command frame
（含原始 sequence/timestamp/payload）后允许同 boot ACK replay，保持本规范的“缓存 ACK
携带首次 requestFrameSequence”不变。真实 PostgreSQL inbox/outbox/CAS 尚未实现，因此
不能把 fixture 重建写成跨进程 durability 已完成。

生产 candidate `001.002.000` 已在 `production/main.lua` 接入有界 LuatOS VUART、真实
`cc.dial`/`cc.hangUp`、6,400-byte 电话下行和 binary `AUDIO_UPLINK`→V2048 string
`cc.input`；Wasmoon 主机组合测试已覆盖 binding、sequence/gap/duplicate/out-of-order、
8 kHz 转换、partial write/backpressure 和 terminal stop，但新 bundle 仍未下载到板端。
新 boot 意味着设备易失 ledger 不可信；必须先对账 carrier/lease 和模糊 DIAL 结果，
不能仅凭 ready heartbeat 再次拨号。DTMF 因当前 `cc` API 无发送能力而明确不支持。
