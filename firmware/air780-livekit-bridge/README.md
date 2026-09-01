# Air780 LiveKit Bridge Firmware

状态：`Gate 0A PASS / PROD_001.007.000_DEPLOYED / CONTROL_PATH_PARTIAL / AIR_DOWNLINK_PCM_FAIL / TX_REPLACE_BLOCKED_VENDOR_CORE_API / GATE0B_BLOCKED_UNVERIFIED / PRODUCT_NOT_END_TO_END_READY`

真实硬件回退基线已锁定为 Air8780V4、Air780EHV、V2046-113 CORE、诊断脚本 007
和 `audio_v2`。Gate 0A 已证明真实 VoLTE 双向 16 kHz PCM 采集。官方源码、文档和
V2048-113 发布 ELF 进一步证明：通话 RAW 流式输入需要 V2048 的 `cc.input`，V2046
只能走文件/TTS 外部音源，不能作为连续 PCM 产品接口。独立 V2048 Gate 0B 已在真实
8 kHz 通话写入 64,000 bytes 并完成单次 END/DONE 与安全挂断；这只保留为历史局部数字流
证据，不代表当前 Gate 0B 或 physical MIC replacement 通过。production binary
VUART/LiveKit TTS bundle、远端可懂度、原麦隔离和长稳仍需独立实板证据。

