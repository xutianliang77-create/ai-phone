# Air780 VUART v1 Session Payload Schema

状态：`FROZEN_H0_NODE / LUA_RUNTIME_PENDING`
日期：2026-08-04

本文冻结 VUART v1 中进入 Air Device Gateway 会话路由的三类 payload：
`CALL_STATE`、`AUDIO_DOWNLINK`、`AUDIO_UPLINK`。外层 frame envelope 继续使用
`magic/version/type/flags/sequence/timestamp_ms/payload_length/crc32`。

诊断 007 的 `WJAI/1` 文本头不属于本协议。`HELLO`、`HEARTBEAT`、`DIAL`、
`HANGUP`、`DTMF`、`ACK` 和 `ERROR` 已在
`air780-vuart-v1-command-payload-schema-20260804.md` 独立冻结；禁止使用临时 JSON、
文本或其他私有二进制格式替代。

## 1. 通用规则

- 所有整数均为无符号 little-endian。
- payload 必须完整消费；截断、尾随字节、未知枚举或非零 reserved flags 全部拒绝。
- frame `flags` 在本 profile 固定为 `0`。
- frame `timestamp_ms` 是发送端启动后的单调毫秒，不是 Unix wall clock。
- frame `sequence` 是每个发送端连接内的传输序号；控制和音频可交错，不得把它
  当成媒体序号或 carrier event 序号。
- `callGeneration` 由业务会话分配，只能递增；不得从 USB 重连、frame sequence 或
  LiveKit participant presence 推断。
- 所有 identifier 使用 ASCII `[A-Za-z0-9][A-Za-z0-9._:-]*`，禁止空字符串、NUL、
  Unicode 归一化变体和尾随空格。
- `fencingToken` 以 `uint64` 编码，v1 允许值为 `1..2^53-1`，保证 Node number、
  PostgreSQL bigint 安全范围和 Lua 64-bit integer 一致。

## 2. Session binding prefix

三类 payload 共用以下可变长前缀：

| 顺序 | 字段 | 编码 | 约束 |
| ---: | --- | --- | --- |
| 1 | `payloadVersion` | `uint8` | 固定 `1` |
| 2 | `callGeneration` | `uint32` | `0..2^32-1` |
| 3 | `fencingToken` | `uint64` | `1..2^53-1` |
| 4 | `communicationSessionId` | `uint8 length + ASCII` | `1..160 bytes` |
| 5 | `providerCallId` | `uint8 length + ASCII` | `1..200 bytes` |
| 6 | `deviceId` | `uint8 length + ASCII` | `1..128 bytes` |
| 7 | `leaseId` | `uint8 length + ASCII` | `1..128 bytes` |

长度表示字节数，不是字符数。identifier 最大值均低于 `uint8` 的 255-byte 上限。

## 3. CALL_STATE payload

Session binding prefix 后依次追加：

| 字段 | 编码 | 约束 |
| --- | --- | --- |
| `eventSequence` | `uint32` | generation 内独立递增；首值允许为 `0` |
| `carrierState` | `uint8` | 见状态表 |
| `carrierCause` | `uint8` | 见原因表与组合约束 |

状态表：`1=dialing`、`2=ringing`、`3=connected`、`4=disconnected`、
`5=busy`、`6=failed`、`7=unknown`。

原因表：`0=none`、`1=local_hangup`、`2=remote_hangup`、`3=busy`、
`4=no_answer`、`5=rejected`、`6=network_error`、`7=device_error`、
`255=unknown`。

允许组合：

- `dialing/ringing/connected + none`
- `disconnected + local_hangup/remote_hangup/no_answer/rejected/unknown`
- `busy + busy`
- `failed + network_error/device_error/unknown`
- `unknown + unknown`

carrier event sequence 与 audio media sequence 分域；任一方向的音频帧不得造成
carrier gap 误报。运营商/VoLTE event 是电话状态权威，LiveKit joined 不生成
`connected`。

## 4. AUDIO payload

`AUDIO_DOWNLINK` 表示 Air780 电话来音送往 Beelink；`AUDIO_UPLINK` 表示 Beelink
只把目标译音/TTS 送往 Air780。Session binding prefix 后依次追加：

| 字段 | 编码 | v1 固定值或约束 |
| --- | --- | --- |
| `mediaSequence` | `uint32` | 每方向、每 generation 独立递增 |
| `sampleRateHz` | `uint16` | `16000` |
| `durationMs` | `uint16` | `200` |
| `channels` | `uint8` | `1` |
| `sampleFormat` | `uint8` | `1 = PCM_S16LE` |
| `pcmByteLength` | `uint16` | `6400` |
| `pcm` | raw bytes | 恰好 `6400 bytes` |

板端仍保持已实测稳定的 6,400-byte/200-ms 块。Beelink 发布 LiveKit 前无损切成
10 个 640-byte/20-ms frame，并携带 `(mediaSequence, subframeIndex 0..9,
callGeneration)`。不得把板端缓冲改成 640 bytes 或 48,000 bytes。

音频不重传。duplicate/out-of-order 直接丢弃；gap、missing chunk、backpressure 和
drop 必须计数。断连、terminal carrier state 或新 generation 开始时必须清空旧队列。

## 5. Golden vectors

规范资产：

- Node/JSON：`services/air-device-gateway/fixtures/vuart-v1/golden-vectors.json`
- Lua table：`firmware/air780-livekit-bridge/vuart_v1_golden_vectors.lua`

小型 `CALL_STATE` vector 保存完整 payload/frame hex。6,400-byte 音频 vector 使用
`pcm[i] = i mod 256` 的零基模式，并保存 payload/frame byte length 与 SHA-256，避免
在源码中复制超过 14 KiB 的 hex。Node 测试必须同时核对 Lua table 中的同一组值。

当前 Mac 没有 Lua/LuatOS runtime。Lua codec 和 golden self-test 源码已经生成，
但只能由 Node 做静态合同校验，不能标记为 Lua codec 已执行。必须在目标 LuatOS
runtime 运行 self-test 后才能提升状态；真实 VUART/USB 互通仍需现场授权。

Lua 实现只使用显式逐字节 little-endian 编码，避免不同 CORE 对 pack 格式细节的
差异；frame CRC32 和 golden SHA-256 使用 LuatOS `crypto` API。接口依据：

- [LuatOS string.pack/unpack 官方示例](https://docs.openluat.com/air780ex/luatos/app/common/pack/)
- [Air780EHV crypto 官方说明](https://docs.openluat.com/air780ehv/luatos/app/common/crypto/)

## 6. 拒绝条件

以下任一情况在进入 carrier 状态机或音频队列前拒绝：

- payload version、frame type 或 reserved flags 不匹配；
- identifier 非 ASCII、为空、超长或不符合 canonical pattern；
- fence 超出安全范围，generation/sequence 越界；
- CALL_STATE 未知枚举或 state/cause 组合非法；
- AUDIO metadata 不是 16 kHz/S16LE/mono/200 ms/6,400 bytes；
- 声明长度与剩余字节不一致、截断或存在尾随字节；
- session/device/lease/fence/generation 与当前活动绑定不完全一致。

本 schema 的 H0 通过不提升 Gate 0B。连续数字 PCM 回灌、远端可懂度、延迟、
clear/打断、原声泄漏 0 和长稳仍为 `BLOCKED_UNVERIFIED`。
