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
- 音频：PCM16LE mono、20 ms；8 kHz 为 320 bytes，16 kHz 为 640 bytes。
- 音频帧不重传；sequence gap 由接收方计数并补静音。
- 控制命令必须携带 `commandId + leaseId + fencingToken`，重复 commandId
  只返回相同结果，旧 fence 必须拒绝。
- P0 仅发送电话下行给 LiveKit，不把电话上行原声发布给 App。

下一步只有两种合法输入：

1. 经现场授权的有限 RAW zbuff 注入 PoC，按
   `docs/poc/air780-gate0-plan.md` 验证 `EXT_SRC_DONE`、连续拼接、停止与挂断；或
2. Gate 0B 数字路径失败后，改为 ESP32-S3/ES8388 模拟音频桥固件目录。

禁止以单次文件播放、模块内置 TTS 或未复现的 RAW 示例替代连续实时验收。
冻结证据与当前 Beelink USB 拓扑见
`docs/poc/air8780v4-v2046-113-hardware-baseline-20260804.md`。