板端媒体规则：保持采集侧每路 6,400 bytes/200 ms 双缓冲，不退回诊断 006，不改成
48,000-byte buffer。V2048 升级只用于取得已发布的 CC stream API，不改变该媒体合同。
Beelink Gateway 发布 LiveKit 时负责把每个 200 ms 块重切成 10 × 640-byte/20-ms 帧，
并保留 device sequence、subframe index 和 call generation。

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
local result = assert(require("vuart_v1_golden_test").run())
log.info("vuart_v1_golden", result.ok, result.schema)
```

该自检已随下述隔离包在冻结的 V2046-113 目标 runtime 通过。目标日志证据为
`outputs/air780-gate0/windows-ui-helpers/r4-soc-log.txt`，SHA-256
`1241f914c2408a7f5e1d1d24d3c423bf0696e7c4d60084c5706c8e0f851407b2`。

command profile 的独立 golden 自检入口为：

```lua
local result = assert(require("vuart_v1_cmd_test").run())
log.info("vuart_v1_command_golden", result.ok, result.schema)
```

command golden 同样在该目标日志中通过；这只证明 codec/vector，不能据此声明拨号、
DTMF 或生产串口已实机通过。

## V2046-113 板端自检包

本目录现包含可由 Luatools 识别的 `main.lua`，用于把上述两个生产 codec 和 golden
self-test 放入目标 LuatOS runtime 执行。它是隔离的板端验证 runtime，不是完整电话
固件：不会打开用户 VUART，不实现 `WJAI/1`，也不会调用拨号、接听、挂断或音频注入。
启动后只运行一次 session/command self-test，并通过 SoC log 输出：

```text
vuart_v1_selftest BEGIN ...
vuart_v1_selftest SESSION PASS air780.vuart.session-payload.v1
vuart_v1_selftest COMMAND PASS air780.vuart.command-payload.v1
vuart_v1_selftest FINAL PASS
```

刷写选择的 Lua 文件固定为 `SELFTEST_MANIFEST.sha256` 中的八个文件；主机合同测试会
复算每个文件的 SHA-256。`main.lua` 保留 GPIO24 外部看门狗喂狗，避免自检结束后
板卡被外部看门狗复位。V2046-113 SoC log 已出现上述两个 suite 和 FINAL PASS，
状态现为 `NODE_LUA_GOLDEN_PASS`。取证结束后已恢复诊断 007，并再次确认
V2046/Air780EHV、`audio_v2`、COUNT_ONLY 和 6,400-byte buffer。

官方 Luatools 明确只支持 Windows 10 及以上、不支持 Mac/Linux。目标自检曾在用户
授权下仅下载脚本，未替换冻结的 V2046-113 CORE、清 KV/FS 或打开 USB BOOT。任何
后续生产 runtime 下载仍需新的现场授权；板卡当前位置和串口状态必须重新只读探测，
不能沿用历史快照。预审与回滚步骤见
`docs/acceptance/air780-vuart-v1-board-selftest-preflight-20260804.md`。

## 生产控制 runtime core

`PROD_MANIFEST.sha256` 独立固定六个生产文件：session/envelope codec、command codec、
有界二进制 stream decoder、同 boot replay ledger、控制 runtime 和 TTS uplink。它与八文件
self-test manifest 分离，mock carrier 与测试文件不进入生产 manifest。

production entry `001.007.000` 在打开所选 UART transport、初始化 CC 或配置录音之前，必须同时确认 LuatOS CORE 至少为
V2048 且 `cc.extern_source` 与 `cc.input` 都存在；V2046、未知 CORE 或缺少 stream API 时仅
记录 `requires_v2048` 或 `cc_stream_api_unavailable` 并 fail closed。该守卫防止将依赖
`cc.input` 的 V2048 production bundle 误下载到冻结的 V2046 回退基线；它不构成 Gate 0B
通过，也不授权切换 CORE。

生产 core 已由 Vitest 内嵌的 Lua 5.4 VM 真正执行，覆盖：任意分片、两帧粘包、CRC
损坏、输入缓冲硬上限；HELLO/HEARTBEAT；ACK 丢失后的 byte-identical replay；相同
commandId 或 idempotencyKey 冲突；所有旧 fence/generation 拒绝；same-generation
redial 拒绝；重复唯一 HANGUP 拒绝；ledger 满载不驱逐已应用记录；同 boot reconnect
保留 ledger；新 boot 使用新 bootId 和空 ledger。历史 R2 capability 为 `0x03`；V2048
candidate `001.002.000` 以 `0x07` 增加 16 kHz binary AUDIO_UPLINK 接收能力。该 bit 在
新 bundle 上板前仍是候选声明；DTMF bit 保持关闭。

runtime 通过依赖注入接收 binary write、clock 与 carrier adapter。ledger 是同一 boot
的有界易失状态；新 boot 后 Gateway 必须先 quarantine/reconcile carrier、lease 和
模糊 DIAL 结果，不能直接重拨。

## LuatOS production entry

独立生产入口为 `production/main.lua`，不覆盖已完成取证的 self-test `main.lua`。
`PROD_FLASH_MANIFEST.tsv` 固定 UART1 产品包，`PROD_USB_FLASH_MANIFEST.tsv` 固定 Windows
Type-C 联调所需的 USB VUART 包。两个 manifest 都固定十二个源文件的 SHA-256 和 Luatools
扁平目标文件名；只在映射到 `vuart_v1_profile.lua` 的 transport profile 上不同，共用同一
`production/main.lua`、protocol、carrier 和安全上行实现。mock、behavior test 和诊断 007
均不进入刷写包。

不要再手工拼接 Windows 刷写目录。仓库根目录提供确定性 bundle 生成器；它只接受空输出
目录，逐项校验 manifest、源文件 SHA-256、生产文件白名单、目标文件名唯一性和 Luatools
24-byte 文件名限制，复制后再次复算 hash：

```bash
npm run prepare:air780-production-bundle -- \
  --output /absolute/path/to/empty/air780-production-bundle

npm run prepare:air780-usb-production-bundle -- \
  --output /absolute/path/to/empty/air780-usb-production-bundle
