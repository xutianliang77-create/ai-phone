# Air8780V4 / Air780EHV 硬件现实基线

日期：2026-08-04
状态：`Gate 0A PASS / Gate 0B BLOCKED_UNVERIFIED`

本文只冻结已经取得的硬件证据和后续软件边界。Windows 证据是历史实测归档；
当前物理拓扑已迁移为 Air780 接在 Beelink USB。两者不得混写成同一次运行。

## 1. 冻结资产

- 板卡：Air8780V4，核心模组 Air780EHV，SIM + VoLTE。
- CORE：`LuatOS-SoC_V2046_Air780EHV_113`。
- CORE SHA-256：
  `61450d271b83611ff4b0c1c6a930b4c2e7ee77cde0ef95ad88ef431a9cb40b1a`。
- Lua：`WUJIE_AIR_GATE0_DIAG 000.999.007`。
- Lua SHA-256：
  `2399245b9bc3bc6a5ee9326b3592fa4221cd75ae8f124fca7a316b0009d3e525`。
- 音频框架：脚本请求 `audio_mode="new"`，Windows 实测运行态为
  `audio_v2`。
- 音频配置：上下行同时采集，16 kHz、PCM S16LE、mono；每路每次回调
  6,400 bytes，即 3,200 samples / 200 ms；双缓冲。
- 安全默认：`COUNT_ONLY ON`。只有经现场授权的采集才可显式切为 OFF，结束后
  必须恢复 ON。
- 外部看门狗：GPIO24，脚本持续喂狗。

007 只下载了 Lua 脚本，没有重刷 CORE、清 KV/FS 或操作 USB BOOT。不得退回
006，不得把板端稳定缓冲改成 48,000 bytes，也不得因旧版倍速问题先换 CORE。

## 2. Windows 真实证据基线

以下结果来自 2026-08-04 Windows 台架归档，不代表当前 Beelink 正在运行或已打开
串口：

1. 真实电信 10000 VoLTE `COUNT_ONLY`：板端通话 59.542 秒；上、下行各
   297 callbacks / 1,900,800 bytes；间隔 199–201 ms；空回调、丢帧和队列
   深度均为 0。
2. 原始 PCM USB/VUART：通话 15.359 秒；上、下行各 76 帧 / 486,400 bytes，
   即各 15.2 秒；主机 sequence gap=0，最大到达间隔 218 ms，VUART 最大写耗时
   12 ms，零写和错误均为 0；已生成 16 kHz mono S16LE WAV。
3. 看门狗/空闲：约 449.99 秒，feed 45→90；无重启和 USB 重枚举。

证据入口：

- `/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/DIAGNOSTIC_006_007_COMPLETE_TEST_20260804.md`
- `/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/MANIFEST.md`
- `/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/evidence/20260804/diag007/`
- `/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/evidence/20260804/windows-archives/diag007-evidence-20260804.zip`

上述证据证明双向 PCM 数据、格式、节拍和传输完整性；不证明上行人声可懂度，
更不证明译音已成功注入 VoLTE 上行。

## 3. Gate 拆分

### Gate 0A：电话双向 PCM 采集 — PASS

已通过范围：Air780→Windows 的真实 VoLTE 上、下行 16 kHz PCM 采集、
6,400-byte/200-ms 节拍、USB/VUART 完整性和外部看门狗。

### Gate 0B：连续译音上行注入 — BLOCKED_UNVERIFIED

V2046 的 `cc.extern_source()` 可接受 RAW PCM `zbuff`，但现有证据只覆盖一次性
内存文件源形态：必须等待 `EXT_SRC_DONE`，忙时拒绝下一块，且 zbuff 必须存活到
完成。尚未证明：

- 连续无缝拼接和明确的 underrun 行为；
- stop/clear/挂断清理和真实 barge-in；
- 30 分钟长稳、远端可懂度和端到端延迟；
- P0 所需的原声泄漏为 0。

因此不得宣称翻译电话端到端可用。下一硬件 PoC 只验证有限 RAW zbuff 注入；若
数字路径失败，再进入 ESP32-S3-AUDIO-Board/ES8388 模拟音频桥回退。

## 4. 当前 Beelink USB 只读快照

2026-08-04 09:58 +08:00 只读探测确认：

- USB：`19d1:0001 BYD AirM2M Compo`。
- SoC log：`/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if02`
  → `/dev/ttyACM0`。
- AP log：`/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if04`
  → `/dev/ttyACM1`。
- 用户 VUART：`/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if06`
  → `/dev/ttyACM2`。
- 三个端口均为 `root:dialout`、`0660`，探测时没有打开句柄。
- `beelink` 用户当前不在 `dialout` 组；未来 Gateway 真实接管前需经明确授权配置
  udev/systemd `SupplementaryGroups=dialout` 或等效最小权限方案。

本次没有打开串口，故不把 Windows 上的 007/audio_v2 运行态误写成 Beelink 当前
运行态；也没有修改用户组、udev、服务、固件或发起真实电话。

### 4.1 2026-08-04 14:04 +08:00 串口授权后快照

用户明确授权打开 Air780 串口后，重新实时核对并仅打开用户 VUART if06。当前
`INFO` 已确认板端为 `WUJIE_AIR_GATE0_DIAG 000.999.007`、V2046/Air780EHV、
`audio_mode_actual=audio_v2`、`count_only=true`、`buffer_size=6400`；两次
`STATS` 均为 `call_generation=0`、`quality=0`、上下行 callbacks/bytes=0，且
832 ms 内没有增长。探测后 USB 仍为 Bus 001 Device 009，稳定 symlink 未变，
内核窗口内没有断开/重连记录。

本次没有修改 `dialout`/udev/systemd，没有刷机、拨号、DTMF 或音频注入。详细
命令边界、响应哈希和首个 `PING` 的保留异常见
`docs/acceptance/air780-if06-safe-serial-probe-20260804.md`。该证据只覆盖诊断 007
文本协议，不代表生产 VUART v1 板端 runtime 或 Gate 0B 已通过。

## 5. 对 Air Device Gateway / LiveKit 的冻结规则

- Gateway 按每路 6,400-byte/200-ms 块接收，并校验板端 sequence 与
  call generation。
- LiveKit 需要 20 ms 音频时，由 Beelink 主机侧把每个块重切为 10 个
  640-byte 帧（16 kHz、S16LE、mono）；用 `(deviceSequence, subframeIndex 0..9)`
  保持顺序。不得为了适配 LiveKit 修改板端稳定缓冲。
- ASR 可直接消费 200 ms 原始块，或按既有 Worker 合同聚合；不要无意义地反复
  Base64/JSON 转码。
- carrier/VoLTE 通话事件与 LiveKit participant 事件必须分离；LiveKit joined
  不等于运营商 connected。
- Air guest 继续 `autoSubscribe=false`，只订阅精确目标 TTS track；P0 禁止把
  电话原声跨房发布给 App。
- Gate 0B、raw cross-audio=0、双向真实电话、挂断/结算/重连全部通过前，生产
  App、Translation Worker 和 Voice Agent 主链不得宣称可用。
