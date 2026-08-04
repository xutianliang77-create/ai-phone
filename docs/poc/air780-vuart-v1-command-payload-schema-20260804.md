# Air780 VUART v1 Command Payload Schema

状态：`FROZEN_H0_NODE / LUA_RUNTIME_PENDING`
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
- 当前 golden HELLO 只声明已具备证据的 call control 与电话下行采集；Gate 0B 未通过
  前不得声明电话上行 PCM injection，DTMF 未实测前也不得声明 DTMF capability。

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
payload；它不是修改板端 200 ms 缓冲的许可。

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
- Lua table：`firmware/air780-livekit-bridge/vuart_v1_command_golden_vectors.lua`
- Node codec：`services/air-device-gateway/src/device/vuart-v1-command-payload.ts`
- Gateway ingress：`services/air-device-gateway/src/device/vuart-v1-command-ingress.ts`
- H0 replay guard：`services/air-device-gateway/src/device/vuart-v1-command-replay-guard.ts`
- mock exchange transport：
  `services/air-device-gateway/src/device/vuart-v1-command-transport-fixture.ts`
- Lua codec：`firmware/air780-livekit-bridge/vuart_v1_command_codec.lua`
- Lua self-test：`firmware/air780-livekit-bridge/vuart_v1_command_golden_selftest.lua`

七组 vector 保存 HELLO、活动 HEARTBEAT、DIAL、HANGUP、DTMF、ACK 和冲突 ERROR 的
完整 payload/frame hex。当前 Mac 无 Lua/LuatOS runtime；只有 Node codec 与静态 Lua
合同已执行，状态保持 `LUA_RUNTIME_PENDING`。V2046-113 目标 self-test 未运行前不得
标记 `NODE_LUA_GOLDEN_PASS`，也不得宣称真实拨号、DTMF 或 Gate 0B 已通过。

Gateway H0 已通过 mock transport 验证：首次 ACK 丢失后重放完全相同的 command
frame，副作用仍恰好一次；旧 fence 与旧 generation 在 ledger 和执行器之前 100%
拒绝；相同 commandId 不同 payload 及相同 idempotencyKey 换 commandId 均返回冲突。
该 guard 是内存参考实现，尚未接真实 serial runtime 或板端持久 ledger；新 bootId、
Gateway 重启和设备重启仍必须 quarantine/reconcile，不能据 H0 宣称崩溃恢复完成。