```

输出目录只有对应 manifest 固定的十二个 Lua 文件；CORE 不包含在该目录中，生成 bundle 也不构成
刷写或运行授权。当前产品 entry 固定声明 capability `0x07` 和 `max_payload_bytes=8192`；
Gateway 产品准入会拒绝未知 capability、缺少任一控制/上下行媒体能力或低于 8192 的声明。

Air8780V 未接实体咪头时，MIC+/MIC- 仍是有效的 ES8311 模拟输入。`001.006.000` 起在
`exaudio.setup()` 和 `audio_v2` 校验后、`cc.init()` 之前执行 `vuart_v1_mic_guard.lua`：先把
MIC volume 写为 10 并要求读回 9–10，以排除 I2C 读取失败返回 0 的假阳性；随后调用
`exaudio.mic_vol(0)` 并要求读回 0。任一 API、写入或读回失败都会 quarantine，设备不发送
READY/HELLO，也不能拨号。OpenLuat `exaudio` 会保存该 `mic_vol=0`，后续 ES8311 resume 仍恢复
为 0。该门禁关闭的是 ES8311 ADC 数字输出贡献，不等同于物理断开 MIC 引脚；仍需实板验证
VoLTE 上行是否归零。`001.006.000` 唯一无TTS实拨已证明寄存器读回成功但接通初段低噪仍在，
所以该门禁只能保留为codec配置保护，不能宣称 cellular TX replacement 或 Gate 0B PASS。

`vuart_v1_memory.lua` 每 3 秒按 LuatOS 官方 `rtos.meminfo("lua")` 与
`rtos.meminfo("sys")` 契约记录 total/used/peak/free 数值水位，不记录设备身份、
号码或 PCM。`001.007.000` 同一3秒采样同时输出固定字段的 `vuart_v1_media cc/source`
SoC日志，包含 raw CC_IND计数、record start/callback/stop、source/input/silence、
written/free_len、实际调度延迟和backpressure；不包含号码、文本或PCM。冻结的 VUART v1
没有诊断 frame/扩展字段，因此这些指标当前只在SoC日志，不能冒充 Gateway 已消费；若要进入
Gateway必须单独定义向后兼容的新frame合同和golden vectors。候选 G0 门槛暂定两个区域各至少剩余 128 KiB；接口异常或低于
门槛时故障状态在本次 boot 中不可恢复，关闭 UART，隔离 runtime，并对活动
电话只请求一次安全挂断。该 128 KiB 是候选保护值，不是量产结论；最终门槛
必须由 V2048 真机空闲、UART、媒体和 30 分钟通话曲线冻结。

G0 物理串口使用 frame type `34` 的 `LINK_ACK`证明 ESP 已正确解码 Air
`HELLO/HEARTBEAT` 及其 CRC。payload 固定 14 B：`version(1) +
acknowledged_type(1) + acknowledged_sequence(4) + receiver_uptime_ms(8)`，全部小端。
它不携带 binding、lease、fence、号码、命令或 PCM，不能授权任何电话
副作用。Air 只接受对应已发 HELLO/HEARTBEAT sequence 的前进 ACK，对重复、
过时或未发序号分别计数；每3秒结构化SoC遥测输出 link 与上述 media 计数。

默认生产 profile 使用物理 `UART1`、`921600/8N1` 和显式 `16384` 字节 RX buffer；独立
USB production profile 使用 `uart.VUART_0/115200`，只用于当前 Windows Type-C 联调，
不改变最终 ESP32 产品互联仍走 UART1 的架构。两个 profile 均由独立 manifest 固定，禁止
刷写前手工改写 `main.lua`。transport 使用 `uart.setup`、
receive callback、`uart.read`、`uart.write` 和 `uart.close` 接口。TX 是最多八个完整 frame
的有界 FIFO，支持 partial write、零写入 10 ms 重试和单次 pump 最多四次 write；满载
只丢整个新 frame并计数。RX 每次 callback 有读取次数与单次字节上限，回调异常不会
逃逸到 LuatOS UART callback。

`vuart_v1_cc.lua` 只有在 `CC_IND READY`、ES8311 setup 成功且实际框架为 `audio_v2`
后才执行一次 `cc.init(0)`；四个 6400 B buffer 和 record callback 可提前准备，但
`cc.record(true, ...)` 只在真实 `AUDIO_START` 后打开，terminal 时关闭。DIAL/HANGUP 调用真实 `cc.dial`/`cc.hangUp`。`CONNECTED/SPEECH_START`
只更新板端物理状态，不再提前向Gateway上报 connected；只有 `AUDIO_START` 后按
`start_record→external source→首块静音input ACK` 顺序全部成功，才发送 carrier connected。
重复 `AUDIO_START` 不会重启record/source；`MAKE_CALL_FAILED`、`DISCONNECTED` 和
`HANGUP_CALL_DONE` 保持carrier权威，重复terminal event去重，
`INCOMINGCALL` 不自动接听或绑定业务会话。当前 CORE 的 `cc` 模块没有 DTMF API，
adapter 固定返回 `unsupported_command`，HELLO 不声明 DTMF bit。

Gate 0A 已验证的电话下行采集通过四个 6,400-byte zbuff 双缓冲接入 `cc.record`，只把
`is_downlink=true` 的完整 6,400-byte PCM 编成 `AUDIO_DOWNLINK`；另一方向原声仅清理
buffer并计数，绝不写入 VUART。`vuart_v1_uplink.lua` 只消费精确 session-bound binary
`AUDIO_UPLINK`：quality 2 的 16 kHz/6,400-byte PCM 直通，quality 1 先按相邻样本平均
降为 8 kHz/3,200 bytes；队列最多两个 chunk，处理 partial write、零写入/backpressure、
gap/duplicate/out-of-order、旧 generation 和 terminal `extern_source(nil)` 清理。自
`AUDIO_START` 起先启动下行record，再按当前 call generation 启动 external source，并在首个翻译 TTS、AI
Agent TTS 或人工接管音频到来前及其帧间空档持续补全零 PCM；真实 `AUDIO_UPLINK` 会优先
替换尚未开始写入的静音块。每个16k静音块固定6,400 bytes/200ms，不再每100ms双倍灌入；
partial/zero write根据 `free_len` 和字节率计算10–200ms有界重试，完整空档块严格按200ms媒体
时钟补充，不允许物理麦克风作为无媒体时的回退上行。若当前
generation 的 external source 无法启动、`cc.input` 已把 uplink 置为 fault，或 active
source 在 carrier terminal 前意外产生 `EXT_SRC_DONE`，cc adapter 会拒绝后续 TTS，并只
请求一次 `cc.hangUp`，不能静默继续通话。该 host/Lua fail-closed 行为会等待实际 carrier
terminal，再以 `failed/device_error` 上报，不能把媒体安全故障伪装为用户主动挂断。它不
证明板端模拟 MIC 输入已隔离；接通首句前、句间空档、underrun 和该异常窗口仍须以 Gate 0B
的双 marker 远端检测取证。

若 `cc.hangUp` 明确返回 `false` 或抛错，adapter 不会假造 terminal：它保持当前
generation 的 TTS 禁止状态、拒绝重复 hangup，并上报非终态 `unknown/unknown`，让 Gateway
quarantine 媒体并等待真实 carrier terminal 或对账。只有后续真实 terminal 才收敛为
`failed/device_error`。普通 HANGUP 也必须在 `cc.hangUp` 未明确返回 `false` 时才 ACK；
这样 API 的取消/挂断不会把设备拒绝误写成成功。

`vuart_v1_uplink.enqueue()` 不会掩盖首次 `cc.input` fault：启动 source 后的首个 pump
失败会在同一次 `AUDIO_UPLINK` 调用返回失败，使 carrier adapter 立即执行上述收口，
不等待下一段 TTS 触发。

Beelink Gateway 的 `AirGatewayTtsUplink` 对 VUART 写失败会 suspend 当前 generation、
清空未写 PCM 并拒绝后续同 generation 的 TTS；它不会把主机写失败伪装成 carrier 已断开，
仍等待 Air780 的真实 terminal event 或串口重连后的对账。该 host quarantine 同样不替代
Gate 0B 的远端 marker 证据。

Gateway 只会在真实 carrier `connected` 已观察到后发布 Air780 下行并接收 TTS；入房 joined
不是媒体开关。任何 connected 前或 `unknown` 时到达的电话下行会被计数并丢弃；收到
`unknown` 时 Gateway 会清空 TTS/downlink queue 并退出设备 room，但不伪造 carrier terminal。

生产入口使用 `mcu.unique_id()` 生成稳定 deviceId、`crypto.trng(16)` 生成每次启动变化
的 bootId；随机源或设备身份不可用时 fail closed。它保留 GPIO24 外部看门狗，只有
UART、audio_v2、`cc.init` 和 `cc.record` 全部就绪后才发送 HELLO/HEARTBEAT，异常时进入
quarantine，不记录设备 ID、电话号码或 PCM。

Wasmoon 主机测试已实际执行 UART partial write/重试/有界队列、cc 初始化门禁、carrier
事件门控、重复AUDIO_START、DTMF 拒绝、record-before-source、下行 PCM、原声隔离和完整 production main：二进制 DIAL 只调用
一次 `cc.dial`，type 16 下行与 type 17 TTS 上行分别通过；上行另覆盖 8 kHz 转换、
FIFO partial/zero write、`free_len`节拍、200ms静音媒体时钟、队列背压、序列异常和挂断 stop。
它仍不替代新 bundle 板端运行。

首次获授权的 R1 脚本级板端运行没有进入 READY：目标 LuatOS 的 `uart` 是可索引宿主对象，
不是 adapter 原先要求的普通 Lua table，SoC log 报 `vuart_v1_uart: uart_api required` 后
Lua VM 每 15 秒重启。被动 COM3 捕获为 0 bytes，未发送任何 DIAL/HANGUP/DTMF；随后已
恢复并实时验证诊断 007、V2046/Air780EHV、`audio_v2`、COUNT_ONLY、6,400-byte buffer
和无活动通话。production entry 现把 `uart/cc/zbuff` 的必要成员先归一为普通 Lua table，
并以非 table 宿主对象回归测试复现旧错误、验证修复。R2 Windows 八文件隔离包通过
SHA-256、24-byte 文件名和冻结 `luac_64bit -p` 预检后，在独立无拨号授权下两次上板均
到达 READY。纯接收 COM3 证据包含跨 boot HELLO、capability `0x03`、变化的 bootId 以及
连续 HEARTBEAT；新 boot 的 frame sequence 0–7、heartbeat sequence 0–6 均无 boot 内 gap，
CRC 全部通过且状态均为 ready/无 binding。Windows 被动 VUART 必须启用 DTR；未启用 DTR
时端口立即断开且收到 0 bytes。取证后已恢复并实时验证诊断 007。真实拨号副作用、
CALL_STATE、持续 6,400-byte PCM 吞吐和 USB/Gateway 故障恢复仍需新的受控拨号授权。

Gateway 已有纯软件 command channel H1：`FixtureSerialTransport` 会经过真实
VUART envelope/CRC parser，并覆盖 ACK 丢失/乱序/分片/粘包、伪造与迟到响应隔离、
pending/ledger 上限、USB disconnect、新 boot quarantine 和 HELLO/HEARTBEAT reconcile。
同 boot 的 Gateway 重启只允许从持久 outbox 重建完全相同的原 command frame；当前仅有
fixture 证据，PostgreSQL durability 尚未落地。

真实主机串口实现为 `NodeSerialTransport`：固定 115200/8N1、`autoOpen=false`、独占锁；
物理 `open()` 后必须先成功执行 `DTR=true`，才把 transport 标记为可用并开始交付 RX。
DTR 断言失败时立即关闭 tty，所有写入继续 fail closed；正常关闭先设 `DTR=false`，写入
必须完成 `drain()` 才返回，异常 close/error 会撤销 ready。该行为已用注入式 port mock
验证，但本批没有打开 Beelink tty，因此 Linux if06 的真实 DTR/HELLO parity、production
控制命令和真实 carrier 仍需独立现场验收，不能替代 Gate 0B。

## Gate 0B 隔离 RAW PoC

`GATE0B_FLASH_MANIFEST.tsv` 固定一个与诊断007、production R2 都分离的两文件候选：

- `gate0b/main.lua` → `main.lua`
- `gate0b/g0b_raw.lua` → `g0b_raw.lua`

`GATE0B_V2048_CORE_MANIFEST.tsv` 另行固定官方
`LuatOS-SoC_V2048_Air780EHV_113.soc` 的文件名、大小、下载地址和 SHA-256。V2046
回退基线不被该清单覆盖；烧录前后必须分别核验 CORE 和脚本证据。

它没有号码、自动拨号、自动接听、外部音频文件或 production VUART v1。启动只初始化
ES8311/`audio_v2`、CC 和诊断 VUART；来电必须由主机显式发送 `ANSWER`，而有限测试 PCM
必须等本次通话出现 `AUDIO_START` 后再发送 `START 1..50`。其他只读/收口命令为
`PING`、`INFO`、`STATS`、`SELFTEST`、`CLEAR` 和 `HANGUP`，响应前缀固定为隔离的
`WJG0B/1`。V2046、缺少 `cc.input` 或 RAW codec 不为 0 时 fail closed。

RAW stream 严格按 V2048 官方接口启动一次：

```lua
cc.extern_source(true, true, audio_v2.DATA_CODEC_TYPE_RAW,
    true, 16000, 16, 1, true)
