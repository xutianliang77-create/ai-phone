# Air780 LiveKit Bridge Firmware

状态：`Gate 0A capture PASS / FW-001 BLOCKED_BY_GATE_0B_INJECTION`

真实硬件基线已锁定为 Air8780V4、Air780EHV、V2046-113 CORE、诊断脚本 007
和 `audio_v2`。Gate 0A 已证明真实 VoLTE 双向 16 kHz PCM 采集；当前仍不提交
假定可用的 `cc.extern_source` 连续 PCM 循环，因为 Gate 0B 的连续拼接、
refill/clear、打断、远端可懂度和长稳尚未实测。

板端冻结规则：保持每路 6,400 bytes/200 ms 双缓冲，不退回诊断 006，不改成
48,000-byte buffer，也不为 LiveKit 先换 CORE。Beelink Gateway 发布 LiveKit 时
负责把每个 200 ms 块重切成 10 × 640-byte/20-ms 帧，并保留 device sequence、
subframe index 和 call generation。

主机侧已冻结的 VUART v1 合同：

- 帧头：`magic(2) + version(1) + type(1) + flags(2) + sequence(4) +
  timestamp_ms(8) + payload_length(2)`；尾部 `crc32(4)`。
- 多字节字段：little-endian。
- 会话音频 payload：PCM16LE mono、16 kHz、200 ms、6,400 bytes；Beelink
  发布 LiveKit 前再无损重切为 10 × 640-byte/20-ms frame。
- 音频帧不重传；sequence gap 由接收方计数并补静音。
- 控制命令必须携带 `commandId + leaseId + fencingToken`，重复 commandId
  只返回相同结果，旧 fence 必须拒绝。
- P0 仅发送电话下行给 LiveKit，不把电话上行原声发布给 App。

`CALL_STATE`、`AUDIO_DOWNLINK` 和 `AUDIO_UPLINK` 的精确 payload 布局见
`docs/poc/air780-vuart-v1-session-payload-schema-20260804.md`。诊断 007 的
`WJAI/1` 文本头不属于生产协议。`HELLO/HEARTBEAT/DIAL/HANGUP/DTMF/ACK/ERROR`
布局见 `docs/poc/air780-vuart-v1-command-payload-schema-20260804.md`。

Lua session codec 为 `vuart_v1_codec.lua`，golden 自检入口为：

```lua
local result = assert(require("vuart_v1_golden_selftest").run())
log.info("vuart_v1_golden", result.ok, result.schema)
```

该自检尚未在 V2046-113 或其他 Lua runtime 执行；未取得日志前状态保持
`LUA_RUNTIME_PENDING`，不得写成 Node/Lua golden 已通过。

command profile 的独立 golden 自检入口为：

```lua
local result = assert(require("vuart_v1_command_golden_selftest").run())
log.info("vuart_v1_command_golden", result.ok, result.schema)
```

该入口同样尚未在目标 runtime 执行，不得据源码存在声明拨号或 DTMF 已实机通过。

Beelink Gateway 已有纯软件 command ingress + replay guard H0：mock transport 可验证
ACK 丢失重放时副作用恰好一次、冲突命令不执行、旧 fence/generation 全拒绝。它尚未
连接真实 VUART 或板端 Lua ledger，不能替代 V2046-113 self-test 和真实控制验收。

下一步只有两种合法输入：

1. 经现场授权的有限 RAW zbuff 注入 PoC，按
   `docs/poc/air780-gate0-plan.md` 验证 `EXT_SRC_DONE`、连续拼接、停止与挂断；或
2. Gate 0B 数字路径失败后，改为 ESP32-S3/ES8388 模拟音频桥固件目录。

禁止以单次文件播放、模块内置 TTS 或未复现的 RAW 示例替代连续实时验收。
冻结证据与当前 Beelink USB 拓扑见
`docs/poc/air8780v4-v2046-113-hardware-baseline-20260804.md`。
