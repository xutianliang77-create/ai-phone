# Air780 if06 安全串口探测证据

日期：2026-08-04
状态：`DIAG007_SERIAL_INFO_PASS / PRODUCTION_VUART_V1_DEVICE_RUNTIME_PENDING`

## 1. 授权与边界

用户已明确授权打开 Air780 串口。本次只对 Beelink 上 Air780 用户 VUART 做有限
诊断探测，发送 `PING`、`INFO`、`STATS`；未发送 `DIAL`、`ANSWER`、`HANGUP`、
DTMF、`COUNT_ONLY OFF` 或任何音频注入命令。未修改 `dialout`、udev、systemd、
设备权限或固件，也未发起真实电话。

诊断 007 使用 `WJAI/1` 文本帧。本文只证明该诊断运行态可经真实 if06 读取，不能
作为生产 VUART v1 二进制协议或 Node/Lua golden runtime 已经互通的证据。

## 2. 打开前实时只读核对

2026-08-04 13:59–14:01 +08:00 在 Beelink 重新核对：

- `19d1:0001 BYD AirM2M Compo` 位于 `Bus 001 Device 009`；
- 用户 VUART 稳定路径
  `/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if06`
  指向 `/dev/ttyACM2`；if02/if04 分别仍指向 ttyACM0/ttyACM1；
- 三个节点均为 `root:dialout 0660`，没有可见占用者；
- `beelink` 用户不在 `dialout` 组，直接打开 ttyACM0/1/2 均返回 `EACCES`；
- ModemManager 正在运行，但 `mmcli -L` 返回 `No modems were found`。

为避免修改主机权限，使用一次性、无网络、只读根文件系统、移除全部 capabilities
且 `no-new-privileges` 的 Docker 容器，仅把稳定 if06 设备映射为
`/dev/air780-vuart`。容器结束后由 `--rm` 删除；没有部署或保留 Gateway 服务。

## 3. 串口结果

串口参数为 115200 baud、exclusive open、DTR/RTS false。首轮只发送：

```text
PING
INFO
STATS
STATS
```

首轮原始响应共 2,348 bytes：

```text
SHA-256 855f5f699e683812dc280b5e495b432d75a88db717d1a225dc796c94e9b7ce23
```

解析到的 `WJAI/1` 帧：

| sequence | type | payload SHA-256 | 关键结果 |
| ---: | --- | --- | --- |
| 48 | ERROR | `fff8b5c5723e0f09b81d6b95352900b9f29347b0956c22b8010d9b6852d1c507` | 首个 `PING` 返回 `command=INVALID` |
| 49 | INFO | `0ebd9b9575a22839a03fd341d62b5db0cc6c57b6673ac9ac549e2cc4e1936f418` | 007、V2046、Air780EHV、audio_v2、COUNT_ONLY |
| 50 | STATS | `06574aea42b63eca9b9a19b3a2e58171f9fcdd18f039b81e01c88292ed926785` | 空闲统计快照 1 |
| 51 | STATS | `a6cd1d5737a3a1c64fcc0d7fe4a59da1b3df6df0a8b5456966935c951f99ce94` | 832 ms 后空闲统计快照 2 |

`INFO` 的关键字段：

- `project=WUJIE_AIR_GATE0_DIAG`，`app_version=000.999.007`；
- `firmware=V2046`，`bsp=Air780EHV`；
- `audio_mode_requested=new`，`audio_mode_actual=audio_v2`；
- `audio_setup_done=true`，`audio_setup_ok=true`，`audio_setup_attempts=1`；
- `cc_ready=true`，`cc_init_ok=true`，`cc_record_ok=true`；
- `count_only=true`，`stream_up=true`，`stream_down=true`；
- `buffer_size=6400`，`dropped_frames=0`，`tx_queue_depth=0`；
- GPIO24 看门狗启用，间隔 10 秒。

两次 `STATS` 均为 `call_generation=0`、`quality=0`、上下行 callbacks/bytes=0、
PCM emit/failure=0、drop/queue/UART error=0，且 832 ms 内没有计数增长。因此本次
探测时点可判定没有活动通话或 PCM 流；这仍是当时快照，不替代未来操作前的实时核对。

## 4. 首个 PING 异常复测

007 源码明确接受精确的 `PING`，而首轮后续 `INFO/STATS` 均正常。为区分协议故障
和打开边界残留，关闭串口后重新独立打开，只发送同样的 `PING\n`。sequence 52
返回：

```text
WJAI/1 REPLY 0 44 52
{"detail":"PONG","ok":true,"command":"PING"}
```

- 原始 65 bytes SHA-256：
  `ebab5a25f39512997f872ff1086f0a5ca96ba05ce77035ceab59b6aebb0aa198`；
- payload SHA-256：
  `e9e2ccf4f5c0b9ccdba92bb81b5a8dbb518a8a36c6678071f5d391b33a5b2f30`。

5 Whys 结论：首个响应为何是 `INVALID` → 007 收到的首行不等于精确 `PING` →
同一运行态随后能解析 INFO/STATS 且独立复测能 PONG → 异常只出现在首次打开边界 →
最可能是板端 `command_buffer` 中此前未终止的残留字节被新换行补全。007 的错误响应
不回显原始无效行，因此残留内容无法事后证明；该解释标记为推断，不把异常改写成
PASS，也不据此修改生产二进制协议。

## 5. 打开后核对与判定

2026-08-04 14:04:21 +08:00 再次核对：设备仍为 `Bus 001 Device 009`，稳定
symlink 及 ttyACM0/1/2 映射未变，节点权限未变，没有 tty 占用者；内核日志在本次
窗口内没有 USB/cdc_acm/ttyACM 断开或重连记录。sequence 48→52 连续，也没有板端
重启迹象。

本次通过项为：真实 if06 可安全打开、诊断 007 身份和 audio_v2/COUNT_ONLY/6400-byte
运行配置得到当前证据、空闲状态得到双 STATS 佐证。仍未通过的项目为：生产 VUART v1
板端 runtime、Node/Lua golden self-test、真实 Gateway 接管、拨号、PSTN 回灌、
Gate 0B 连续注入、原声泄漏 0。因此总体状态仍为 `PARTIAL`，不得宣称端到端可用。