cc.input(true, pcm_string, false)
cc.input(true, "", true)
```

每块是 6,400-byte/200-ms PCM16LE mono 测试音调。V2048-113 的 zbuff 输入分支在发布
ELF 中存在空数据指针风险，故候选只允许 Lua string。controller 按 `write_len/free_len`
处理部分写入、零写入和 FIFO 背压；单次 timer pump 最多四次输入，最终只发送一次
`is_end=true` 并等待整个 stream 的一次 `EXT_SRC_DONE`。CLEAR/挂断停止 source 并清空
待写数据；旧 generation 的 pump/DONE 全部拒绝。同一 call generation 只允许一次有限
`START`，重复 `AUDIO_START` 不提升 generation。

主机 Wasmoon 测试已执行脚本/CORE 清单哈希、V2048 capability guard、partial write、
backpressure、无损字节顺序、单次 end/DONE、clear、旧 generation 拒绝和完整入口安全
启动。这只是 `GATE0B_V2048_HOST_CANDIDATE_PASS`：测试音不证明远端语音可懂度；未取得
目标录音、延迟、连续拼接、挂断清理和旧音频 0 的实机证据前，Gate 0B 仍是
`BLOCKED_UNVERIFIED`。实板操作前必须实时复核端口、无活动通话、包哈希和 V2046 回退包；
不得清 KV/FS 或使用 USB BOOT，取证结束后恢复冻结 CORE 与诊断007基线。

完成板端 golden 自检后，媒体注入仍只有两种合法输入：

1. 经现场授权的 V2048 string stream 注入 PoC，按
   `docs/poc/air780-gate0-plan.md` 验证 FIFO 流控、`EXT_SRC_DONE`、连续拼接、停止与挂断；或
2. Gate 0B 数字路径失败后，改为 ESP32-S3/ES8388 模拟音频桥固件目录。

禁止以单次文件播放、模块内置 TTS 或未复现的 RAW 示例替代连续实时验收。
冻结证据与历史 Beelink USB 快照见
`docs/poc/air8780v4-v2046-113-hardware-baseline-20260804.md`。
